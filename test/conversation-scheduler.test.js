import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createConversationArchive } from '../src/conversation-archive.js';
import { createConversationScheduler } from '../src/conversation-scheduler.js';

const msg = (id, timestamp, content) => ({
  id, guildId: 'g1', channelId: 'c1', createdTimestamp: Date.parse(timestamp), content, cleanContent: content,
  guild: { id: 'g1', name: 'Servidor' }, channel: { id: 'c1', name: 'geral' },
  author: { id: 'u1', username: 'usuario', displayName: 'Usuário', bot: false },
  mentions: { users: new Map(), roles: new Map() }, attachments: new Map(), embeds: [],
});
const analysis = { summary: 'Resumo do canal.', topics: [], interactions: [], worked: [], failed: [], promptChanges: [], codeChanges: [], limitations: [] };

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'conversation-scheduler-'));
  const archive = createConversationArchive({ root: path.join(root, 'conversas') });
  return { root, archive, close: () => fs.rm(root, { recursive: true, force: true }) };
}

async function scheduleDay(scheduler, localDate = '2026-10-08', scheduledAt = Date.parse('2026-10-09T05:00:00Z')) {
  return scheduler.schedule({ guildId: 'g1', channelId: 'c1', localDate, scheduledAt, requestedBy: 'u1' });
}

test('arquivos existentes só são analisados após agendamento explícito', async () => {
  const f = await setup();
  try {
    await f.archive.recordMessage(msg('target', '2026-10-09T02:59:00Z', 'conversa'));
    await f.archive.flush();
    let calls = 0;
    const scheduler = createConversationScheduler({
      archive: f.archive, statePath: path.join(f.root, 'estado.json'), memoriesRoot: path.join(f.root, 'memorias'),
      now: () => Date.parse('2026-10-09T06:00:00Z'),
      analyze: async () => { calls++; return { complete: true, callsUsed: 1, analysis }; },
    });
    assert.equal((await scheduler.tick()).completed, 0);
    assert.equal(calls, 0);
    assert.equal(Object.keys((await scheduler.readState()).jobs).length, 0);
  } finally { await f.close(); }
});

test('preserva jobs distintos quando dois canais são agendados simultaneamente', async () => {
  const f = await setup();
  try {
    const scheduler = createConversationScheduler({
      archive: f.archive, statePath: path.join(f.root, 'estado.json'), memoriesRoot: path.join(f.root, 'memorias'),
      analyze: async () => ({ complete: true, callsUsed: 1, analysis }),
    });
    const scheduledAt = Date.parse('2026-10-10T17:16:00Z');
    await Promise.all([
      scheduler.schedule({ guildId: 'g1', channelId: 'c1', localDate: '2026-10-08', scheduledAt, requestedBy: 'u1' }),
      scheduler.schedule({ guildId: 'g1', channelId: 'c2', localDate: '2026-10-08', scheduledAt, requestedBy: 'u2' }),
    ]);
    const state = await scheduler.readState();
    assert.deepEqual(Object.keys(state.jobs).sort(), ['g1:c1:2026-10-08', 'g1:c2:2026-10-08']);
    assert.equal((await scheduler.listScheduledJobs()).length, 2);
  } finally { await f.close(); }
});

test('recupera no novo processo um agendamento vencido que estava persistido', async () => {
  const f = await setup();
  try {
    await f.archive.recordMessage(msg('target', '2026-10-09T02:59:00Z', 'conversa'));
    await f.archive.flush();
    const options = {
      archive: f.archive, statePath: path.join(f.root, 'estado.json'), memoriesRoot: path.join(f.root, 'memorias'),
      now: () => Date.parse('2026-10-09T06:00:00Z'),
    };
    const beforeRestart = createConversationScheduler({ ...options, analyze: async () => { throw new Error('job ainda não deve rodar'); } });
    await scheduleDay(beforeRestart);
    let calls = 0;
    const afterRestart = createConversationScheduler({ ...options, analyze: async () => { calls++; return { complete: true, callsUsed: 1, analysis }; } });
    assert.equal((await afterRestart.tick()).completed, 1);
    assert.equal(calls, 1);
    assert.equal((await afterRestart.readState()).jobs['g1:c1:2026-10-08'].status, 'completed');
  } finally { await f.close(); }
});

test('analisa um dia selecionado sem criar um arquivo bruto vazio', async () => {
  const f = await setup();
  try {
    let eventCount = 0;
    const scheduler = createConversationScheduler({
      archive: f.archive, statePath: path.join(f.root, 'estado.json'), memoriesRoot: path.join(f.root, 'memorias'),
      now: () => Date.parse('2026-10-09T06:00:00Z'),
      analyze: async ({ events }) => {
        for await (const _event of events) eventCount++;
        return { complete: true, callsUsed: 1, analysis };
      },
    });
    await scheduleDay(scheduler, '2026-10-07');
    assert.equal((await scheduler.tick()).completed, 1);
    assert.equal(eventCount, 0);
    await assert.rejects(fs.access(f.archive.filePath('g1', 'c1', '2026-10-07')));
    await fs.access(path.join(f.root, 'memorias', 'g1', 'c1', 'memoria-2026-10-07.md'));
  } finally { await f.close(); }
});

test('não publica nem envia resumo quando o limite de chamadas deixa a análise incompleta', async () => {
  const f = await setup();
  try {
    await f.archive.recordMessage(msg('target', '2026-10-09T02:59:00Z', 'conversa'));
    await f.archive.flush();
    let deliveries = 0;
    const scheduler = createConversationScheduler({
      archive: f.archive, statePath: path.join(f.root, 'estado.json'), memoriesRoot: path.join(f.root, 'memorias'),
      now: () => Date.parse('2026-10-09T06:00:00Z'), maxCallsPerAnalysis: 1,
      onComplete: async () => { deliveries++; },
      analyze: async ({ onCall }) => { await onCall(); return { complete: false, callsUsed: 1, analysis }; },
    });
    await scheduleDay(scheduler);
    assert.equal((await scheduler.tick()).completed, 0);
    assert.equal((await scheduler.readState()).jobs['g1:c1:2026-10-08'].status, 'failed');
    assert.equal(deliveries, 0);
    await assert.rejects(fs.access(path.join(f.root, 'memorias', 'g1', 'c1', 'memoria-2026-10-08.md')));
  } finally { await f.close(); }
});

test('scheduler analisa somente dias agendados, congela até 20 mensagens vizinhas e publica uma memória por canal', async () => {
  const f = await setup();
  try {
    await f.archive.recordMessage(msg('prev', '2026-10-08T02:59:00Z', 'contexto anterior'));
    await f.archive.recordMessage(msg('target', '2026-10-09T02:59:00Z', 'conversa do dia alvo'));
    await f.archive.recordMessage(msg('next', '2026-10-09T03:01:00Z', 'contexto posterior'));
    await f.archive.flush();
    let runs = 0;
    let targetSeen = [];
    const scheduler = createConversationScheduler({
      archive: f.archive, statePath: path.join(f.root, 'estado.json'), memoriesRoot: path.join(f.root, 'memorias'),
      now: () => Date.parse('2026-10-09T06:00:00Z'),
      analyze: async ({ events, context, workDir, metadata }) => {
        runs++;
        const seen = [];
        for await (const item of events) seen.push(item);
        if (metadata.localDate === '2026-10-08') {
          targetSeen = seen;
          assert.equal(seen.find((item) => item.messageId === 'prev').analysisRef, 'p0');
          assert.equal(seen.find((item) => item.messageId === 'target').analysisRef, 'e0');
          assert.equal(seen.find((item) => item.messageId === 'next').analysisRef, 'n0');
          assert.equal(context.previous.length, 1);
          assert.equal(context.next.length, 1);
        }
        assert.ok(workDir);
        return { complete: true, callsUsed: 1, analysis };
      },
    });
    await scheduleDay(scheduler, '2026-10-08');
    await scheduleDay(scheduler, '2026-10-09');
    assert.equal((await scheduler.tick()).completed, 2);
    assert.equal(targetSeen.filter((item) => item.type === 'message' && !item.contextRole).map((item) => item.messageId).join(','), 'target');
    assert.equal(targetSeen.find((item) => item.messageId === 'prev').contextRole, 'previous_day');
    assert.equal(targetSeen.find((item) => item.messageId === 'next').contextRole, 'next_day');
    assert.ok(await fs.readFile(path.join(f.root, 'memorias', 'g1', 'c1', 'memoria-2026-10-08.md'), 'utf8').then((text) => text.includes('Resumo do canal.')));
    const completed = await scheduler.readState();
    await assert.rejects(fs.access(completed.jobs['g1:c1:2026-10-08'].workDir));
    await scheduler.tick();
    assert.equal(runs, 2);
  } finally { await f.close(); }
});

test('reconcilia memória publicada após queda antes de marcar o job como concluído', async () => {
  const f = await setup();
  try {
    await f.archive.recordMessage(msg('target', '2026-10-09T02:59:00Z', 'conversa'));
    await f.archive.flush();
    const statePath = path.join(f.root, 'estado.json');
    const options = {
      archive: f.archive, statePath, memoriesRoot: path.join(f.root, 'memorias'),
      now: () => Date.parse('2026-10-09T06:00:00Z'), analyzerConfigHash: 'config-1',
    };
    const first = createConversationScheduler({ ...options, analyze: async () => ({ complete: true, callsUsed: 1, analysis }) });
    await scheduleDay(first);
    assert.equal((await first.tick()).completed, 1);
    const interrupted = await first.readState();
    interrupted.jobs['g1:c1:2026-10-08'].status = 'pending';
    interrupted.jobs['g1:c1:2026-10-08'].deliveryStatus = 'pending';
    await fs.writeFile(statePath, JSON.stringify(interrupted));
    let recoveredDm = 0;
    const second = createConversationScheduler({ ...options, onComplete: async () => { recoveredDm++; }, analyze: async () => { throw new Error('não deveria chamar o modelo'); } });
    assert.equal((await second.tick()).completed, 0);
    assert.equal((await second.readState()).jobs['g1:c1:2026-10-08'].status, 'completed');
    assert.equal(recoveredDm, 1);
  } finally { await f.close(); }
});

test('envia a memória somente ao solicitante e persiste a entrega por DM', async () => {
  const f = await setup();
  try {
    await f.archive.recordMessage(msg('target', '2026-10-09T02:59:00Z', 'conversa'));
    await f.archive.flush();
    const deliveries = [];
    const scheduler = createConversationScheduler({
      archive: f.archive, statePath: path.join(f.root, 'estado.json'), memoriesRoot: path.join(f.root, 'memorias'),
      now: () => Date.parse('2026-10-09T06:00:00Z'),
      onComplete: async (job, markdown) => deliveries.push({ requestedBy: job.requestedBy, markdown }),
      analyze: async () => ({ complete: true, callsUsed: 1, analysis }),
    });
    await scheduleDay(scheduler);
    assert.equal((await scheduler.tick()).completed, 1);
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].requestedBy, 'u1');
    assert.match(deliveries[0].markdown, /Resumo do canal\./);
    assert.equal((await scheduler.readState()).jobs['g1:c1:2026-10-08'].deliveryStatus, 'sent');
    await scheduler.tick();
    assert.equal(deliveries.length, 1);
  } finally { await f.close(); }
});

test('um novo agendamento explícito reanalisa o dia com a configuração atual', async () => {
  const f = await setup();
  try {
    await f.archive.recordMessage(msg('target', '2026-10-09T02:59:00Z', 'conversa'));
    await f.archive.flush();
    const base = {
      archive: f.archive, statePath: path.join(f.root, 'estado.json'), memoriesRoot: path.join(f.root, 'memorias'),
      now: () => Date.parse('2026-10-09T06:00:00Z'),
    };
    let firstWorkDir;
    const first = createConversationScheduler({ ...base, analyzerConfigHash: 'config-1', analyze: async ({ workDir }) => {
      firstWorkDir = workDir;
      return { complete: true, callsUsed: 1, analysis };
    } });
    await scheduleDay(first);
    assert.equal((await first.tick()).completed, 1);
    let reprocessCalls = 0;
    const revised = { ...analysis, summary: 'Resumo revisado.' };
    const defaultSecond = createConversationScheduler({ ...base, analyzerConfigHash: 'config-2', analyze: async () => { reprocessCalls++; return { complete: true, callsUsed: 1, analysis: revised }; } });
    await scheduleDay(defaultSecond);
    assert.equal((await defaultSecond.tick()).completed, 1);
    assert.equal(reprocessCalls, 1);
    const memory = await fs.readFile(path.join(f.root, 'memorias', 'g1', 'c1', 'memoria-2026-10-08.md'), 'utf8');
    assert.match(memory, /Resumo revisado\./);
    assert.match(memory, /config-2/);
    await assert.rejects(fs.access(firstWorkDir));
  } finally { await f.close(); }
});

test('marca gerações e análises de mídia abertas como interrompidas após reinício', async () => {
  const f = await setup();
  try {
    await f.archive.recordMessage(msg('target', '2026-10-09T02:59:00Z', 'conversa'));
    await f.archive.recordEvent({ type: 'generation_start', eventId: 'generation:g1:start', generationId: 'g1', guildId: 'g1', channelId: 'c1', createdAt: '2026-10-09T02:58:00Z', sourceMessageIds: ['target'] });
    await f.archive.recordEvent({ type: 'media_analysis_start', eventId: 'media:m1:start', mediaAnalysisId: 'm1', guildId: 'g1', channelId: 'c1', createdAt: '2026-10-09T02:57:00Z', sourceMessageId: 'target' });
    await f.archive.flush();
    const scheduler = createConversationScheduler({
      archive: f.archive, statePath: path.join(f.root, 'estado.json'), memoriesRoot: path.join(f.root, 'memorias'),
      now: () => Date.parse('2026-10-09T06:00:00Z'),
      analyze: async ({ events }) => {
        const seen = [];
        for await (const item of events) seen.push(item);
        assert.equal(seen.find((item) => item.type === 'generation_end').outcome, 'interrupted');
        assert.equal(seen.find((item) => item.type === 'media_analysis_end').status, 'interrupted');
        return { complete: true, callsUsed: 1, analysis };
      },
    });
    await scheduleDay(scheduler);
    assert.equal((await scheduler.tick()).completed, 1);
  } finally { await f.close(); }
});

test('adia a análise enquanto o canal ainda tem geração ou mídia em processamento', async () => {
  const f = await setup();
  try {
    await f.archive.recordMessage(msg('target', '2026-10-09T02:59:00Z', 'conversa'));
    await f.archive.flush();
    let idle = false;
    let calls = 0;
    const scheduler = createConversationScheduler({
      archive: f.archive, statePath: path.join(f.root, 'estado.json'), memoriesRoot: path.join(f.root, 'memorias'),
      now: () => Date.parse('2026-10-09T06:00:00Z'), isJobIdle: () => idle,
      analyze: async () => { calls++; return { complete: true, callsUsed: 1, analysis }; },
    });
    await scheduleDay(scheduler);
    assert.equal((await scheduler.tick()).completed, 0);
    assert.equal(calls, 0);
    idle = true;
    assert.equal((await scheduler.tick()).completed, 1);
    assert.equal(calls, 1);
  } finally { await f.close(); }
});

test('memória identifica captura parcial após desconexão conhecida', async () => {
  const f = await setup();
  try {
    await f.archive.recordMessage(msg('target', '2026-10-09T02:59:00Z', 'conversa'));
    await f.archive.recordStatus({ guildId: 'g1', channelId: 'c1', localDate: '2026-10-08', status: 'disconnected', observedAt: '2026-10-08T22:00:00.000Z' });
    await f.archive.flush();
    const scheduler = createConversationScheduler({
      archive: f.archive, statePath: path.join(f.root, 'estado.json'), memoriesRoot: path.join(f.root, 'memorias'),
      now: () => Date.parse('2026-10-09T06:00:00Z'),
      analyze: async () => ({ complete: true, callsUsed: 1, analysis }),
    });
    await scheduleDay(scheduler);
    assert.equal((await scheduler.tick()).completed, 1);
    const memory = await fs.readFile(path.join(f.root, 'memorias', 'g1', 'c1', 'memoria-2026-10-08.md'), 'utf8');
    assert.match(memory, /captura parcial/);
    assert.match(memory, /captura disconnected/);
  } finally { await f.close(); }
});

test('não publica memória se o arquivo do dia muda durante a análise', async () => {
  const f = await setup();
  try {
    await f.archive.recordMessage(msg('target', '2026-10-09T02:59:00Z', 'original'));
    await f.archive.flush();
    const scheduler = createConversationScheduler({
      archive: f.archive, statePath: path.join(f.root, 'estado.json'), memoriesRoot: path.join(f.root, 'memorias'),
      now: () => Date.parse('2026-10-09T06:00:00Z'),
      analyze: async () => {
        await f.archive.recordMessage(msg('late', '2026-10-09T02:58:00Z', 'anexo tardio'));
        await f.archive.flush();
        return { complete: true, callsUsed: 1, analysis };
      },
    });
    await scheduleDay(scheduler);
    assert.equal((await scheduler.tick()).completed, 0);
    await assert.rejects(fs.access(path.join(f.root, 'memorias', 'g1', 'c1', 'memoria-2026-10-08.md')));
    assert.equal((await scheduler.readState()).jobs['g1:c1:2026-10-08'].status, 'pending');
  } finally { await f.close(); }
});

test('agenda retries em instantes persistidos, mesmo depois da virada local do dia', async () => {
  const f = await setup();
  try {
    await f.archive.recordMessage(msg('target', '2026-10-09T02:59:00Z', 'conversa'));
    await f.archive.flush();
    let current = Date.parse('2026-10-09T06:00:00Z');
    let calls = 0;
    const scheduler = createConversationScheduler({
      archive: f.archive, statePath: path.join(f.root, 'estado.json'), memoriesRoot: path.join(f.root, 'memorias'),
      now: () => current,
      analyze: async () => { calls++; throw new Error('falha simulada'); },
    });
    await scheduleDay(scheduler);
    await scheduler.tick();
    current += 5 * 60_000;
    await scheduler.tick();
    const job = (await scheduler.readState()).jobs['g1:c1:2026-10-08'];
    assert.equal(calls, 2);
    assert.equal(job.attempts, 2);
    assert.equal(job.nextAttemptAt, current + 15 * 60_000);
  } finally { await f.close(); }
});
