import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createOrderedJsonlSnapshot } from '../src/conversation-order.js';

test('ordena JSONL grande em runs limitados, com IDs Discord exatos e limpeza temporária', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'conversation-order-'));
  try {
    const source = path.join(root, 'source.jsonl');
    const output = path.join(root, 'ordered.jsonl');
    const tempDir = path.join(root, 'sort-temp');
    const events = [
      { type: 'message', eventId: 'm-high', messageId: '90071992547409930', createdAt: '2026-10-08T14:00:00.000Z', content: 'high' },
      { type: 'message', eventId: 'm-old', messageId: '90071992547409999', createdAt: '2026-10-08T13:00:00.000Z', content: 'old' },
      { type: 'generation_start', eventId: 'g:start', createdAt: '2026-10-08T14:00:00.000Z', observedAt: '2026-10-08T14:00:00.001Z' },
      { type: 'generation_end', eventId: 'g:end', createdAt: '2026-10-08T14:00:00.000Z', observedAt: '2026-10-08T14:00:00.002Z' },
      { type: 'message', eventId: 'm-low', messageId: '90071992547409929', createdAt: '2026-10-08T14:00:00.000Z', content: 'low' },
    ];
    await fs.writeFile(source, `${events.map(JSON.stringify).join('\n')}\n`);
    await createOrderedJsonlSnapshot(source, output, { tempDir, chunkBytes: 256, maxOpenFiles: 2 });
    const ordered = (await fs.readFile(output, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(ordered.map((event) => event.eventId), ['m-old', 'm-low', 'm-high', 'g:start', 'g:end']);
    await assert.rejects(fs.access(tempDir));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
