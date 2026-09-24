import fs from 'node:fs';
import path from 'node:path';
import { ApplicationCommandOptionType, Client, Events, GatewayIntentBits, InteractionContextType, MessageFlags } from 'discord.js';
import { createSessionStore } from './sessions.js';
import { createQueue } from './queue.js';
import { createBatcher } from './batcher.js';
import { createInflight } from './inflight.js';
import { splitMessage } from './split.js';
import { resolveMode, isTarget, skipReason, sessionKey, buildUserMessage, isNoReply, askClaude, selectContext, parseDirective, formatStatus, sessionResetReason, hasText, mentionsByName, isDirectMessageToBot } from './bridge.js';
import { selectBackend } from './backend.js';
import { judge, compileDictionary } from './heuristic.js';
import { parseDictionary } from './dicionario.js';
import { fetchUsage, formatUsage } from './usage.js';
import { collectImages, analyzeImages } from './images.js';
import { collectFiles, readFiles, rejectedNonImages } from './files.js';
import { createModelStore, DEFAULT_MODEL_CHOICE, formatModelList, normalizeChoices, choiceValue, choiceName } from './models.js';
import { logger } from './logger.js';
import { BACKEND, TARGET_USER_IDS, TARGET_ROLE_IDS, FULL_ACCESS_GUILD_IDS, MENTION_ANYONE, MENTIONS_AND_REPLIES_ONLY, BOT_NAME_ALIASES, JUDGE, CONTEXT, SESSION, RESET_ON_START, IMAGES, FILES } from './settings.js';

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
const { backend, settings: { MODEL, EFFORT, WEB_MAX_TURNS, MODEL_CHOICES = [] } } = await selectBackend(BACKEND).catch(fatal);
// Modelos que os usuários podem escolher (/model): allowlist do settings do
// backend; lista vazia desliga /model e /model-list (docs/model-selector.md).
// O valor da escolha (o que o Discord devolve e o banco guarda) é
// "model" ou "model:effort", permitindo o mesmo modelo em esforços diferentes.
const modelChoices = normalizeChoices(MODEL_CHOICES);
const entryByValue = new Map(modelChoices.map((entry) => [choiceValue(entry), entry]));
if (entryByValue.size !== modelChoices.length) {
  fatal(new Error('MODEL_CHOICES com valores repetidos (mesmo modelo e esforço)'));
}
if (modelChoices.length > 24) {
  fatal(new Error('MODEL_CHOICES com mais de 24 modelos: o Discord aceita 25 choices e um é o "padrão"'));
}
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
// O modo estrito não usa juiz nem dicionário; fora dele, termos do juiz são
// compilados uma vez na inicialização.
const dictionary = MENTIONS_AND_REPLIES_ONLY ? [] : compileDictionary(parseDictionary());

const config = {
  targetUserIds: TARGET_USER_IDS.map(String),
  targetRoleIds: TARGET_ROLE_IDS.map(String),
  fullAccessGuildIds: FULL_ACCESS_GUILD_IDS.map(String),
  watchChannelIds: list(env.WATCH_CHANNEL_IDS),
  mentionAnyone: Boolean(MENTION_ANYONE),
  mentionsAndRepliesOnly: Boolean(MENTIONS_AND_REPLIES_ONLY),
  workDir: env.WORK_DIR || ROOT,
  webDir: backend.webDir(ROOT),
  bin,
  timeoutMs: Number(env.CLAUDE_TIMEOUT_MS) || 600_000,
  batchDelayMs: Number(env.BATCH_DELAY_MS) || 7_000,
  extraPrompt: { web: prompts.web.text, full: prompts.full.text },
  model: { web: MODEL.web || undefined, full: MODEL.full || undefined, vision: MODEL.vision || undefined },
  effort: { web: EFFORT.web || undefined, full: EFFORT.full || undefined, vision: EFFORT.vision || undefined },
  maxTurns: { web: WEB_MAX_TURNS || undefined },
  judge: MENTIONS_AND_REPLIES_ONLY ? null : (JUDGE || null),
  images: IMAGES,
  files: FILES,
  // imagens baixadas para análise (apagadas depois); é o cwd da chamada de
  // visão, o que limita a ferramenta de leitura a esta pasta
  imagesDir: path.join(ROOT, 'imagens'),
  session: { maxMessages: SESSION.maxMessages, maxContextTokens: SESSION.maxContextTokens, idleMs: SESSION.idleMinutes * 60_000 },
};
// O Discord repete TypingStart a cada ~10 s enquanto a pessoa digita: o prazo
// após "digitando" precisa cobrir esse intervalo, senão o lote fecha no meio.
config.typingDelayMs = Math.max(config.batchDelayMs, 12_000);
const token = required('DISCORD_TOKEN');
if (config.images.max > 0) fs.mkdirSync(config.imagesDir, { recursive: true });
if (config.targetUserIds.length === 0) {
  console.error('Preencha TARGET_USER_IDS em src/users.js (modelo: src/users.example.js)');
  process.exit(1);
}

const store = createSessionStore(path.join(ROOT, 'sessions.json'), { onError: (msg) => logger.warn(msg) });
// Escolhas de modelo por usuário (docs/model-selector.md): SQLite local que NÃO
// entra no RESET_ON_START — preferência, não contexto de conversa.
let modelStore = null;
if (modelChoices.length > 0) {
  try {
    modelStore = createModelStore(path.join(ROOT, 'models.db'), { onError: (msg) => logger.warn(msg) });
  } catch (err) {
    fatal(new Error(`não consegui abrir models.db: ${err.message}`));
  }
}
if (RESET_ON_START) {
  const n = store.clearAll();
  if (n > 0) logger.info(`sessões anteriores apagadas ao iniciar (${n})`);
}
const queue = createQueue();
const inflight = createInflight();
// Cada sessão é compartilhada no servidor, mas o contexto é do canal. O
// marcador, portanto, precisa ser por sessão e canal: uma conversa em outro
// canal não pode fazer o bot achar que já viu as mensagens deste aqui.
const sentUpTo = new Map();
const contextMarkerKey = (session, channelId) => `${session}\u0000${channelId}`;
const clearContextMarkers = (session) => {
  for (const marker of sentUpTo.keys()) {
    if (marker.startsWith(`${session}\u0000`)) sentUpTo.delete(marker);
  }
};
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
  ...(modelChoices.length > 0 ? [
    {
      name: 'model',
      description: 'Escolhe o modelo que o bot usa com você (ou volta ao padrão)',
      contexts: [InteractionContextType.Guild],
      options: [{
        type: ApplicationCommandOptionType.String,
        name: 'modelo',
        description: 'Modelo da lista, ou "padrão" para voltar ao modelo configurado',
        required: true,
        choices: [
          { name: `${DEFAULT_MODEL_CHOICE} (volta ao modelo das settings)`, value: DEFAULT_MODEL_CHOICE },
          ...modelChoices.map((entry) => ({ name: choiceName(entry), value: choiceValue(entry) })),
        ],
      }],
    },
    { name: 'model-list', description: 'Lista quem escolheu um modelo diferente do padrão', contexts: [InteractionContextType.Guild] },
  ] : []),
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
    cargos: config.targetRoleIds,
    acessoTotal: config.fullAccessGuildIds,
    canais: config.watchChannelIds.length ? config.watchChannelIds : 'todos',
    mencaoDeQualquerUm: config.mentionAnyone,
    soMencoesEReplies: config.mentionsAndRepliesOnly,
    workDir: config.workDir,
    loteMs: config.batchDelayMs,
    promptExtra: { web: prompts.web.file, full: prompts.full.file },
    modelo: config.model,
    esforco: config.effort,
    juiz: config.judge ? { ...config.judge, termos: dictionary.length } : null,
    imagens: config.images.max > 0 ? { ...config.images, modelo: config.model.vision ?? config.model.web ?? 'padrão do CLI' } : null,
    arquivos: config.files.max > 0 ? config.files : null,
    webMaxTurns: WEB_MAX_TURNS,
    sessao: SESSION,
  }, 'configuração');
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const ephemeral = { flags: MessageFlags.Ephemeral };
  const where = `${interaction.guild.name} #${interaction.channel?.name}`;
  const who = interaction.member?.displayName ?? interaction.user.displayName;
  if (!isTarget({ authorId: interaction.user.id, roleIds: roleIds(interaction.member) }, config)) {
    logger.info({ canal: where, autor: who }, `/${interaction.commandName} recusado: fora da whitelist`);
    await interaction.reply({ content: 'Sem permissão.', ...ephemeral });
    return;
  }
  const mode = resolveMode({ guildId: interaction.guildId, authorId: interaction.user.id }, config);
  const key = sessionKey({ guildId: interaction.guildId, isTarget: true, mode });
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
      clearContextMarkers(key);
      logger.info({ canal: where }, 'sessão reiniciada');
      await interaction.editReply('Sessão reiniciada.');
    }).catch((err) => logger.error({ err }, 'falha no reset'));
    return;
  }

  if (interaction.commandName === 'model') {
    const choice = interaction.options.getString('modelo', true);
    const reset = choice === DEFAULT_MODEL_CHOICE;
    // Revalida contra a lista atual: o registro global do comando pode estar
    // defasado (até ~1 h) em relação ao MODEL_CHOICES do settings.
    const entry = entryByValue.get(choice);
    if (!reset && !entry) {
      await interaction.reply({ content: `Modelo fora da lista: \`${choice}\`.`, ...ephemeral });
      return;
    }
    const saved = reset ? modelStore?.clear(interaction.user.id) : modelStore?.set(interaction.user.id, choice);
    if (saved === false) {
      await interaction.reply({ content: '⚠️ Não consegui salvar sua escolha.', ...ephemeral });
      return;
    }
    logger.info({ canal: where, autor: who, modelo: reset ? DEFAULT_MODEL_CHOICE : choiceName(entry) }, 'modelo escolhido');
    await interaction.reply({ content: reset ? 'Voltei ao modelo padrão.' : `Modelo definido: \`${choiceName(entry)}\`.`, ...ephemeral });
    return;
  }

  if (interaction.commandName === 'model-list') {
    const rows = (modelStore?.list() ?? []).map((row) => ({ ...row, model: entryByValue.has(row.model) ? choiceName(entryByValue.get(row.model)) : row.model }));
    await interaction.reply({ content: formatModelList(rows), allowedMentions: { parse: [] }, ...ephemeral });
    return;
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
  // menção real ou "@Nome" colado como texto (username, nome global, apelido
  // do servidor ou alias configurado)
  const mentionsBot = message.mentions.users.has(client.user.id)
    || [message.content, message.cleanContent].some((content) => mentionsByName(content, [client.user.username, client.user.globalName, message.guild?.members.me?.displayName, ...BOT_NAME_ALIASES]));
  const meta = {
    authorId: message.author.id,
    roleIds: roleIds(message.member),
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
  // pessoas mencionadas de verdade (<@id>), menos o bot: o Claude pode marcá-las ou responder a elas
  const mentions = [...message.mentions.users.values()]
    .filter((u) => u.id !== client.user.id)
    .map((u) => ({ id: u.id, name: message.mentions.members?.get(u.id)?.displayName ?? u.displayName }));
  // whitelist (id ou cargo) decidida na chegada: vale para o lote inteiro
  const item = { message, target: isTarget(meta, config), content: message.cleanContent ?? '', replyToBot: false, mentionsBot, quoted: null, mentions, images: [], files: [] };
  let reference = null;
  let referenceResolved = false;
  // Modo estrito: uma menção passa de imediato. Sem ela, só um reply à nossa
  // própria mensagem passa; a referência é buscada apenas para confirmar isso.
  if (config.mentionsAndRepliesOnly && !mentionsBot) {
    if (!message.reference?.messageId) {
      logger.info({ canal: where, autor: who }, `não analisando (MENTIONS_AND_REPLIES_ONLY): sem menção nem reply: ${oneLine(message.cleanContent)}`);
      return;
    }
    reference = await resolveReference(message, item);
    referenceResolved = true;
    if (!isDirectMessageToBot(item)) {
      logger.info({ canal: where, autor: who }, `não analisando (MENTIONS_AND_REPLIES_ONLY): reply não é ao bot: ${oneLine(message.cleanContent)}`);
      return;
    }
  }
  logger.info({ canal: where, autor: who, mencao: mentionsBot, reply: Boolean(message.reference) }, `mensagem recebida: ${oneLine(message.cleanContent)}`);
  // "@bot" + imagem anexada, ou "@bot" como reply (a citada pode ter imagem),
  // segue mesmo sem texto: a imagem é analisada (só whitelist, só com menção).
  const mayHaveImage = mentionsBot && item.target && config.images.max > 0 && (message.attachments.size > 0 || Boolean(message.reference));
  const mayHaveFile = item.target && config.files.max > 0 && message.attachments.size > 0;
  if (!hasText(message.content) && !mayHaveImage && !mayHaveFile) {
    logger.info(`ignorada: sem texto (${message.attachments.size} anexo(s), ${message.embeds.length} embed(s))`);
    return;
  }

  // Entra no lote já (preserva a ordem de chegada); a referência e os anexos
  // são resolvidos em paralelo e aguardados antes de montar o texto.
  item.ready = (referenceResolved ? Promise.resolve(reference) : resolveReference(message, item))
    .then(async (reference) => {
      await Promise.all([
        attachImages(item, reference, { where, who }),
        attachFiles(item, reference, { where, who }),
      ]);
    })
    .catch((err) => logger.warn({ canal: where, autor: who }, `leitura de anexos falhou (${err.message}); seguindo sem eles`));
  const key = `${message.channelId}:${message.author.id}`;
  // Autor mandou mensagem nova com o lote dele na fila ou buscando contexto: cancela e o
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

// Mensagem citada vira item.quoted (do bot ou de outra pessoa; replyToBot diz
// qual) e é devolvida (ou null), para a análise de imagens dela.
async function resolveReference(message, item) {
  if (!message.reference?.messageId) return null;
  try {
    const ref = await message.fetchReference();
    item.replyToBot = ref.author.id === client.user.id;
    item.quoted = { author: displayName(ref), content: (ref.cleanContent ?? '').slice(0, 300) };
    return ref;
  } catch (err) {
    logger.warn(`mensagem referenciada inacessível (${err.message}); seguindo sem citação`);
    return null;
  }
}

// Imagens da mensagem (anexos, links) e da citada: baixa, descreve pelo CLI em
// modo vision e guarda em item.images (src/images.js). Só com menção explícita
// ao bot e autor na whitelist. Roda enquanto o lote espera; erro em uma imagem
// vira um bloco "não foi possível analisar", e o lote segue.
async function attachImages(item, reference, { where, who }) {
  const { message } = item;
  if (config.images.max <= 0) return;
  const { images, rejected } = collectImages({ message, reference, mentionsBot: item.mentionsBot, isTarget: item.target, limits: config.images });
  for (const r of rejected) logger.info({ canal: where, autor: who }, `imagem ignorada: ${r.name} (${r.reason})`);
  if (images.length === 0) return;
  const hint = stripBotMention(item.content, message);
  for (const i of images) logger.info({ canal: where, autor: who, dica: hint || undefined }, `imagem recebida: ${i.name} (${i.size != null ? `${(i.size / 1e6).toFixed(1)} MB, ` : ''}${i.source}) → analisando`);
  // "digitando" durante toda a análise: sinaliza que o fluxo já começou e que
  // o lote fecha em seguida; a geração assume o indicador depois
  const typing = startTyping(message.channel);
  try {
    // mesmo contexto que a geração recebe (10 do canal + 5 do autor + 5 do bot),
    // para o analisador saber do que estão falando
    const { full: context } = await fetchContext([item]);
    item.images = await analyzeImages(images, {
      dir: config.imagesDir,
      fileBase: message.id,
      hint,
      context,
      backend,
      config,
      onResult: (r, seconds) => {
        if (r.error) logger.warn({ canal: where, autor: who, segundos: seconds.toFixed(1) }, `falha ao analisar imagem ${r.name}: ${r.error}`);
        else logger.info({ canal: where, autor: who, segundos: seconds.toFixed(1), chars: r.description.length }, `imagem descrita: ${preview(r.description)}`);
      },
    });
  } finally {
    typing.stop();
  }
}

// Documentos não chamam outro modelo: são extraídos localmente e incluídos no
// prompt. Só entram numa conversa explicitamente dirigida ao bot.
async function attachFiles(item, reference, { where, who }) {
  if (config.files.max <= 0) return;
  const { files, rejected } = collectFiles({
    message: item.message,
    reference,
    directedToBot: isDirectMessageToBot(item),
    isTarget: item.target,
    limits: config.files,
  });
  for (const file of rejected) logger.info({ canal: where, autor: who }, `arquivo ignorado: ${file.name} (${file.reason})`);
  const unavailable = rejectedNonImages(rejected).map((file) => ({ ...file, error: file.reason }));
  if (files.length === 0) {
    item.files = unavailable;
    return;
  }
  for (const file of files) logger.info({ canal: where, autor: who }, `arquivo recebido: ${file.name} → lendo`);
  item.files = [...await readFiles(files, {
    limits: config.files,
    onResult: (file, seconds) => {
      if (file.error) logger.warn({ canal: where, autor: who, segundos: seconds.toFixed(1) }, `falha ao ler arquivo ${file.name}: ${file.error}`);
      else logger.info({ canal: where, autor: who, segundos: seconds.toFixed(1), chars: file.text.length }, `arquivo lido: ${file.name}`);
    },
  }), ...unavailable];
}

// Texto da mensagem sem o "@bot" (cleanContent mostra menções como @Nome).
function stripBotMention(cleanContent, message) {
  const names = [client.user.username, message.guild?.members.me?.displayName].filter(Boolean);
  let text = cleanContent ?? '';
  for (const name of names) text = text.split(`@${name}`).join(' ');
  return text.replace(/\s+/g, ' ').trim();
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
  const { message: last, target } = items.at(-1);
  const mode = resolveMode({ guildId: last.guildId, authorId: last.author.id }, config);
  const key = sessionKey({ guildId: last.guildId, isTarget: target, mode });
  const where = `${last.guild.name} #${last.channel.name}`;
  // só a whitelist pode fazer o bot marcar/responder outra pessoa
  const mentions = target ? uniqueBy(items.flatMap((i) => i.mentions ?? []), (m) => m.id) : [];
  const now = Date.now();
  // A sessão retomada já conhece o que recebeu anteriormente. Só acrescenta
  // as mensagens posteriores ao seu marcador neste canal (até o limite de
  // CONTEXT.channel), evitando duplicar o contexto a cada chamada.
  const fresh = !store.get(key) || sessionResetReason(store.info(key), config.session, now) !== null;
  if (fresh) clearContextMarkers(key);
  const marker = contextMarkerKey(key, last.channelId);
  const { full: fullContext, fresh: context } = await fetchContext(items, sentUpTo.get(marker));
  const promptWith = (ctx) => buildUserMessage({
    guildName: last.guild.name,
    channelName: last.channel.name,
    authorName: displayName(last),
    items,
    context: ctx,
    mentions,
    indexed: target,
    referenceTimestamp: last.createdTimestamp,
    emphasizeQuote: backend.name === 'commandcode',
  });
  const prompt = promptWith(context);

  // Fora do modo estrito, sem menção nem reply ao bot, o juiz local (CPU, sem
  // modelo) decide antes se vale gerar; recebe o contexto completo, não só o
  // novo. No modo estrito, a mensagem já foi filtrada na chegada.
  const forced = items.some((i) => i.replyToBot || i.mentionsBot);
  if (config.judge && !forced) {
    const verdict = judge({
      items: items.map((i) => ({ content: i.content, authorId: i.message.author.id, timestamp: i.message.createdTimestamp, replyToOther: Boolean(i.quoted) && !i.replyToBot })),
      context: fullContext,
      now: last.createdTimestamp,
      botId: client.user.id,
      names: [client.user.username, last.guild?.members.me?.displayName, 'bot'],
      dictionary,
      config: config.judge,
    });
    const detail = { canal: where, autor: displayName(last), pontos: `${verdict.own}+${verdict.contextBonus.toFixed(1)}=${verdict.total.toFixed(1)}`, sinais: verdict.hits };
    if (!verdict.reply) {
      logger.info(detail, `juiz local: não responder: ${oneLine(last.cleanContent)}`);
      return;
    }
    logger.info(detail, 'juiz local: responder');
  }

  // Modelo do autor: a escolha salva (/model) sobrepõe MODEL/EFFORT do settings.
  // Escolha fora da lista atual (mudou o MODEL_CHOICES) volta ao padrão.
  const savedChoice = modelStore?.get(last.author.id);
  const entry = entryByValue.get(savedChoice);
  if (savedChoice && !entry) {
    logger.warn({ canal: where, autor: displayName(last), escolha: savedChoice }, 'escolha de modelo fora da lista atual: usando o padrão');
  }
  logger.info({ canal: where, autor: displayName(last), modo: mode, mensagens: items.length, contexto: context.length, sessao: store.get(key) ?? 'nova' }, `gerando com ${entry ? choiceName(entry) : (config.model?.[mode] ?? 'padrão do CLI')}`);
  const typing = startTyping(last.channel);
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
    const res = await askClaude({ key, mode, prompt, store, config, backend, onEvent, signal, now, messageCount: items.length + context.length, model: entry?.model, effort: entry?.effort });
    if (!fresh && !res.sessionReset && res.sessionId && res.sessionId !== sessionBefore) {
      // O CLI perdeu a sessão e abriu outra só com este lote: o próximo lote
      // precisa levar o contexto completo novamente.
      clearContextMarkers(key);
    } else {
      sentUpTo.set(marker, latestMarker([...items.map((item) => item.message), ...context]));
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
      const { replyTo, text } = target ? parseDirective(res.text) : { replyTo: null, text: res.text };
      const replyMessage = replyTo ? await resolveReplyTarget(last.channel, context[replyTo - 1], replyTo) : null;
      logger.info({ ...stats, chars: text.length, respondendoA: replyMessage ? `#${replyTo}` : undefined }, 'enviando para o discord');
      await send(replyMessage ?? last, text);
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
// A seleção une até 10 do canal, 5 do autor que chamou o bot e 5 do próprio
// bot; por deduplicação, o total fica entre 10 e 20 quando há histórico.
// Devolve { full, fresh }: `full` é a seleção completa (para o juiz e imagens,
// que não têm sessão); `fresh` só contém mensagens posteriores ao marcador da
// sessão neste canal.
async function fetchContext(items, after) {
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
      authorIds: [first.author.id, client.user.id],
      excludeIds: items.map((i) => i.message.id),
    });
    const full = select(history);
    return { full, fresh: after ? select(history.filter((m) => isAfter(m, after))) : full };
  } catch (err) {
    logger.warn(`não consegui ler o histórico do canal (${err.message}); seguindo sem contexto`);
    return { full: [], fresh: [] };
  }
}

// IDs do Discord são snowflakes e preservam a ordem, inclusive quando duas
// mensagens recebem o mesmo createdTimestamp. O timestamp fica como fallback
// para objetos de teste ou mensagens sem id numérico.
function isAfter(message, marker) {
  try {
    return BigInt(message.id) > BigInt(marker.id);
  } catch {
    return message.timestamp > marker.timestamp;
  }
}

function latestMarker(messages) {
  return messages.reduce((latest, message) => (!latest || isAfter(message, latest)
    ? { id: message.id, timestamp: message.createdTimestamp ?? message.timestamp }
    : latest), null);
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
// Cargos do membro: GuildMember (cache de roles) ou, em interações sem cache, lista de ids.
const roleIds = (member) => (Array.isArray(member?.roles) ? member.roles : [...(member?.roles?.cache?.keys() ?? [])]);
const oneLine = (text) => (text ?? '').replace(/\s+/g, ' ');
const preview = (text) => oneLine(text).slice(0, 80);

client.login(token).catch((err) => {
  logger.error(`falha no login do Discord: ${err.message}`);
  process.exitCode = 1;
  client.destroy();
});
