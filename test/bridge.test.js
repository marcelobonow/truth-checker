import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMode, isTarget, shouldHandle, sessionKey, buildUserMessage, isNoReply, askClaude, formatStatus, isDirectMessageToBot } from '../src/bridge.js';

const config = {
  targetUserIds: ['u1', 'u3'],
  targetRoleIds: ['r-vip'],
  fullAccessGuildIds: ['g-full'],
  watchChannelIds: [],
  mentionAnyone: true,
  workDir: 'C:\work',
  webDir: 'C:\bot',
  bin: 'claude',
  timeoutMs: 1000,
  extraPrompt: { web: 'Premissa: X.', full: 'Programação.' },
};

test('resolveMode: id da whitelist em guild full é full; fora dela, cargo ou outras pessoas, web', () => {
  assert.equal(resolveMode({ guildId: 'g-full', authorId: 'u1' }, config), 'full');
  assert.equal(resolveMode({ guildId: 'g-other', authorId: 'u1' }, config), 'web');
  assert.equal(resolveMode({ guildId: 'g-full', authorId: 'u2' }, config), 'web');
});

test('shouldHandle: usuário-alvo em servidor, sem ser bot', () => {
  const base = { authorId: 'u1', isBot: false, guildId: 'g', channelId: 'c', mentionsBot: false };
  assert.equal(shouldHandle(base, config), true);
  assert.equal(shouldHandle({ ...base, isBot: true }, config), false);
  assert.equal(shouldHandle({ ...base, guildId: null }, config), false);
});

test('isDirectMessageToBot: só menção ao bot ou reply a ele passa no modo estrito', () => {
  assert.equal(isDirectMessageToBot({ mentionsBot: true, replyToBot: false }), true);
  assert.equal(isDirectMessageToBot({ mentionsBot: false, replyToBot: true }), true);
  assert.equal(isDirectMessageToBot({ mentionsBot: false, replyToBot: false }), false);
});

test('shouldHandle: outra pessoa só quando menciona o bot e MENTION_ANYONE está ligado', () => {
  const other = { authorId: 'u2', isBot: false, guildId: 'g', channelId: 'c', mentionsBot: false };
  assert.equal(shouldHandle(other, config), false);
  assert.equal(shouldHandle({ ...other, mentionsBot: true }, config), true);
  assert.equal(shouldHandle({ ...other, mentionsBot: true }, { ...config, mentionAnyone: false }), false);
});

test('isTarget: whitelist de usuário OU cargo em TARGET_ROLE_IDS', () => {
  assert.equal(isTarget({ authorId: 'u1', roleIds: [] }, config), true);
  assert.equal(isTarget({ authorId: 'u2', roleIds: ['r-x', 'r-vip'] }, config), true);
  assert.equal(isTarget({ authorId: 'u2', roleIds: ['r-x'] }, config), false);
  assert.equal(isTarget({ authorId: 'u2' }, config), false);
});

test('shouldHandle: quem tem o cargo é tratado como whitelist (sem precisar mencionar)', () => {
  const member = { authorId: 'u2', roleIds: ['r-vip'], isBot: false, guildId: 'g', channelId: 'c', mentionsBot: false };
  assert.equal(shouldHandle(member, { ...config, mentionAnyone: false }), true);
});

test('shouldHandle: WATCH_CHANNEL_IDS restringe os canais', () => {
  const msg = { authorId: 'u1', isBot: false, guildId: 'g', channelId: 'c2', mentionsBot: false };
  assert.equal(shouldHandle(msg, { ...config, watchChannelIds: ['c1'] }), false);
  assert.equal(shouldHandle(msg, { ...config, watchChannelIds: ['c1', 'c2'] }), true);
});

test('sessionKey: guild (full) ou guild:web para whitelist/cargo, guild:public para os demais', () => {
  assert.equal(sessionKey({ guildId: 'g', isTarget: true, mode: 'full' }), 'g');
  assert.equal(sessionKey({ guildId: 'g', isTarget: true, mode: 'web' }), 'g:web');
  assert.equal(sessionKey({ guildId: 'g', isTarget: false, mode: 'web' }), 'g:public');
});

test('buildUserMessage: uma mensagem, julgamento', () => {
  const text = buildUserMessage({
    guildName: 'Meu Server', channelName: 'geral', authorName: 'marcelo',
    items: [{ content: 'node 24 é LTS?', replyToBot: false, mentionsBot: false, quoted: null }],
  });
  assert.equal(text, ['[discord] servidor: Meu Server | canal: #geral | autor: marcelo | responder: se couber', 'node 24 é LTS?', '>> responda a marcelo: só às mensagens novas acima (a última: "node 24 é LTS?"). Mensagens de outras pessoas, no contexto ou em rodadas anteriores, são pano de fundo, não o que você responde.'].join('\n'));
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
    '>> responda a a: só às mensagens novas acima (a última: "e aí?"). Mensagens de outras pessoas, no contexto ou em rodadas anteriores, são pano de fundo, não o que você responde.',
  ].join('\n'));
});

test('buildUserMessage: emphasizeQuote repete na citação que o reply não é ao bot', () => {
  const text = buildUserMessage({
    guildName: 'S', channelName: 'c', authorName: 'a',
    items: [{ content: 'não', replyToBot: false, mentionsBot: false, quoted: { author: 'Marcus', content: 'tu é o hyper?' } }],
    emphasizeQuote: true,
  });
  assert.match(text, /^\(em resposta a Marcus, não a você: "tu é o hyper\?"\) não$/m);
});

test('buildUserMessage: reply ao bot traz a mensagem dele citada como "sua mensagem"', () => {
  const text = buildUserMessage({
    guildName: 'S', channelName: 'c', authorName: 'a',
    items: [{ content: 'tem certeza?', replyToBot: true, mentionsBot: false, quoted: { author: 'Bot', content: 'Mises nasceu em 1881.' } }],
  });
  assert.match(text, /^\(em resposta à sua mensagem: "Mises nasceu em 1881\."\) tem certeza\?$/m);
  assert.match(text, /a última: "tem certeza\?"/);
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

test('askClaude: model explícito (escolha do usuário) sobrepõe o do config', async () => {
  const store = memoryStore();
  const runner = stubRunner(() => ok('s1'));
  const cfg = { ...config, model: { web: 'sonnet', full: 'sonnet' } };
  await askClaude({ key: 'g', mode: 'web', prompt: 'oi', store, config: cfg, runner, model: 'opus' });
  await askClaude({ key: 'g2', mode: 'full', prompt: 'oi', store, config: cfg, runner, model: 'opus' });
  assert.equal(runner.calls[0].args[runner.calls[0].args.indexOf('--model') + 1], 'opus');
  assert.equal(runner.calls[1].args[runner.calls[1].args.indexOf('--model') + 1], 'opus');
});

test('askClaude com backend commandcode: model explícito vira -m', async () => {
  const store = memoryStore();
  const runner = stubRunner(() => ok('s1'));
  const cfg = { ...config, model: { web: 'sonnet' } };
  await askClaude({ key: 'g', mode: 'web', prompt: 'oi', store, config: cfg, backend: commandcode, runner, model: 'moonshotai/kimi-k3' });
  const args = runner.calls[0].args;
  assert.equal(args[args.indexOf('-m') + 1], 'moonshotai/kimi-k3');
});

test('askClaude: effort explícito (escolha do usuário) sobrepõe o do config', async () => {
  const store = memoryStore();
  const runner = stubRunner(() => ok('s1'));
  const cfg = { ...config, effort: { web: 'low' } };
  await askClaude({ key: 'g', mode: 'web', prompt: 'oi', store, config: cfg, runner, model: 'gpt-6-luna', effort: 'high' });
  await askClaude({ key: 'g2', mode: 'web', prompt: 'oi', store, config: cfg, runner, model: 'gpt-6-luna', effort: null });
  const [alto, sem] = runner.calls;
  assert.equal(alto.args[alto.args.indexOf('--effort') + 1], 'high');
  assert.ok(!sem.args.includes('--effort')); // null = "sem thinking", mesmo com EFFORT do modo
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

test('selectContext: 10 do canal + 5 do autor + 5 do bot fica limitado a 20, sem duplicatas', () => {
  const history = [];
  for (let i = 1; i <= 5; i++) history.push(msg(String(i), 'a', i));
  for (let i = 6; i <= 10; i++) history.push(msg(String(i), 'bot', i));
  for (let i = 11; i <= 20; i++) history.push(msg(String(i), 'outro', i));
  const ctx = selectContext(history, { channel: 10, author: 5, authorIds: ['a', 'bot'], excludeIds: [] });
  assert.deepEqual(ctx.map((m) => m.id), Array.from({ length: 20 }, (_, i) => String(i + 1)));
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
    '>> responda a a: só às mensagens novas acima (a última: "foi bom"). Mensagens de outras pessoas, no contexto ou em rodadas anteriores, são pano de fundo, não o que você responde.',
  ].join('\n'));
});

test('buildUserMessage: sem contexto, formato antigo (sem seções)', () => {
  const text = buildUserMessage({
    guildName: 'S', channelName: 'c', authorName: 'a', context: [],
    items: [{ content: 'oi', replyToBot: false, mentionsBot: false, quoted: null }],
  });
  assert.equal(text, ['[discord] servidor: S | canal: #c | autor: a | responder: se couber', 'oi', '>> responda a a: só às mensagens novas acima (a última: "oi"). Mensagens de outras pessoas, no contexto ou em rodadas anteriores, são pano de fundo, não o que você responde.'].join('\n'));
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
    touch: (k, n, now, tokens) => { const e = map.get(k); e.messages += n; e.lastUsed = now; if (tokens != null) e.contextTokens = tokens; },
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

import { skipReason, sessionResetReason } from '../src/bridge.js';

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

test('formatStatus: sem sessão avisa que não há sessão ativa', () => {
  assert.equal(formatStatus(null, { maxMessages: 400 }), 'Online. Nenhuma sessão ativa neste servidor.');
});

test('formatStatus: mostra mensagens/limite, tokens/limite e minutos de inatividade', () => {
  const info = { messages: 87, lastUsed: 1_000, contextTokens: 42_400 };
  assert.equal(formatStatus(info, { maxMessages: 400, maxContextTokens: 150_000 }, 1_000 + 12 * 60_000), 'Online. Sessão: 87/400 mensagens, 42k/150k tokens, inativa há 12min.');
});

test('formatStatus: limites em 0 (desligados) não aparecem; sem contextTokens conta 0', () => {
  const info = { messages: 50, lastUsed: 0 };
  assert.equal(formatStatus(info, { maxMessages: 0, maxContextTokens: 0 }, 5 * 60_000), 'Online. Sessão: 50 mensagens, 0k tokens, inativa há 5min.');
});

test('sessionResetReason: contexto acima de maxContextTokens reinicia', () => {
  const session = { maxMessages: 400, maxContextTokens: 150_000, idleMs: 0 };
  assert.equal(sessionResetReason({ messages: 10, lastUsed: 0, contextTokens: 150_000 }, session, 0), 'tokens');
  assert.equal(sessionResetReason({ messages: 10, lastUsed: 0, contextTokens: 149_999 }, session, 0), null);
});

test('askClaude: grava o contextTokens do resultado na sessão', async () => {
  const store = countingStore();
  const runner = stubRunner(() => ({ ...ok('s1'), contextTokens: 31_000 }));
  await askClaude({ key: 'g', mode: 'web', prompt: 'oi', store, config: sessionCfg, runner, messageCount: 2, now: 1 });
  assert.equal(store.info('g').contextTokens, 31_000);
});

test('askClaude: maxTurns do modo vira --max-turns', async () => {
  const store = memoryStore();
  const runner = stubRunner(() => ok('s1'));
  await askClaude({ key: 'g', mode: 'web', prompt: 'oi', store, config: { ...config, maxTurns: { web: 4 } }, runner });
  const args = runner.calls[0].args;
  assert.equal(args[args.indexOf('--max-turns') + 1], '4');
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
    '>> responda a a: só às mensagens novas acima (a última: "responda ao @Fulano"). Mensagens de outras pessoas, no contexto ou em rodadas anteriores, são pano de fundo, não o que você responde.',
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

test('parseDirective: sem diretiva devolve o texto intacto', () => {
  assert.deepEqual(parseDirective('só texto'), { replyTo: null, text: 'só texto' });
});

// ---- backend injetável (commandcode.js segue a mesma interface) ----

import * as commandcode from '../src/commandcode.js';

test('askClaude com backend commandcode: usa buildRequest (mod com system prompt) e o runner do backend', async () => {
  const store = memoryStore();
  const runner = stubRunner(() => ok('s1'));
  await askClaude({ key: 'g', mode: 'web', prompt: 'oi', store, config, backend: commandcode, runner });
  const call = runner.calls[0];
  assert.ok(call.args.includes('--mod'));
  assert.ok(call.args.some((a) => a.startsWith('systemPrompt=') && a.endsWith('Premissa: X.')));
  assert.equal(call.prompt, 'oi');
  assert.equal(call.cwd, 'C:\bot');
  assert.equal(store.get('g'), 's1');
});

test('askClaude com backend commandcode: sessão sumida (mensagem do command-code) → repete sem --resume', async () => {
  const store = memoryStore();
  store.set('g', 'velha');
  const runner = stubRunner((opts) => {
    if (opts.args.includes('--resume')) {
      const err = new Error('command-code saiu com código 1: Error: No session "velha" found to resume.');
      err.stderr = 'Error: No session "velha" found to resume.\n';
      throw err;
    }
    return ok('nova');
  });
  await askClaude({ key: 'g', mode: 'web', prompt: 'oi', store, config, backend: commandcode, runner });
  assert.equal(runner.calls.length, 2);
  assert.equal(store.get('g'), 'nova');
});

test('askClaude com backend commandcode: a mensagem do claude não conta como sessão sumida', async () => {
  const store = memoryStore();
  store.set('g', 'velha');
  const runner = stubRunner(() => { throw new Error('claude saiu com código 1: No conversation found with session ID: velha'); });
  await assert.rejects(askClaude({ key: 'g', mode: 'web', prompt: 'oi', store, config, backend: commandcode, runner }));
  assert.equal(runner.calls.length, 1);
});


test('parseDirective: preâmbulo antes da diretiva é descartado (modelos que anunciam o que vão fazer)', () => {
  const out = parseDirective('Final result: a resposta para postar em reply ao Reds (#16):\n\n[responder: #16] ad machina kkkk aceito, reds.');
  assert.equal(out.replyTo, 16);
  assert.equal(out.text, 'ad machina kkkk aceito, reds.');
});

test('parseDirective: diretiva só conta no começo de uma linha das primeiras linhas; no meio do texto é texto', () => {
  const out = parseDirective('sem diretiva aqui\nlinha 2\nlinha 3\nlinha 4\n[responder: #2] tarde demais');
  assert.equal(out.replyTo, null);
  assert.equal(out.text, 'sem diretiva aqui\nlinha 2\nlinha 3\nlinha 4\n[responder: #2] tarde demais');
});

test('formatStatus: com queued mostra quantas gerações estão na fila (ou "nenhuma")', () => {
  const info = { messages: 5, lastUsed: 0 };
  assert.equal(formatStatus(info, { maxMessages: 0, maxContextTokens: 0, queued: 3 }, 60_000), 'Online. Sessão: 5 mensagens, 0k tokens, inativa há 1min. Fila: 3 gerações (1 em andamento).');
  assert.equal(formatStatus(null, { maxMessages: 400, queued: 1 }), 'Online. Nenhuma sessão ativa neste servidor. Fila: 1 geração (1 em andamento).');
  assert.equal(formatStatus(null, { maxMessages: 400, queued: 0 }), 'Online. Nenhuma sessão ativa neste servidor. Fila: vazia.');
  assert.equal(formatStatus(null, { maxMessages: 400 }), 'Online. Nenhuma sessão ativa neste servidor.');
});

test('formatStatus: waiting mostra lotes ainda esperando fechar, junto com a fila', () => {
  assert.equal(formatStatus(null, { maxMessages: 400, queued: 0, waiting: 2 }), 'Online. Nenhuma sessão ativa neste servidor. Fila: vazia; 2 lotes esperando fechar.');
  assert.equal(formatStatus(null, { maxMessages: 400, queued: 2, waiting: 1 }), 'Online. Nenhuma sessão ativa neste servidor. Fila: 2 gerações (1 em andamento); 1 lote esperando fechar.');
  assert.equal(formatStatus(null, { maxMessages: 400, queued: 0, waiting: 0 }), 'Online. Nenhuma sessão ativa neste servidor. Fila: vazia.');
});

import { hasText } from '../src/bridge.js';

test('hasText: só imagem, só menção ou menção + imagem não contam como texto', () => {
  assert.equal(hasText('oi, o que acha?'), true);
  assert.equal(hasText('<@123> o que acha disso?'), true);
  assert.equal(hasText(''), false);
  assert.equal(hasText('   '), false);
  assert.equal(hasText('<@123>'), false);
  assert.equal(hasText('<@!123> <@&456> <#789>'), false);
});

import { mentionsByName } from '../src/bridge.js';

test('mentionsByName: "@Nome" literal no texto (menção copiada/colada) conta como menção', () => {
  const names = ['Truth-Check', 'Truth Check Bot'];
  assert.equal(mentionsByName('@Truth-Check tu vai no uruguai?', names), true);
  assert.equal(mentionsByName('**@Truth-Check** quais arquivos você consegue usar?', names), true);
  assert.equal(mentionsByName('> @Truth-Check, opina', names), true);
  assert.equal(mentionsByName('@Truth\u200B-Check quais arquivos você consegue usar?', names), true);
  assert.equal(mentionsByName('@Truth‑Check quais arquivos você consegue usar?', names), true);
  assert.equal(mentionsByName('(@Truth-Check) opina', names), true);
  assert.equal(mentionsByName('e aí @truth-check, opina', names), true);
  assert.equal(mentionsByName('fala @Truth Check Bot', names), true);
  assert.equal(mentionsByName('o truth-check disse que sim', names), false);
  assert.equal(mentionsByName('@Truth-Checker é outro', names), false);
  assert.equal(mentionsByName('<@123> oi', names), false);
  assert.equal(mentionsByName('', names), false);
});

test('buildUserMessage: lembrete final resume a última mensagem (sem citação, cortada em 80 chars)', () => {
  const long = 'x'.repeat(100);
  const text = buildUserMessage({
    guildName: 'S', channelName: 'c', authorName: 'a',
    items: [{ content: 'primeira', replyToBot: false, mentionsBot: false, quoted: null }, { content: long, replyToBot: false, mentionsBot: false, quoted: { author: 'j', content: 'q' } }],
  });
  assert.ok(text.endsWith(`(a última: "${'x'.repeat(80)}…"). Mensagens de outras pessoas, no contexto ou em rodadas anteriores, são pano de fundo, não o que você responde.`));
});

test('buildUserMessage: imagens viram blocos antes do texto, depois da citação', () => {
  const items = [
    { content: 'o que é isso?', mentionsBot: true, images: [{ source: 'anexo', name: 'print.png', description: 'Uma tela de erro: "NullPointer".' }] },
    { content: 'e essa?', quoted: { author: 'Ana', content: 'olha' }, images: [
      { source: 'citada', name: 'foto.jpg', description: 'Praia.' },
      { source: 'link', name: 'https://x/a.png', error: 'HTTP 404' },
    ] },
  ];
  const text = buildUserMessage({ guildName: 'S', channelName: 'c', authorName: 'Bob', items });
  assert.match(text, /^1\. \[imagem anexada "print.png": Uma tela de erro: "NullPointer".\] o que é isso\?$/m);
  assert.match(text, /^2\. \(em resposta a Ana: "olha"\) \[imagem na mensagem citada "foto.jpg": Praia.\] \[imagem do link https:\/\/x\/a.png: não foi possível analisar \(HTTP 404\)\] e essa\?$/m);
});

test('buildUserMessage: mensagem só com imagem (sem texto) fica só com o bloco', () => {
  const items = [{ content: '', mentionsBot: true, images: [{ source: 'anexo', name: 'a.png', description: 'Gato.' }] }];
  const text = buildUserMessage({ guildName: 'S', channelName: 'c', authorName: 'Bob', items });
  assert.match(text, /\n\[imagem anexada "a.png": Gato.\]\n/);
  assert.match(text, /a última: "\[imagem anexada "a.png": Gato.\]"/);
});
