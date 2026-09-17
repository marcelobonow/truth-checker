import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMode, shouldHandle, sessionKey, buildUserMessage, isNoReply, askClaude } from '../src/bridge.js';

const config = {
  targetUserIds: ['u1', 'u3'],
  fullAccessGuildIds: ['g-full'],
  watchChannelIds: [],
  mentionAnyone: true,
  workDir: 'C:\work',
  webDir: 'C:\bot',
  bin: 'claude',
  timeoutMs: 1000,
  extraPrompt: { web: 'Premissa: X.', full: 'Programação.' },
};

test('resolveMode: usuário-alvo em guild whitelisted é full; fora dela, web; outras pessoas sempre web', () => {
  assert.equal(resolveMode({ guildId: 'g-full', isTarget: true }, config), 'full');
  assert.equal(resolveMode({ guildId: 'g-other', isTarget: true }, config), 'web');
  assert.equal(resolveMode({ guildId: 'g-full', isTarget: false }, config), 'web');
});

test('shouldHandle: usuário-alvo em servidor, sem ser bot', () => {
  const base = { authorId: 'u1', isBot: false, guildId: 'g', channelId: 'c', mentionsBot: false };
  assert.equal(shouldHandle(base, config), true);
  assert.equal(shouldHandle({ ...base, isBot: true }, config), false);
  assert.equal(shouldHandle({ ...base, guildId: null }, config), false);
});

test('shouldHandle: outra pessoa só quando menciona o bot e MENTION_ANYONE está ligado', () => {
  const other = { authorId: 'u2', isBot: false, guildId: 'g', channelId: 'c', mentionsBot: false };
  assert.equal(shouldHandle(other, config), false);
  assert.equal(shouldHandle({ ...other, mentionsBot: true }, config), true);
  assert.equal(shouldHandle({ ...other, mentionsBot: true }, { ...config, mentionAnyone: false }), false);
});

test('shouldHandle: WATCH_CHANNEL_IDS restringe os canais', () => {
  const msg = { authorId: 'u1', isBot: false, guildId: 'g', channelId: 'c2', mentionsBot: false };
  assert.equal(shouldHandle(msg, { ...config, watchChannelIds: ['c1'] }), false);
  assert.equal(shouldHandle(msg, { ...config, watchChannelIds: ['c1', 'c2'] }), true);
});

test('sessionKey: guild para o usuário-alvo, guild:public para os demais', () => {
  assert.equal(sessionKey({ guildId: 'g', isTarget: true }), 'g');
  assert.equal(sessionKey({ guildId: 'g', isTarget: false }), 'g:public');
});

test('buildUserMessage: uma mensagem, julgamento', () => {
  const text = buildUserMessage({
    guildName: 'Meu Server', channelName: 'geral', authorName: 'marcelo',
    items: [{ content: 'node 24 é LTS?', replyToBot: false, mentionsBot: false, quoted: null }],
  });
  assert.equal(text, '[discord] servidor: Meu Server | canal: #geral | autor: marcelo | responder: se couber\nnode 24 é LTS?');
});

test('buildUserMessage: várias mensagens numeradas, citação, e "sempre" se alguma for reply ao bot ou menção', () => {
  const text = buildUserMessage({
    guildName: 'S', channelName: 'c', authorName: 'a',
    items: [
      { content: 'primeira', replyToBot: false, mentionsBot: false, quoted: null },
      { content: 'não, ainda não é', replyToBot: false, mentionsBot: false, quoted: { author: 'joao', content: 'acho que é' } },
      { content: 'e aí?', replyToBot: true, mentionsBot: false, quoted: null },
    ],
  });
  assert.equal(text, [
    '[discord] servidor: S | canal: #c | autor: a | responder: sempre',
    '1. primeira',
    '2. (em resposta a joao: "acho que é") não, ainda não é',
    '3. e aí?',
  ].join('\n'));
});

test('isNoReply reconhece o sentinela com espaços, pontuação ou crase em volta', () => {
  assert.equal(isNoReply('NO_REPLY'), true);
  assert.equal(isNoReply('  `NO_REPLY`. \n'), true);
  assert.equal(isNoReply('NO_REPLY, mas na verdade sim: ...'), false);
  assert.equal(isNoReply('Olá!'), false);
  assert.equal(isNoReply(''), false);
});

function memoryStore() {
  const map = new Map();
  return { get: (k) => map.get(k), set: (k, v) => map.set(k, v), clear: (k) => map.delete(k) };
}

function stubRunner(handler) {
  const calls = [];
  const runner = async (opts) => {
    calls.push(opts);
    return handler(opts, calls.length);
  };
  runner.calls = calls;
  return runner;
}

const ok = (sessionId) => ({ text: 'resposta', sessionId, isError: false, subtype: 'success' });

test('askClaude: primeira chamada sem --resume e salva a sessão; segunda usa --resume', async () => {
  const store = memoryStore();
  const runner = stubRunner(() => ok('s1'));
  await askClaude({ key: 'g', mode: 'web', prompt: 'oi', store, config, runner });
  await askClaude({ key: 'g', mode: 'web', prompt: 'de novo', store, config, runner });
  assert.ok(!runner.calls[0].args.includes('--resume'));
  assert.equal(runner.calls[1].args[runner.calls[1].args.indexOf('--resume') + 1], 's1');
  assert.equal(store.get('g'), 's1');
});

test('askClaude: full usa workDir e bypass; web usa webDir e --tools; prompt extra e bin/timeout chegam ao runner', async () => {
  const store = memoryStore();
  const runner = stubRunner(() => ok('s1'));
  await askClaude({ key: 'g', mode: 'full', prompt: 'oi', store, config, runner });
  await askClaude({ key: 'g2', mode: 'web', prompt: 'oi', store, config, runner });
  const [full, web] = runner.calls;
  assert.equal(full.cwd, 'C:\work');
  assert.ok(full.args.includes('--dangerously-skip-permissions'));
  assert.equal(web.cwd, 'C:\bot');
  assert.ok(web.args.includes('--tools'));
  assert.ok(web.args[web.args.indexOf('--append-system-prompt') + 1].endsWith('Premissa: X.'));
  assert.ok(full.args[full.args.indexOf('--append-system-prompt') + 1].endsWith('Programação.'));
  assert.equal(web.prompt, 'oi');
  assert.equal(web.bin, 'claude');
  assert.equal(web.timeoutMs, 1000);
});

test('askClaude: sessão inválida → limpa, repete sem --resume e salva a nova', async () => {
  const store = memoryStore();
  store.set('g', 'velha');
  const runner = stubRunner((opts) => {
    if (opts.args.includes('--resume')) throw new Error('claude saiu com código 1: No conversation found with session ID: velha');
    return ok('nova');
  });
  const res = await askClaude({ key: 'g', mode: 'web', prompt: 'oi', store, config, runner });
  assert.equal(res.text, 'resposta');
  assert.equal(runner.calls.length, 2);
  assert.equal(store.get('g'), 'nova');
});

test('askClaude: outra falha propaga o erro e mantém a sessão', async () => {
  const store = memoryStore();
  store.set('g', 's1');
  const runner = stubRunner(() => { throw new Error('claude excedeu o tempo limite de 1000 ms'); });
  await assert.rejects(askClaude({ key: 'g', mode: 'web', prompt: 'oi', store, config, runner }), /tempo limite/);
  assert.equal(runner.calls.length, 1);
  assert.equal(store.get('g'), 's1');
});

test('askClaude: falha genérica cujo texto contém "session_id" NÃO é tratada como sessão inválida', async () => {
  const store = memoryStore();
  store.set('g', 's1');
  const runner = stubRunner(() => { throw new Error('claude saiu com código 1: {"session_id":"s1","is_error":true}'); });
  await assert.rejects(askClaude({ key: 'g', mode: 'web', prompt: 'oi', store, config, runner }));
  assert.equal(runner.calls.length, 1);
  assert.equal(store.get('g'), 's1');
});

test('askClaude: modelo e esforço por modo chegam aos args quando configurados', async () => {
  const store = memoryStore();
  const runner = stubRunner(() => ok('s1'));
  const cfg = { ...config, model: { web: 'sonnet' }, effort: { web: 'low' } };
  await askClaude({ key: 'g', mode: 'web', prompt: 'oi', store, config: cfg, runner });
  await askClaude({ key: 'g2', mode: 'full', prompt: 'oi', store, config: cfg, runner });
  const [web, full] = runner.calls;
  assert.equal(web.args[web.args.indexOf('--model') + 1], 'sonnet');
  assert.equal(web.args[web.args.indexOf('--effort') + 1], 'low');
  assert.ok(!full.args.includes('--model') && !full.args.includes('--effort'));
});

test('askClaude: detecta sessão inválida no stderr completo, mesmo com ruído antes da frase', async () => {
  const store = memoryStore();
  store.set('g', 'velha');
  const runner = stubRunner((opts) => {
    if (opts.args.includes('--resume')) {
      const err = new Error('claude saiu com código 1: ' + 'x'.repeat(500));
      err.stderr = 'aviso '.repeat(120) + 'No conversation found with session ID: velha';
      throw err;
    }
    return ok('nova');
  });
  await askClaude({ key: 'g', mode: 'web', prompt: 'oi', store, config, runner });
  assert.equal(runner.calls.length, 2);
  assert.equal(store.get('g'), 'nova');
});

test('shouldHandle: qualquer usuário da whitelist é atendido', () => {
  const base = { isBot: false, guildId: 'g', channelId: 'c', mentionsBot: false };
  assert.equal(shouldHandle({ ...base, authorId: 'u3' }, config), true);
  assert.equal(shouldHandle({ ...base, authorId: 'u2' }, config), false);
});

import { selectContext } from '../src/bridge.js';

const msg = (id, authorId, ts, content = `m${id}`) => ({ id, authorId, authorName: authorId, content, timestamp: ts });

test('selectContext: últimas N do canal + últimas M do autor, sem duplicar, em ordem cronológica', () => {
  // 20 mensagens; autor 'a' escreveu nas ímpares até a 9, depois só outros
  const history = [];
  for (let i = 1; i <= 20; i++) history.push(msg(String(i), i <= 9 && i % 2 ? 'a' : 'b', i));
  const ctx = selectContext(history, { channel: 3, author: 2, authorId: 'a', excludeIds: [] });
  assert.deepEqual(ctx.map((m) => m.id), ['7', '9', '18', '19', '20']);
});

test('selectContext: exclui as mensagens do próprio lote e as vazias', () => {
  const history = [msg('1', 'a', 1), msg('2', 'b', 2, ''), msg('3', 'a', 3), msg('4', 'b', 4)];
  const ctx = selectContext(history, { channel: 10, author: 5, authorId: 'a', excludeIds: ['3', '4'] });
  assert.deepEqual(ctx.map((m) => m.id), ['1']);
});

test('buildUserMessage: seção de contexto recente entre o cabeçalho e as mensagens novas', () => {
  const text = buildUserMessage({
    guildName: 'S', channelName: 'c', authorName: 'a',
    context: [{ authorName: 'joao', content: 'alguém viu o jogo?' }, { authorName: 'a', content: 'vi sim' }],
    items: [{ content: 'foi bom', replyToBot: false, mentionsBot: false, quoted: null }],
  });
  assert.equal(text, [
    '[discord] servidor: S | canal: #c | autor: a | responder: se couber',
    'contexto recente do canal (mais antigo primeiro):',
    '- joao: alguém viu o jogo?',
    '- a: vi sim',
    'mensagens novas:',
    'foi bom',
  ].join('\n'));
});

test('buildUserMessage: sem contexto, formato antigo (sem seções)', () => {
  const text = buildUserMessage({
    guildName: 'S', channelName: 'c', authorName: 'a', context: [],
    items: [{ content: 'oi', replyToBot: false, mentionsBot: false, quoted: null }],
  });
  assert.equal(text, '[discord] servidor: S | canal: #c | autor: a | responder: se couber\noi');
});

test('selectContext: autor com menos mensagens que o limite entra com o que tiver', () => {
  const history = [msg('1', 'a', 1), msg('2', 'b', 2), msg('3', 'b', 3), msg('4', 'b', 4), msg('5', 'a', 5)];
  const ctx = selectContext(history, { channel: 2, author: 5, authorId: 'a', excludeIds: [] });
  assert.deepEqual(ctx.map((m) => m.id), ['1', '4', '5']); // 2 últimas do canal (4, 5) + as 2 que 'a' tem (1, 5)
});

test('askClaude: repassa onEvent ao runner', async () => {
  const store = memoryStore();
  const runner = stubRunner(() => ok('s1'));
  const onEvent = () => {};
  await askClaude({ key: 'g', mode: 'web', prompt: 'oi', store, config, runner, onEvent });
  assert.equal(runner.calls[0].onEvent, onEvent);
});

function countingStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get: (k) => map.get(k)?.id,
    info: (k) => map.get(k),
    set: (k, id) => { if (map.get(k)?.id !== id) map.set(k, { id, messages: 0, lastUsed: 0 }); },
    touch: (k, n, now) => { const e = map.get(k); e.messages += n; e.lastUsed = now; },
    clear: (k) => map.delete(k),
    cleared: [],
  };
}

const sessionCfg = { ...config, session: { maxMessages: 400, idleMs: 60 * 60_000 } };

test('askClaude: contabiliza as mensagens enviadas (lote + contexto) na sessão', async () => {
  const store = countingStore();
  const runner = stubRunner(() => ok('s1'));
  await askClaude({ key: 'g', mode: 'web', prompt: 'oi', store, config: sessionCfg, runner, messageCount: 7, now: 5000 });
  assert.deepEqual(store.info('g'), { id: 's1', messages: 7, lastUsed: 5000 });
});

test('askClaude: acima de maxMessages, começa sessão nova (sem --resume) e informa o motivo', async () => {
  const store = countingStore({ g: { id: 'velha', messages: 401, lastUsed: 5000 } });
  const runner = stubRunner(() => ok('nova'));
  const res = await askClaude({ key: 'g', mode: 'web', prompt: 'oi', store, config: sessionCfg, runner, messageCount: 3, now: 6000 });
  assert.ok(!runner.calls[0].args.includes('--resume'));
  assert.equal(res.sessionReset, 'mensagens');
  assert.deepEqual(store.info('g'), { id: 'nova', messages: 3, lastUsed: 6000 });
});

test('askClaude: sessão parada há mais de idleMs começa nova', async () => {
  const store = countingStore({ g: { id: 'velha', messages: 10, lastUsed: 0 } });
  const runner = stubRunner(() => ok('nova'));
  const res = await askClaude({ key: 'g', mode: 'web', prompt: 'oi', store, config: sessionCfg, runner, messageCount: 1, now: 61 * 60_000 });
  assert.ok(!runner.calls[0].args.includes('--resume'));
  assert.equal(res.sessionReset, 'inatividade');
});

test('askClaude: dentro dos limites, retoma a sessão', async () => {
  const store = countingStore({ g: { id: 'atual', messages: 399, lastUsed: 0 } });
  const runner = stubRunner(() => ok('atual'));
  const res = await askClaude({ key: 'g', mode: 'web', prompt: 'oi', store, config: sessionCfg, runner, messageCount: 1, now: 59 * 60_000 });
  assert.equal(runner.calls[0].args[runner.calls[0].args.indexOf('--resume') + 1], 'atual');
  assert.equal(res.sessionReset, null);
  assert.equal(store.info('g').messages, 400);
});

import { skipReason } from '../src/bridge.js';

test('skipReason explica por que uma mensagem não é analisada', () => {
  const base = { authorId: 'u1', isBot: false, guildId: 'g', channelId: 'c', mentionsBot: false };
  assert.equal(skipReason(base, config), null);
  assert.equal(skipReason({ ...base, isBot: true }, config), 'autor é bot');
  assert.equal(skipReason({ ...base, guildId: null }, config), 'fora de servidor (DM)');
  assert.equal(skipReason(base, { ...config, watchChannelIds: ['x'] }), 'canal fora de WATCH_CHANNEL_IDS');
  assert.equal(skipReason({ ...base, authorId: 'u2' }, config), 'usuário fora da whitelist e sem menção ao bot');
  assert.equal(skipReason({ ...base, authorId: 'u2', mentionsBot: true }, { ...config, mentionAnyone: false }), 'usuário fora da whitelist (MENTION_ANYONE desligado)');
});

test('askClaude: AbortError propaga sem tentar de novo e repassa o signal ao runner', async () => {
  const store = memoryStore();
  store.set('g', 's1');
  const controller = new AbortController();
  const runner = stubRunner(() => {
    const err = new Error('abortado');
    err.name = 'AbortError';
    err.stderr = 'No conversation found with session ID: s1'; // mesmo assim não repete
    throw err;
  });
  await assert.rejects(askClaude({ key: 'g', mode: 'web', prompt: 'oi', store, config, runner, signal: controller.signal }), (e) => e.name === 'AbortError');
  assert.equal(runner.calls.length, 1);
  assert.equal(runner.calls[0].signal, controller.signal);
  assert.equal(store.get('g'), 's1');
});

import { parseDirective } from '../src/bridge.js';

test('selectContext: authorIds inclui as últimas M de cada pessoa citada', () => {
  const history = [msg('1', 'c', 1), msg('2', 'a', 2), msg('3', 'c', 3), msg('4', 'b', 4), msg('5', 'b', 5), msg('6', 'b', 6)];
  const ctx = selectContext(history, { channel: 1, author: 1, authorIds: ['a', 'c'], excludeIds: [] });
  assert.deepEqual(ctx.map((m) => m.id), ['2', '3', '6']); // última de a (2), última de c (3), última do canal (6)
});

test('buildUserMessage: pessoas citadas e contexto com índices #n (lote da whitelist)', () => {
  const text = buildUserMessage({
    guildName: 'S', channelName: 'c', authorName: 'a', indexed: true,
    mentions: [{ id: '111', name: 'Fulano' }, { id: '222', name: 'Beltrana' }],
    context: [{ authorName: 'Fulano', content: 'marx e o valor' }, { authorName: 'a', content: 'hm' }],
    items: [{ content: 'responda ao @Fulano', replyToBot: false, mentionsBot: false, quoted: null }],
  });
  assert.equal(text, [
    '[discord] servidor: S | canal: #c | autor: a | responder: se couber',
    'pessoas citadas: Fulano → <@111>, Beltrana → <@222>',
    'contexto recente do canal (mais antigo primeiro):',
    '- #1 Fulano: marx e o valor',
    '- #2 a: hm',
    'mensagens novas:',
    'responda ao @Fulano',
  ].join('\n'));
});

test('buildUserMessage: sem indexed, contexto sem índices e citados ignorados', () => {
  const text = buildUserMessage({
    guildName: 'S', channelName: 'c', authorName: 'a',
    mentions: [{ id: '111', name: 'Fulano' }],
    context: [{ authorName: 'Fulano', content: 'oi' }],
    items: [{ content: 'x', replyToBot: false, mentionsBot: false, quoted: null }],
  });
  assert.ok(!text.includes('pessoas citadas'));
  assert.ok(text.includes('- Fulano: oi'));
});

test('parseDirective: tira a linha [responder: #n] do começo e devolve o índice', () => {
  assert.deepEqual(parseDirective('[responder: #3]\nMarx diz que...'), { replyTo: 3, text: 'Marx diz que...' });
  assert.deepEqual(parseDirective('  [Responder: #12] \n\ntexto'), { replyTo: 12, text: 'texto' });
});

test('parseDirective: sem diretiva (ou fora da primeira linha) devolve o texto intacto', () => {
  assert.deepEqual(parseDirective('oi\n[responder: #3]'), { replyTo: null, text: 'oi\n[responder: #3]' });
  assert.deepEqual(parseDirective('só texto'), { replyTo: null, text: 'só texto' });
});
