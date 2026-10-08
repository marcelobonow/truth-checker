import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createConversationArchive, localDateInZone } from '../src/conversation-archive.js';

async function fixture(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'conversation-archive-'));
  const archive = createConversationArchive({ root, ...options });
  return { root, archive, close: async () => { await archive.flush(); await fs.rm(root, { recursive: true, force: true }); } };
}

function message({ id, guildId = 'g1', channelId = 'c1', authorId = 'u1', timestamp = '2026-10-09T02:59:59.000Z', content = 'linha 1\nlinha 2' } = {}) {
  const createdTimestamp = Date.parse(timestamp);
  return {
    id, guildId, channelId, createdTimestamp, content, cleanContent: content,
    guild: { id: guildId, name: 'Servidor' }, channel: { id: channelId, name: 'geral', parentId: null },
    author: { id: authorId, username: authorId, displayName: authorId, bot: authorId === 'bot' },
    member: { displayName: authorId }, mentions: { users: new Map(), roles: new Map() },
    attachments: new Map(), embeds: [], reference: null, webhookId: null,
  };
}

test('localDateInZone usa o fuso configurado ao redor da meia-noite', () => {
  assert.equal(localDateInZone(Date.parse('2026-10-09T02:59:59.000Z'), 'America/Sao_Paulo'), '2026-10-08');
  assert.equal(localDateInZone(Date.parse('2026-10-09T03:00:00.000Z'), 'America/Sao_Paulo'), '2026-10-09');
});

test('captura conteúdo integral por servidor/canal/dia e deduplica retorno do send após reinício', async () => {
  const f = await fixture();
  try {
    const original = message({ id: '100' });
    assert.equal(await f.archive.recordMessage(original, { botId: 'bot' }), true);
    await f.archive.flush();
    const restarted = createConversationArchive({ root: f.root });
    assert.equal(await restarted.recordMessage(original, { botId: 'bot' }), false);
    assert.equal(await restarted.recordMessage(message({ id: '101', guildId: 'g2' }), { botId: 'bot' }), true);
    assert.equal(await restarted.recordMessage(message({ id: '102', channelId: 'c2' }), { botId: 'bot' }), true);
    assert.equal(await restarted.recordMessage(message({ id: '103', authorId: 'bot', content: 'b'.repeat(350) }), { botId: 'bot' }), true);
    await restarted.flush();
    const first = await fs.readFile(f.archive.filePath('g1', 'c1', '2026-10-08'), 'utf8');
    const events = first.trim().split('\n').map(JSON.parse);
    assert.equal(events.filter((event) => event.messageId === '100').length, 1);
    assert.equal(events.length, 2);
    const event = events.find((event) => event.messageId === '100');
    assert.equal(event.content, 'linha 1\nlinha 2');
    assert.equal(event.cleanContent.length > 0, true);
    assert.equal(await fs.readFile(f.archive.filePath('g2', 'c1', '2026-10-08'), 'utf8').then((x) => x.split('\n').length), 2);
    const botEvent = events.find((event) => event.messageId === '103');
    assert.equal(botEvent.content.length, 350);
    assert.equal(botEvent.authorIsBot, true);
    assert.equal(botEvent.isOwnBot, true);
    assert.deepEqual((await restarted.listRecordedChannels()).map((x) => `${x.guildId}:${x.channelId}`).sort(), ['g1:c1', 'g1:c2', 'g2:c1']);
    await restarted.flush();
  } finally { await f.close(); }
});

test('captura metadados seguros do evento e grava lacuna quando a fila descarta registros', async () => {
  const f = await fixture();
  try {
    const source = message({ id: 'metadata', content: 'conteúdo' });
    source.type = 19;
    source.pinned = true;
    source.flags = { bitfield: 4 };
    source.stickers = new Map([['s1', { id: 's1', name: 'adesivo', format: 1 }]]);
    source.attachments = new Map([['a1', { id: 'a1', name: 'foto.png', url: 'https://cdn.invalid/foto.png', contentType: 'image/png', size: 123 }]]);
    await f.archive.recordMessage(source);
    await f.archive.flush();
    const saved = JSON.parse(await fs.readFile(f.archive.filePath('g1', 'c1', '2026-10-08'), 'utf8'));
    assert.equal(saved.messageType, 19);
    assert.equal(saved.pinned, true);
    assert.equal(saved.flags, 4);
    assert.equal(saved.stickers[0].name, 'adesivo');
    assert.equal(saved.attachments[0].contentType, 'image/png');

    const pressured = await fixture({ maxQueueBytes: 1 });
    try {
      await pressured.archive.recordEvent({ type: 'decision', guildId: 'g1', channelId: 'c1', localDate: '2026-10-08', eventId: 'lost' });
      assert.equal(await pressured.archive.flush(), true);
      const records = (await fs.readFile(pressured.archive.filePath('g1', 'c1', '2026-10-08'), 'utf8')).trim().split('\n').map(JSON.parse);
      assert.equal(records.length, 1);
      assert.equal(records[0].status, 'gap');
      assert.equal(records[0].lostRecords, 1);
    } finally { await pressured.close(); }
  } finally { await f.close(); }
});

test('filtra DM e canais fora da lista, e inclui threads cujo pai está acompanhado', async () => {
  const f = await fixture({ watchChannelIds: ['parent'] });
  try {
    assert.equal(await f.archive.recordMessage(message({ id: '1', channelId: 'other' })), false);
    assert.equal(await f.archive.recordMessage({ ...message({ id: '2' }), guildId: null, guild: null }), false);
    const thread = message({ id: '3', channelId: 'thread' });
    thread.channel.parentId = 'parent';
    thread.channel.isThread = () => true;
    assert.equal(await f.archive.recordMessage(thread), true);
    await f.archive.flush();
    const saved = JSON.parse(await fs.readFile(f.archive.filePath('g1', 'thread', '2026-10-08'), 'utf8'));
    assert.equal(saved.parentChannelId, 'parent');
  } finally { await f.close(); }
});

test('contexto vizinho seleciona apenas eventos message e mantém ordem cronológica', async () => {
  const f = await fixture();
  try {
    for (let i = 1; i <= 22; i++) await f.archive.recordMessage(message({ id: String(i), timestamp: `2026-10-08T${String(10 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`, content: `p${i}` }));
    await f.archive.recordEvent({ type: 'decision', guildId: 'g1', channelId: 'c1', localDate: '2026-10-08', eventId: 'd1', observedAt: new Date().toISOString() });
    await f.archive.recordMessage(message({ id: 'next', timestamp: '2026-10-10T03:01:00.000Z', content: 'posterior' }));
    await f.archive.flush();
    const ctx = await f.archive.neighbors({ guildId: 'g1', channelId: 'c1', localDate: '2026-10-09', limit: 20 });
    assert.deepEqual(ctx.previous.map((x) => x.content), Array.from({ length: 20 }, (_, i) => `p${i + 3}`));
    assert.deepEqual(ctx.next.map((x) => x.content), ['posterior']);
  } finally { await f.close(); }
});

test('contexto de virada escolhe as mensagens realmente mais próximas, mesmo com captura fora de ordem', async () => {
  const f = await fixture();
  try {
    await f.archive.recordMessage(message({ id: 'prev-late', timestamp: '2026-10-08T20:00:00.000Z', content: 'última anterior' }));
    await f.archive.recordMessage(message({ id: 'prev-old', timestamp: '2026-10-08T12:00:00.000Z', content: 'mais antiga' }));
    await f.archive.recordMessage(message({ id: 'next-late', timestamp: '2026-10-10T20:00:00.000Z', content: 'posterior mais tarde' }));
    await f.archive.recordMessage(message({ id: 'next-first', timestamp: '2026-10-10T04:00:00.000Z', content: 'primeira posterior' }));
    await f.archive.flush();
    const ctx = await f.archive.neighbors({ guildId: 'g1', channelId: 'c1', localDate: '2026-10-09', limit: 1 });
    assert.deepEqual(ctx.previous.map((item) => item.content), ['última anterior']);
    assert.deepEqual(ctx.next.map((item) => item.content), ['primeira posterior']);
  } finally { await f.close(); }
});

test('recupera cauda JSON incompleta e rejeita corrupção no meio do arquivo', async () => {
  const f = await fixture();
  try {
    const file = f.archive.filePath('g1', 'c1', '2026-10-08');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{"eventId":"ok"}\n{"broken":');
    await f.archive.recordEvent({ type: 'decision', guildId: 'g1', channelId: 'c1', localDate: '2026-10-08', eventId: 'next' });
    await f.archive.flush();
    assert.equal((await fs.readFile(file, 'utf8')).split('\n').length, 3);
    assert.ok(await fs.stat(`${file}.corrupt`).then(() => true, () => false));
    await fs.writeFile(file, '{broken}\n{"eventId":"last"}\n');
    await assert.rejects(async () => { for await (const _ of f.archive.iterateDay({ guildId: 'g1', channelId: 'c1', localDate: '2026-10-08' })) {} }, /linha 1/);
  } finally { await f.close(); }
});
