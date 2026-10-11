import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createConversationArchive } from '../src/conversation-archive.js';
import { createConversationScheduler } from '../src/conversation-scheduler.js';
import { runAnalysisFromFile } from '../src/conversation-analysis.js';

test('agendador disponibiliza fonte ordenada com contexto e publica memória da análise por arquivo', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'conversation-file-integration-'));
  try {
    const archive = createConversationArchive({ root: path.join(root, 'conversas') });
    const message = (id, createdAt, content) => ({ id, guildId: 'g1', channelId: 'c1', createdTimestamp: Date.parse(createdAt), content, author: { username: 'autor' } });
    // Captura fora de ordem, como pode acontecer com eventos concorrentes.
    await archive.recordMessage(message('last', '2026-10-08T20:00:00Z', 'última mensagem'));
    await archive.recordMessage(message('first', '2026-10-08T10:00:00Z', 'primeira mensagem'));
    await archive.recordMessage(message('previous', '2026-10-08T02:59:00Z', 'contexto anterior'));
    await archive.recordMessage(message('next', '2026-10-09T03:01:00Z', 'contexto posterior'));
    let calls = 0;
    let delivered = 0;
    const scheduler = createConversationScheduler({
      archive, statePath: path.join(root, 'state.json'), memoriesRoot: path.join(root, 'memorias'),
      now: () => Date.parse('2026-10-09T06:00:00Z'),
      analyze: (options) => runAnalysisFromFile({ ...options, call: async (prompt, meta) => {
        calls++;
        const input = JSON.parse(prompt);
        assert.equal(input.metadata.localDate, '2026-10-08');
        const records = (await fs.readFile(input.conversationFile, 'utf8')).trim().split('\n').map(JSON.parse);
        assert.deepEqual(records.filter((r) => r.recordType === 'event').map((r) => r.sourceRole), ['previous_day', 'target', 'target', 'next_day']);
        assert.deepEqual(records.filter((r) => r.field === 'content').map((r) => r.text), ['contexto anterior', 'primeira mensagem', 'última mensagem', 'contexto posterior']);
        assert.equal(meta.workDir, path.dirname(input.conversationFile));
        return JSON.stringify({ summary: 'Resumo do dia completo.', topics: [{ name: 'Conversa', summary: 'Fim do dia.', evidence: [{ eventId: 'e1', quote: 'última mensagem' }] }], interactions: [], worked: [], failed: [], promptChanges: [], codeChanges: [], limitations: [] });
      } }),
      onComplete: async (job, markdown) => {
        delivered++;
        assert.equal(job.status, 'completed');
        assert.match(markdown, /última mensagem/);
        assert.equal(job.coverage.messageCount, 2);
      },
      onError: (error) => { throw error; },
    });
    await scheduler.schedule({ guildId: 'g1', channelId: 'c1', localDate: '2026-10-08', scheduledAt: Date.parse('2026-10-09T05:00:00Z'), requestedBy: 'u1' });
    assert.equal((await scheduler.tick()).completed, 1);
    assert.equal(calls, 1);
    assert.equal(delivered, 1);
    const job = (await scheduler.readState()).jobs['g1:c1:2026-10-08'];
    assert.equal(job.callsUsed, 1);
    assert.equal(job.deliveryStatus, 'sent');
    assert.match(await fs.readFile(job.memoryPath, 'utf8'), /Resumo do dia completo/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
