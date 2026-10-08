import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createConversationLookup } from '../src/conversation-lookup.js';

test('consulta paginada fica limitada aos snapshots do job e persiste a cota', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'conversation-lookup-'));
  try {
    const targetFile = path.join(root, 'target.jsonl');
    await fs.writeFile(targetFile, [
      { eventId: 'message:1', type: 'message', content: 'um', localDate: '2026-10-08' },
      { eventId: 'message:2', type: 'message', content: 'dois', localDate: '2026-10-08' },
      { eventId: 'message:3', type: 'message', content: 'três', localDate: '2026-10-08' },
    ].map(JSON.stringify).join('\n') + '\n');
    const lookup = createConversationLookup({
      targetFile,
      previousEvents: [{ eventId: 'message:p', type: 'message', content: 'anterior', localDate: '2026-10-07' }],
      nextEvents: [{ eventId: 'message:n', type: 'message', content: 'posterior', localDate: '2026-10-09' }],
      statePath: path.join(root, 'lookup-state.json'),
      maxResults: 2,
      maxBytes: 2_000,
      maxQueries: 3,
    });

    const first = await lookup({ role: 'target', cursor: 0, limit: 2 });
    assert.deepEqual(first.events.map((item) => item.analysisRef), ['e0', 'e1']);
    assert.equal(first.nextCursor, 2);
    assert.equal(first.events.every((item) => item.sourceRole === 'target'), true);
    const second = await lookup({ role: 'target', cursor: first.nextCursor, limit: 2 });
    assert.deepEqual(second.events.map((item) => item.eventId), ['message:3']);
    assert.equal(second.nextCursor, null);
    const previous = await lookup({ role: 'previous_day', cursor: 0, limit: 1 });
    assert.equal(previous.events[0].sourceRole, 'previous_day');
    assert.equal(previous.events[0].analysisRef, 'p0');
    const repeated = await lookup({ role: 'target', cursor: 0, limit: 2 });
    assert.deepEqual(repeated.events.map((item) => item.analysisRef), ['e0', 'e1']);
    assert.equal(repeated.cached, true);
    await assert.rejects(lookup({ role: '../../etc', cursor: 0, limit: 1 }), /consulta inválida/);
    await assert.rejects(lookup({ role: 'target', cursor: 0, limit: 1 }), /limite de consultas/);
    const saved = JSON.parse(await fs.readFile(path.join(root, 'lookup-state.json'), 'utf8'));
    assert.equal(saved.queries.length, 3);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('consulta por alias e por mensagem referenciada não expõe path nem outros arquivos', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'conversation-lookup-'));
  try {
    const targetFile = path.join(root, 'target.jsonl');
    await fs.writeFile(targetFile, [
      { eventId: 'message:1', messageId: '1', type: 'message', content: 'origem' },
      { eventId: 'message:2', messageId: '2', type: 'message', content: 'reply', reference: { messageId: '1' } },
    ].map(JSON.stringify).join('\n') + '\n');
    const lookup = createConversationLookup({ targetFile, statePath: path.join(root, 'state.json') });
    assert.equal((await lookup({ ref: 'e1' })).events[0].content, 'reply');
    assert.equal((await lookup({ relatedTo: '1' })).events[0].messageId, '2');
    await assert.rejects(lookup({ path: path.join(root, 'secret.txt') }), /consulta inválida/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('consulta marca evento grande como truncado e permite ler uma faixa literal do campo', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'conversation-lookup-'));
  try {
    const targetFile = path.join(root, 'target.jsonl');
    await fs.writeFile(targetFile, `${JSON.stringify({ eventId: 'message:long', type: 'message', content: 'x'.repeat(20_000) })}\n`);
    const lookup = createConversationLookup({ targetFile, statePath: path.join(root, 'state.json'), maxBytes: 1_000, maxFieldChars: 600 });
    const summary = await lookup({ role: 'target', cursor: 0, limit: 1 });
    assert.equal(summary.events[0].truncated, true);
    assert.ok(summary.events[0].truncatedFields.includes('content'));
    const page = await lookup({ ref: 'e0', field: 'content', offset: 1_000, length: 500 });
    assert.equal(page.events[0].text, 'x'.repeat(500));
    assert.equal(page.events[0].fieldSlice.nextOffset, 1_500);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('relatedTo recupera a geração associada a uma análise de mídia e às mensagens entregues', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'conversation-lookup-'));
  try {
    const targetFile = path.join(root, 'target.jsonl');
    await fs.writeFile(targetFile, [
      { eventId: 'generation:start', type: 'generation_start', generationId: 'g1', sourceMessageIds: ['request'], mediaAnalysisIds: ['image:1'] },
      { eventId: 'generation:end', type: 'generation_end', generationId: 'g1', deliveredMessages: [{ messageId: 'reply', content: 'resposta' }] },
    ].map(JSON.stringify).join('\n') + '\n');
    const lookup = createConversationLookup({ targetFile, statePath: path.join(root, 'state.json') });
    assert.equal((await lookup({ relatedTo: 'image:1' })).events[0].generationId, 'g1');
    assert.equal((await lookup({ relatedTo: 'reply' })).events[0].eventId, 'generation:end');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
