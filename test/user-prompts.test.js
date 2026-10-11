import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags } from 'discord.js';
import { formatPromptList, replyPromptList } from '../src/user-prompts.js';

function mockInteraction({ failDm = false } = {}) {
  const sent = { replies: [], deferred: [], edits: [], dms: [] };
  return { sent,
    reply: async (message) => sent.replies.push(message),
    deferReply: async (message) => sent.deferred.push(message),
    editReply: async (message) => sent.edits.push(message),
    user: { send: async (message) => { if (failDm) throw new Error('DM bloqueada'); sent.dms.push(message); } },
  };
}

test('prompt-list mostra texto completo e multilinha em resposta efêmera', async () => {
  const interaction = mockInteraction();
  const prompt = 'Este prompt tem mais de vinte e cinco caracteres.\n  Segunda linha com @everyone e **texto**.';
  const rows = [{ userId: '123', prompt }, { userId: '456', prompt: 'Outro prompt completo.' }];
  await replyPromptList(interaction, rows);
  assert.equal(interaction.sent.replies[0].content, formatPromptList(rows));
  assert.ok(interaction.sent.replies[0].content.includes(prompt));
  assert.equal(interaction.sent.replies[0].flags, MessageFlags.Ephemeral);
  assert.deepEqual(interaction.sent.replies[0].allowedMentions, { parse: [] });
  assert.equal(interaction.sent.dms.length, 0);
});

test('lista com exatamente 2000 caracteres ainda usa resposta efêmera', async () => {
  const interaction = mockInteraction();
  const overhead = formatPromptList([{ userId: '123', prompt: '' }]).length;
  await replyPromptList(interaction, [{ userId: '123', prompt: 'a'.repeat(2000 - overhead) }]);
  assert.equal(interaction.sent.replies[0].content.length, 2000);
  assert.equal(interaction.sent.dms.length, 0);
});

test('lista acima do limite vai completa no privado de quem executou', async () => {
  const interaction = mockInteraction();
  const rows = [{ userId: '123', prompt: 'X'.repeat(2000) }, { userId: '456', prompt: 'fim da lista' }];
  await replyPromptList(interaction, rows);
  assert.equal(interaction.sent.replies.length, 0);
  assert.equal(interaction.sent.deferred[0].flags, MessageFlags.Ephemeral);
  assert.ok(interaction.sent.dms.length > 1);
  assert.ok(interaction.sent.dms.every((message) => message.content.length <= 2000));
  assert.equal(interaction.sent.dms.map((message) => message.content.match(/X+/g) ?? []).flat().join(''), rows[0].prompt);
  assert.ok(interaction.sent.dms.at(-1).content.includes('fim da lista'));
  assert.ok(interaction.sent.dms.every((message) => message.allowedMentions.parse.length === 0));
  assert.equal(interaction.sent.edits[0].content, 'Enviei os prompts completos no seu privado.');
});

test('DM bloqueada retorna aviso privado sem anunciar envio bem-sucedido', async () => {
  const interaction = mockInteraction({ failDm: true });
  let error;
  await replyPromptList(interaction, [{ userId: '123', prompt: 'a'.repeat(2000) }], { onError: (err) => { error = err; } });
  assert.equal(error.message, 'DM bloqueada');
  assert.match(interaction.sent.edits[0].content, /Não consegui enviar/);
  assert.equal(interaction.sent.replies.length, 0);
});

test('lista vazia informa ausência de prompts em resposta efêmera', async () => {
  const interaction = mockInteraction();
  await replyPromptList(interaction, []);
  assert.equal(interaction.sent.replies[0].content, 'Ninguém definiu um prompt personalizado.');
  assert.equal(interaction.sent.replies[0].flags, MessageFlags.Ephemeral);
});
