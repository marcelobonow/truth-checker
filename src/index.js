import fs from 'node:fs';
import path from 'node:path';
import { Client, Events, GatewayIntentBits, InteractionContextType, MessageFlags } from 'discord.js';
import { createSessionStore } from './sessions.js';
import { createQueue } from './queue.js';
import { createBatcher } from './batcher.js';
import { createInflight } from './inflight.js';
import { splitMessage } from './split.js';
import { resolveMode, skipReason, sessionKey, buildUserMessage, isNoReply, askClaude, shouldReply, selectContext, parseDirective, formatStatus, sessionResetReason, hasText, mentionsByName } from './bridge.js';
import { selectBackend } from './backend.js';
import { fetchUsage, formatUsage } from './usage.js';
import { logger } from './logger.js';
import { BACKEND, TARGET_USER_IDS, FULL_ACCESS_GUILD_IDS, MENTION_ANYONE, CONTEXT, SESSION, RESET_ON_START } from './settings.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const env = process.env;

const list = (value) => (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
function fatal(err) {
  console.error(err.message);
  process.exit(1);
}
function required(name) {
  if (!env[name]) {
    console.error(`Faltou ${name} no .env (veja .env.example)`);
    process.exit(1);
  }
  return env[name];
}

// CLI que gera as respostas (claude ou command-code) e os modelos dele
const { backend, settings: { MODEL, EFFORT, JUDGE, WEB_MAX_TURNS } } = await selectBackend(BACKEND).catch(fatal);
let bin;
try {
  bin = backend.resolveBin(env);
} catch (err) {
  fatal(err);
}

// Instruções extras anexadas ao system prompt, o primeiro que existir:
// prompt.<modo>.<backend>.md (ex.: prompt.web.commandcode.md), prompt.<modo>.md, prompt.md
function loadPrompt(mode) {
  for (const name of [`prompt.${mode}.${backend.name}.md`, `prompt.${mode}.md`, 'prompt.md']) {
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
  webDir: backend.webDir(ROOT),
  bin,
  timeoutMs: Number(env.CLAUDE_TIMEOUT_MS) || 600_000,
  batchDelayMs: Number(env.BATCH_DELAY_MS) || 7_000,
  extraPrompt: { web: prompts.web.text, full: prompts.full.text },
  model: { web: MODEL.web || undefined, full: MODEL.full || undefined },
  effort: { web: EFFORT.web || undefined, full: EFFORT.full || undefined },
  maxTurns: { web: WEB_MAX_TURNS || undefined },
  judge: JUDGE ? { model: JUDGE.model || undefined, effort: JUDGE.effort || undefined, timeoutMs: 60_000 } : null,
  session: { maxMessages: SESSION.maxMessages, maxContextTokens: SESSION.maxContextTokens, idleMs: SESSION.idleMinutes * 60_000 },
};
// O Discord repete TypingStart a cada ~10 s enquanto a pessoa digita: o prazo
// após "digitando" precisa cobrir esse intervalo, senão o lote fecha no meio.
config.typingDelayMs = Math.max(config.batchDelayMs, 12_000);
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
// Por sessão: timestamp da mensagem mais recente já enviada ao Claude. A
// sessão retomada lembra o que recebeu, então cada rodada só acrescenta o que
// veio depois; na primeira rodada (sessão nova) vai o contexto completo.
const sentUpTo = new Map();
const batcher = createBatcher({
  delayMs: config.batchDelayMs,
  onFlush: (key, items) => {
    const run = inflight.start(key, items);
    queue.add(() => processBatch(items, run)).finally(() => inflight.finish(key, run));
  },
  onError: (err) => logger.error({ err }, 'erro no lote'),
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageTyping],
});

// Registro global: mudanças podem levar até ~1h para aparecer no autocomplete.
const COMMANDS = [
  { name: 'reset', description: 'Reinicia a sessão do Claude neste servidor', contexts: [InteractionContextType.Guild] },
  { name: 'status', description: 'Mostra se o bot está online, o tamanho da sessão e a fila de gerações', contexts: [InteractionContextType.Guild] },
];

client.once(Events.ClientReady, async (c) => {
  c.user.setPresence({ status: 'online' });
  logger.info(`conectado como ${c.user.tag}`);
  try {
    await c.application.commands.set(COMMANDS);
    logger.info(`slash commands registrados: ${COMMANDS.map((cmd) => `/${cmd.name}`).join(', ')}`);
  } catch (err) {
    logger.error({ err }, 'falha ao registrar slash commands');
  }
  logger.info({
    backend: backend.name,
    bin: config.bin,
    usuarios: config.targetUserIds,
    acessoTotal: config.fullAccessGuildIds,
    canais: config.watchChannelIds.length ? config.watchChannelIds : 'todos',
    mencaoDeQualquerUm: config.mentionAnyone,
    workDir: config.workDir,
    loteMs: config.batchDelayMs,
    promptExtra: { web: prompts.web.file, full: prompts.full.file },
    modelo: config.model,
    esforco: config.effort,
    juiz: config.judge,
    webMaxTurns: WEB_MAX_TURNS,
    sessao: SESSION,
  }, 'configuração');
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const ephemeral = { flags: MessageFlags.Ephemeral };
  const where = `${interaction.guild.name} #${interaction.channel?.name}`;
  const who = interaction.member?.displayName ?? interaction.user.displayName;
  if (!config.targetUserIds.includes(interaction.user.id)) {
    logger.info({ canal: where, autor: who }, `/${interaction.commandName} recusado: fora da whitelist`);
    await interaction.reply({ content: 'Sem permissão.', ...ephemeral });
    return;
  }
  const key = sessionKey({ guildId: interaction.guildId, isTarget: true });
  logger.info({ canal: where, autor: who }, `/${interaction.commandName}`);

  if (interaction.commandName === 'status') {
    await interaction.deferReply(ephemeral);
    let usage;
    if (!backend.supportsUsage) {
      usage = 'Uso do plano: só disponível com o Claude Code.';
    } else {
      try {
        usage = `Uso do plano (5h/semana): ${formatUsage(await fetchUsage())}.`;
      } catch (err) {
        logger.warn(`não consegui consultar o uso do plano (${err.message})`);
        usage = 'Limite do plano: indisponível.';
      }
    }
    await interaction.editReply(`${formatStatus(store.info(key), { ...config.session, queued: queue.size(), waiting: batcher.size() })} ${usage}`);
    return;
  }

  if (interaction.commandName === 'reset') {
    // Pela fila: se houver execução em andamento nesta sessão, ela salvaria o
    // session_id antigo ao terminar e desfaria o reset. A fila pode demorar,
    // e a interação expira em 3 s sem resposta: defer primeiro.
    await interaction.deferReply(ephemeral);
    queue.add(async () => {
      store.clear(key);
      sentUpTo.delete(key);
      logger.info({ canal: where }, 'sessão reiniciada');
      await interaction.editReply('Sessão reiniciada.');
    }).catch((err) => logger.error({ err }, 'falha no reset'));
  }
});

// Autor de um lote em espera começou a digitar: a janela de silêncio recomeça,
// para a mensagem que ele está escrevendo entrar no mesmo lote.
client.on(Events.TypingStart, (typing) => {
  if (typing.user.bot) return;
  if (batcher.touch(`${typing.channel.id}:${typing.user.id}`, config.typingDelayMs)) {
    logger.info({ canal: `#${typing.channel.name}`, autor: typing.member?.displayName ?? typing.user.displayName }, `digitando: lote espera mais ${config.typingDelayMs / 1000}s`);
  }
});

client.on(Events.MessageCreate, async (message) => {
  const isTarget = config.targetUserIds.includes(message.author.id);
  // menção real ou "@Nome" colado como texto
  const mentionsBot = message.mentions.users.has(client.user.id)
    || mentionsByName(message.content, [client.user.username, message.guild?.members.me?.displayName]);
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
    logger[level]({ canal: where, autor: who }, `não analisando (${skip}): ${oneLine(message.cleanContent)}`);
    return;
  }
  logger.info({ canal: where, autor: who, mencao: mentionsBot, reply: Boolean(message.reference) }, `mensagem recebida: ${oneLine(message.cleanContent)}`);

  // pessoas mencionadas de verdade (<@id>), menos o bot: o Claude pode marcá-las ou responder a elas
  const mentions = [...message.mentions.users.values()]
    .filter((u) => u.id !== client.user.id)
    .map((u) => ({ id: u.id, name: message.mentions.members?.get(u.id)?.displayName ?? u.displayName }));
  const item = { message, content: message.cleanContent ?? '', replyToBot: false, mentionsBot, quoted: null, mentions };
  if (!hasText(message.content)) {
    logger.info(`ignorada: sem texto (${message.attachments.size} anexo(s), ${message.embeds.length} embed(s))`);
    return;
  }

  // Entra no lote já (preserva a ordem de chegada); a referência é resolvida
  // em paralelo e aguardada antes de montar o texto.
  item.ready = resolveReference(message, item);
  const key = `${message.channelId}:${message.author.id}`;
  // Autor mandou mensagem nova com o lote dele na fila ou no juiz: cancela e o
  // lote antigo volta para a espera junto com a nova, para uma resposta só.
  // Se a geração de verdade já começou (pesquisa na web etc.), ela segue e a
  // nova mensagem vira um lote novo, julgado e gerado depois.
  const cancelled = inflight.cancel(key);
  if (cancelled) {
    logger.info({ canal: where, autor: who }, `geração cancelada: autor mandou mensagem nova (${cancelled.length} mensagens voltam ao lote)`);
    for (const old of cancelled) batcher.add(key, old);
  } else if (inflight.isLocked(key)) {
    logger.info({ canal: where, autor: who }, 'autor mandou mensagem nova durante a geração: vai para um lote novo, depois da resposta atual');
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

// Desconecta do gateway antes de sair: o Discord marca offline na hora, em
// vez de esperar o timeout da conexão que sumiu.
async function shutdown(signal) {
  logger.info(`sinal ${signal} recebido, desligando`);
  await client.destroy();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

async function processBatch(items, run) {
  const { signal } = run;
  if (signal.aborted) return; // cancelado enquanto esperava na fila
  await Promise.all(items.map((item) => item.ready));
  const last = items.at(-1).message;
  const isTarget = config.targetUserIds.includes(last.author.id);
  const mode = resolveMode({ guildId: last.guildId, isTarget }, config);
  const key = sessionKey({ guildId: last.guildId, isTarget });
  const where = `${last.guild.name} #${last.channel.name}`;
  // só a whitelist pode fazer o bot marcar/responder outra pessoa
  const mentions = isTarget ? uniqueBy(items.flatMap((i) => i.mentions ?? []), (m) => m.id) : [];
  const now = Date.now();
  // Mesmo critério que askClaude vai aplicar: sessão nova recebe tudo de novo.
  const fresh = !store.get(key) || sessionResetReason(store.info(key), config.session, now) !== null;
  if (fresh) sentUpTo.delete(key);
  const { full: fullContext, fresh: context } = await fetchContext(items, mentions.map((m) => m.id), sentUpTo.get(key));
  const promptWith = (ctx) => buildUserMessage({
    guildName: last.guild.name,
    channelName: last.channel.name,
    authorName: displayName(last),
    items,
    context: ctx,
    mentions,
    indexed: isTarget,
    referenceTimestamp: last.createdTimestamp,
    emphasizeQuote: backend.name === 'commandcode',
  });
  const prompt = promptWith(context);

  // "digitando" desde o juiz (para testar se o indicador aparece)
  const typing = startTyping(last.channel);

  // Sem menção nem reply ao bot, um modelo barato decide antes se vale responder.
  const forced = items.some((i) => i.replyToBot || i.mentionsBot);
  if (config.judge && !forced) {
    logger.info({ canal: where, autor: displayName(last), modelo: config.judge.model, mensagens: items.length, contexto: fullContext.length }, 'julgando se deve responder');
    const judgeStarted = Date.now();
    let verdict;
    try {
      // o juiz não tem sessão: recebe o contexto completo, não só o novo
      verdict = await shouldReply({ mode, prompt: promptWith(fullContext), config, backend, signal });
    } catch (err) {
      typing.stop();
      if (err.name === 'AbortError') return;
      throw err;
    }
    const judgeStats = { segundos: ((Date.now() - judgeStarted) / 1000).toFixed(1), custoEstimadoUsd: verdict.costUsd };
    if (!verdict.reply) {
      typing.stop();
      logger.info({ canal: where, autor: displayName(last), ...judgeStats }, `juiz decidiu não responder: ${oneLine(last.cleanContent)}`);
      return;
    }
    logger.info(judgeStats, `juiz liberou a resposta (${verdict.reason})`);
  }

  logger.info({ canal: where, autor: displayName(last), modo: mode, mensagens: items.length, contexto: context.length, sessao: store.get(key) ?? 'nova' }, `gerando com ${backend.name}`);
  const started = Date.now();
  const onEvent = (event) => {
    const activity = backend.describeEvent(event);
    if (!activity) return;
    logger.info(`${backend.name}: ${activity}`);
    typing.poke(); // "digitando" enquanto ele pesquisa/usa ferramentas
  };
  // Daqui em diante mensagem nova do autor não cancela mais (ver inflight.js).
  inflight.lock(run);
  try {
    const sessionBefore = store.get(key);
    const res = await askClaude({ key, mode, prompt, store, config, backend, onEvent, signal, now, messageCount: items.length + context.length });
    if (!fresh && !res.sessionReset && res.sessionId && res.sessionId !== sessionBefore) {
      // sessão salva sumiu e o CLI começou outra só com este lote: na próxima rodada vai tudo de novo
      sentUpTo.delete(key);
    } else {
      sentUpTo.set(key, Math.max(...items.map((i) => i.message.createdTimestamp), ...context.map((m) => m.timestamp)));
    }
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    if (res.sessionReset) logger.info(`sessão reiniciada automaticamente (${res.sessionReset})`);
    const stats = { segundos: elapsed, turnos: res.numTurns, custoEstimadoUsd: res.costUsd, mensagensNaSessao: store.info(key)?.messages };
    if (res.isError) {
      logger.error({ ...stats, subtype: res.subtype }, `${backend.name} retornou erro: ${preview(res.text)}`);
      await send(last, `⚠️ ${backend.name} retornou erro (${res.subtype}): ${res.text}`);
    } else if (isNoReply(res.text)) {
      logger.info({ canal: where, autor: displayName(last), ...stats }, `${backend.name} decidiu não responder: ${oneLine(last.cleanContent)}`);
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
// Devolve { full, fresh }: `full` é a seleção completa (para o juiz, que não
// tem sessão); `fresh` só o que veio depois de `after` (a sessão já viu o resto).
async function fetchContext(items, extraAuthorIds = [], after = 0) {
  if (CONTEXT.channel <= 0 && CONTEXT.author <= 0) return { full: [], fresh: [] };
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
    const select = (list) => selectContext(list, {
      channel: CONTEXT.channel,
      author: CONTEXT.author,
      // client.user.id garante as últimas `CONTEXT.author` respostas do próprio
      // bot no contexto, mesmo se elas não estiverem entre as últimas do canal.
      authorIds: [first.author.id, client.user.id, ...extraAuthorIds],
      excludeIds: items.map((i) => i.message.id),
    });
    const full = select(history);
    return { full, fresh: after > 0 ? select(history.filter((m) => m.timestamp > after)) : full };
  } catch (err) {
    logger.warn(`não consegui ler o histórico do canal (${err.message}); seguindo sem contexto`);
    return { full: [], fresh: [] };
  }
}

// Indicador "digitando" dura ~10 s por envio: renova a cada 8 s enquanto o
// lote roda, e na hora (poke) a cada atividade do Claude.
function startTyping(channel) {
  const tick = () => channel.sendTyping().catch((err) => logger.warn(`digitando falhou: ${err.message}`));
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
const oneLine = (text) => (text ?? '').replace(/\s+/g, ' ');
const preview = (text) => oneLine(text).slice(0, 80);

client.login(token).catch((err) => {
  logger.error(`falha no login do Discord: ${err.message}`);
  process.exitCode = 1;
  client.destroy();
});
