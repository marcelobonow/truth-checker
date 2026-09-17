import fs from 'node:fs';
import path from 'node:path';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { createSessionStore } from './sessions.js';
import { createQueue } from './queue.js';
import { createBatcher } from './batcher.js';
import { createInflight } from './inflight.js';
import { splitMessage } from './split.js';
import { resolveMode, skipReason, sessionKey, buildUserMessage, isNoReply, askClaude, selectContext, parseDirective } from './bridge.js';
import { describeEvent } from './claude.js';
import { logger } from './logger.js';
import { TARGET_USER_IDS, FULL_ACCESS_GUILD_IDS, MENTION_ANYONE, MODEL, EFFORT, CONTEXT, SESSION, RESET_ON_START } from './settings.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const env = process.env;

const list = (value) => (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
function required(name) {
  if (!env[name]) {
    console.error(`Faltou ${name} no .env (veja .env.example)`);
    process.exit(1);
  }
  return env[name];
}

// prompt.web.md / prompt.full.md (fallback: prompt.md), anexados ao system prompt
function loadPrompt(mode) {
  for (const name of [`prompt.${mode}.md`, 'prompt.md']) {
    const file = path.join(ROOT, name);
    if (fs.existsSync(file)) return { file: name, text: fs.readFileSync(file, 'utf8') };
  }
  return { file: null, text: '' };
}
const prompts = { web: loadPrompt('web'), full: loadPrompt('full') };

const config = {
  targetUserIds: TARGET_USER_IDS.map(String),
  fullAccessGuildIds: FULL_ACCESS_GUILD_IDS.map(String),
  watchChannelIds: list(env.WATCH_CHANNEL_IDS),
  mentionAnyone: Boolean(MENTION_ANYONE),
  workDir: env.WORK_DIR || ROOT,
  webDir: ROOT,
  bin: env.CLAUDE_BIN || 'claude',
  timeoutMs: Number(env.CLAUDE_TIMEOUT_MS) || 600_000,
  batchDelayMs: Number(env.BATCH_DELAY_MS) || 7_000,
  extraPrompt: { web: prompts.web.text, full: prompts.full.text },
  model: { web: MODEL.web || undefined, full: MODEL.full || undefined },
  effort: { web: EFFORT.web || undefined, full: EFFORT.full || undefined },
  session: { maxMessages: SESSION.maxMessages, idleMs: SESSION.idleMinutes * 60_000 },
};
const token = required('DISCORD_TOKEN');
if (config.targetUserIds.length === 0) {
  console.error('Preencha TARGET_USER_IDS em src/settings.js');
  process.exit(1);
}

const store = createSessionStore(path.join(ROOT, 'sessions.json'), { onError: (msg) => logger.warn(msg) });
if (RESET_ON_START) {
  const n = store.clearAll();
  if (n > 0) logger.info(`sessões anteriores apagadas ao iniciar (${n})`);
}
const queue = createQueue();
const inflight = createInflight();
const batcher = createBatcher({
  delayMs: config.batchDelayMs,
  onFlush: (key, items) => {
    const run = inflight.start(key, items);
    queue.add(() => processBatch(items, run.signal)).finally(() => inflight.finish(key, run));
  },
  onError: (err) => logger.error({ err }, 'erro no lote'),
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once(Events.ClientReady, (c) => {
  logger.info(`conectado como ${c.user.tag}`);
  logger.info({
    usuarios: config.targetUserIds,
    acessoTotal: config.fullAccessGuildIds,
    canais: config.watchChannelIds.length ? config.watchChannelIds : 'todos',
    mencaoDeQualquerUm: config.mentionAnyone,
    workDir: config.workDir,
    loteMs: config.batchDelayMs,
    promptExtra: { web: prompts.web.file, full: prompts.full.file },
    modelo: config.model,
    esforco: config.effort,
    sessao: SESSION,
  }, 'configuração');
});

client.on(Events.MessageCreate, async (message) => {
  const isTarget = config.targetUserIds.includes(message.author.id);
  const mentionsBot = message.mentions.users.has(client.user.id);
  const meta = {
    authorId: message.author.id,
    isBot: message.author.bot,
    guildId: message.guildId,
    channelId: message.channelId,
    mentionsBot,
  };
  const where = message.guild ? `${message.guild.name} #${message.channel.name}` : 'DM';
  const who = displayName(message);
  const skip = skipReason(meta, config);
  if (skip) {
    // as próprias respostas do bot também chegam aqui: só em debug, para não poluir
    const level = message.author.id === client.user.id ? 'debug' : 'info';
    logger[level]({ canal: where, autor: who }, `não analisando (${skip}): ${preview(message.cleanContent)}`);
    return;
  }
  logger.info({ canal: where, autor: who, mencao: mentionsBot, reply: Boolean(message.reference) }, `mensagem recebida: ${preview(message.cleanContent)}`);

  if (isTarget && message.content.trim() === '!reset') {
    // Pela fila: se houver execução em andamento nesta sessão, ela salvaria o
    // session_id antigo ao terminar e desfaria o reset.
    queue.add(async () => {
      store.clear(sessionKey({ guildId: message.guildId, isTarget: true }));
      logger.info({ canal: where }, 'sessão reiniciada');
      await send(message, 'Sessão reiniciada.');
    }).catch((err) => logger.error({ err }, 'falha no reset'));
    return;
  }

  // pessoas mencionadas de verdade (<@id>), menos o bot: o Claude pode marcá-las ou responder a elas
  const mentions = [...message.mentions.users.values()]
    .filter((u) => u.id !== client.user.id)
    .map((u) => ({ id: u.id, name: message.mentions.members?.get(u.id)?.displayName ?? u.displayName }));
  const item = { message, content: message.cleanContent ?? '', replyToBot: false, mentionsBot, quoted: null, mentions };
  if (!item.content.trim()) {
    logger.info('ignorada: sem texto (só anexo/embed)');
    return;
  }

  // Entra no lote já (preserva a ordem de chegada); a referência é resolvida
  // em paralelo e aguardada antes de montar o texto.
  item.ready = resolveReference(message, item);
  const key = `${message.channelId}:${message.author.id}`;
  // Autor mandou mensagem nova com o lote dele em geração: cancela e o lote
  // antigo volta para a espera junto com a nova, para uma resposta só.
  const cancelled = inflight.cancel(key);
  if (cancelled) {
    logger.info({ canal: where, autor: who }, `geração cancelada: autor mandou mensagem nova (${cancelled.length} mensagens voltam ao lote)`);
    for (const old of cancelled) batcher.add(key, old);
  }
  const size = batcher.add(key, item);
  logger.info(`esperando ${config.batchDelayMs / 1000}s sem novas mensagens para fechar o lote (${size} na espera)`);
});

async function resolveReference(message, item) {
  if (!message.reference?.messageId) return;
  try {
    const ref = await message.fetchReference();
    if (ref.author.id === client.user.id) item.replyToBot = true;
    else item.quoted = { author: displayName(ref), content: (ref.cleanContent ?? '').slice(0, 300) };
  } catch (err) {
    logger.warn(`mensagem referenciada inacessível (${err.message}); seguindo sem citação`);
  }
}

client.on(Events.Error, (err) => logger.error({ err }, 'erro do cliente Discord'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'rejeição não tratada'));

async function processBatch(items, signal) {
  if (signal.aborted) return; // cancelado enquanto esperava na fila
  await Promise.all(items.map((item) => item.ready));
  const last = items.at(-1).message;
  const isTarget = config.targetUserIds.includes(last.author.id);
  const mode = resolveMode({ guildId: last.guildId, isTarget }, config);
  const key = sessionKey({ guildId: last.guildId, isTarget });
  const where = `${last.guild.name} #${last.channel.name}`;
  // só a whitelist pode fazer o bot marcar/responder outra pessoa
  const mentions = isTarget ? uniqueBy(items.flatMap((i) => i.mentions ?? []), (m) => m.id) : [];
  const context = await fetchContext(items, mentions.map((m) => m.id));
  const prompt = buildUserMessage({
    guildName: last.guild.name,
    channelName: last.channel.name,
    authorName: displayName(last),
    items,
    context,
    mentions,
    indexed: isTarget,
  });

  logger.info({ canal: where, autor: displayName(last), modo: mode, mensagens: items.length, contexto: context.length, sessao: store.get(key) ?? 'nova' }, 'gerando com claude');
  const typing = startTyping(last.channel);
  const started = Date.now();
  const onEvent = (event) => {
    const activity = describeEvent(event);
    if (!activity) return;
    logger.info(`claude: ${activity}`);
    typing.poke(); // "digitando" enquanto ele pesquisa/usa ferramentas
  };
  try {
    const res = await askClaude({ key, mode, prompt, store, config, onEvent, signal, messageCount: items.length + context.length });
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    if (res.sessionReset) logger.info(`sessão reiniciada automaticamente (${res.sessionReset})`);
    const stats = { segundos: elapsed, turnos: res.numTurns, custoEstimadoUsd: res.costUsd, mensagensNaSessao: store.info(key)?.messages };
    if (res.isError) {
      logger.error({ ...stats, subtype: res.subtype }, `claude retornou erro: ${preview(res.text)}`);
      await send(last, `⚠️ Claude retornou erro (${res.subtype}): ${res.text}`);
    } else if (isNoReply(res.text)) {
      logger.info(stats, 'claude decidiu não responder');
    } else {
      const { replyTo, text } = isTarget ? parseDirective(res.text) : { replyTo: null, text: res.text };
      const target = replyTo ? await resolveReplyTarget(last.channel, context[replyTo - 1], replyTo) : null;
      logger.info({ ...stats, chars: text.length, respondendoA: target ? `#${replyTo}` : undefined }, 'enviando para o discord');
      await send(target ?? last, text);
      logger.info('resposta enviada');
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.info({ canal: where, segundos: ((Date.now() - started) / 1000).toFixed(1) }, 'geração descartada');
      return;
    }
    logger.error({ err }, 'falha ao gerar resposta');
    await send(last, `⚠️ ${err.message}`).catch(() => {});
  } finally {
    typing.stop();
  }
}

// Mensagem #n do contexto que o Claude pediu para responder; null (e log) se
// o índice não existe ou a mensagem sumiu, e aí a resposta vai para quem pediu.
async function resolveReplyTarget(channel, entry, index) {
  if (!entry) {
    logger.warn(`claude pediu [responder: #${index}], que não existe no contexto; respondendo a quem pediu`);
    return null;
  }
  try {
    return await channel.messages.fetch(entry.id);
  } catch (err) {
    logger.warn(`mensagem #${index} inacessível (${err.message}); respondendo a quem pediu`);
    return null;
  }
}

// Últimas mensagens do canal antes do lote, para o Claude entender o assunto.
// `extraAuthorIds`: pessoas citadas, cujas últimas mensagens também entram.
async function fetchContext(items, extraAuthorIds = []) {
  if (CONTEXT.channel <= 0 && CONTEXT.author <= 0) return [];
  const first = items[0].message;
  try {
    const fetched = await first.channel.messages.fetch({ limit: Math.min(100, CONTEXT.fetch), before: first.id });
    const history = fetched.map((m) => ({
      id: m.id,
      authorId: m.author.id,
      authorName: displayName(m),
      content: (m.cleanContent ?? '').slice(0, 200),
      timestamp: m.createdTimestamp,
    }));
    return selectContext(history, {
      channel: CONTEXT.channel,
      author: CONTEXT.author,
      authorIds: [first.author.id, ...extraAuthorIds],
      excludeIds: items.map((i) => i.message.id),
    });
  } catch (err) {
    logger.warn(`não consegui ler o histórico do canal (${err.message}); seguindo sem contexto`);
    return [];
  }
}

// Indicador "digitando" dura ~10 s por envio: renova a cada 8 s enquanto o
// lote roda, e na hora (poke) a cada atividade do Claude.
function startTyping(channel) {
  const tick = () => channel.sendTyping().catch(() => {});
  tick();
  const timer = setInterval(tick, 8_000);
  return { stop: () => clearInterval(timer), poke: tick };
}

async function send(message, text) {
  const chunks = splitMessage(text);
  if (chunks.length === 0) return;
  const allowedMentions = { parse: ['users'], repliedUser: true }; // nunca @everyone/cargos vindos do texto gerado
  try {
    await message.reply({ content: chunks[0], allowedMentions });
  } catch (err) {
    // Mensagem original apagada durante o processamento: manda no canal mesmo assim
    logger.warn(`reply falhou (${err.message}); enviando no canal`);
    await message.channel.send({ content: chunks[0], allowedMentions });
  }
  for (const chunk of chunks.slice(1)) {
    await message.channel.send({ content: chunk, allowedMentions });
  }
}

const uniqueBy = (list, keyOf) => [...new Map(list.map((x) => [keyOf(x), x])).values()];
const displayName = (message) => message.member?.displayName ?? message.author.displayName;
const preview = (text) => (text ?? '').replace(/\s+/g, ' ').slice(0, 80);

client.login(token).catch((err) => {
  logger.error(`falha no login do Discord: ${err.message}`);
  process.exitCode = 1;
  client.destroy();
});
