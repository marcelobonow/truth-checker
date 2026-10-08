import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ApplicationCommandOptionType, ChannelType, Client, Events, GatewayIntentBits, InteractionContextType, LabelBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits, Status, TextInputBuilder, TextInputStyle } from 'discord.js';
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
import { createUserPromptStore, formatPromptListPages, MAX_USER_PROMPT_LENGTH } from './user-prompts.js';
import { createDisabledMonitor, createMonitor } from './monitor.js';
import { createBackendMetricHandler } from './monitor-events.js';
import { createConversationArchive, localDateInZone } from './conversation-archive.js';
import { createConversationScheduler } from './conversation-scheduler.js';
import { createConversationLookup } from './conversation-lookup.js';
import { runAnalysisChunks } from './conversation-analysis.js';
import { createConversationBackendCaller } from './conversation-backend.js';
import { createConversationCron, parseScheduledDateTime, truncateDiscordContent } from './conversation-cron.js';
import { systemPrompt } from './prompts.js';
import cron from 'node-cron';
import { logger } from './logger.js';
import { BACKEND, CONVERSATION, TARGET_USER_IDS, TARGET_ROLE_IDS, FULL_ACCESS_GUILD_IDS, MENTION_ANYONE, MENTIONS_AND_REPLIES_ONLY, BOT_NAME_ALIASES, JUDGE, CONTEXT, SESSION, RESET_ON_START, IMAGES, FILES } from './settings.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const env = process.env;
const PROMPT_MODAL_ID = 'user-prompt-editor';
const PROMPT_INPUT_ID = 'prompt-text';

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

// CLI que gera as respostas e os modelos do backend ativo
const responseSelection = await selectBackend(BACKEND).catch(fatal);
const { backend, settings: responseSettings } = responseSelection;
const { MODEL, EFFORT, WEB_MAX_TURNS, MODEL_CHOICES = [] } = responseSettings;
const analysisBackendName = CONVERSATION.analysisBackend || BACKEND;
const analysisSelection = CONVERSATION.analysisEnabled ? await selectBackend(analysisBackendName).catch(fatal) : null;
const analysisBackend = analysisSelection?.backend ?? backend;
const analysisSettings = analysisSelection?.settings ?? responseSettings;
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
  respondToBotIds: list(env.RESPOND_TO_BOT_IDS),
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
const conversationConfig = {
  model: { analysis: analysisSettings.MODEL.analysis ?? analysisSettings.MODEL.web ?? undefined },
  effort: { analysis: analysisSettings.EFFORT.analysis ?? analysisSettings.EFFORT.web ?? undefined },
  extraPrompt: {},
  workDir: ROOT,
  bin: CONVERSATION.analysisEnabled ? analysisBackend.resolveBin(env) : bin,
  timeoutMs: Number(env.CONVERSATION_ANALYSIS_TIMEOUT_MS) || config.timeoutMs,
};
const analysisSystemPrompt = systemPrompt({ mode: 'analysis', workDir: ROOT });
const analysisInputBudget = Math.max(200, CONVERSATION.maxInputChars - Buffer.byteLength(analysisSystemPrompt));
const analyzerConfigHash = crypto.createHash('sha256').update(JSON.stringify({
  version: 3, backend: analysisBackend.name, model: conversationConfig.model.analysis,
  effort: conversationConfig.effort.analysis, timeZone: CONVERSATION.timeZone,
  analysisPrompt: analysisSystemPrompt, analysisInputBudget,
  maxInputChars: CONVERSATION.maxInputChars, maxLookupQueries: CONVERSATION.maxLookupQueries,
  maxLookupResults: CONVERSATION.maxLookupResults, maxLookupBytes: CONVERSATION.maxLookupBytes,
  maxLookupFieldChars: CONVERSATION.maxLookupFieldChars, maxReadRounds: CONVERSATION.maxReadRoundsPerBlock,
  maxCallsPerAnalysis: CONVERSATION.maxCallsPerAnalysis, overlapMessages: 5,
})).digest('hex');
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
let userPromptStore;
try {
  userPromptStore = createUserPromptStore(path.join(ROOT, 'user-prompts.db'), { onError: (msg) => logger.warn(msg) });
} catch (err) {
  fatal(new Error(`não consegui abrir user-prompts.db: ${err.message}`));
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
const activeConversationWork = new Map();
let conversationCron = null;
function trackConversationWork(message, change) {
  if (!message.guildId || !message.channelId) return;
  const key = `${message.guildId}:${message.channelId}`;
  const next = Math.max(0, (activeConversationWork.get(key) ?? 0) + change);
  if (next === 0) {
    activeConversationWork.delete(key);
    conversationCron?.wake();
  }
  else activeConversationWork.set(key, next);
}
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
    Promise.all(items.map((item) => item.ready))
      .then(() => queue.add(() => processBatch(items, run)))
      .catch((err) => logger.error({ err }, 'erro ao preparar anexos do lote'))
      .finally(() => inflight.finish(key, run));
  },
  onError: (err) => logger.error({ err }, 'erro no lote'),
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageTyping],
});

let monitor;
try {
  monitor = createMonitor(path.join(ROOT, 'monitor.db'), { onError: (message) => logger.warn(message) });
} catch (err) {
  logger.warn(`não consegui abrir monitor.db; métricas desativadas: ${err.message}`);
  monitor = createDisabledMonitor();
}
const conversationArchive = CONVERSATION.captureEnabled || CONVERSATION.analysisEnabled
  ? createConversationArchive({
    root: path.resolve(ROOT, CONVERSATION.archiveDir),
    timeZone: CONVERSATION.timeZone,
    watchChannelIds: config.watchChannelIds,
    maxQueueBytes: CONVERSATION.maxQueueBytes,
    onError: (err) => logger.warn({ err }, 'falha ao arquivar conversa'),
  })
  : null;
const conversationCaller = CONVERSATION.analysisEnabled
  ? createConversationBackendCaller({ backend: analysisBackend, config: conversationConfig, queue, monitor })
  : null;
const conversationScheduler = conversationArchive && CONVERSATION.analysisEnabled
  ? createConversationScheduler({
    archive: conversationArchive,
    statePath: path.join(ROOT, 'estado-analise-conversas.json'),
    memoriesRoot: path.resolve(ROOT, CONVERSATION.memoriesDir),
    timeZone: CONVERSATION.timeZone,
    neighborMessages: CONVERSATION.neighborMessages,
    maxCallsPerAnalysis: CONVERSATION.maxCallsPerAnalysis,
    maxRetries: CONVERSATION.maxRetries,
    isJobIdle: (job) => !activeConversationWork.has(`${job.guildId}:${job.channelId}`),
    onComplete: async (job, markdown) => {
      const user = await client.users.fetch(job.requestedBy);
      await user.send({ content: truncateDiscordContent(markdown), allowedMentions: { parse: [] } });
    },
    analyzerConfigHash,
    onError: (err, job) => logger.error({ err, guildId: job?.guildId, channelId: job?.channelId, localDate: job?.localDate }, 'falha na análise agendada de conversas'),
    analyze: async ({ events, context, workDir, sourceSnapshot, lookupStatePath, maxCalls, shouldContinue, onCall, metadata }) => {
      const lookup = createConversationLookup({
        targetFile: sourceSnapshot, previousEvents: context.previous, nextEvents: context.next,
        statePath: lookupStatePath, maxResults: CONVERSATION.maxLookupResults,
        maxBytes: CONVERSATION.maxLookupBytes, maxQueries: CONVERSATION.maxLookupQueries,
        maxFieldChars: CONVERSATION.maxLookupFieldChars,
      });
      const result = await runAnalysisChunks({
        events, workDir, call: conversationCaller, lookup,
        maxChars: analysisInputBudget, overlapMessages: 5,
        maxCalls, maxLookupQueries: CONVERSATION.maxLookupQueries,
        maxLookupBytes: CONVERSATION.maxLookupBytes,
        maxReadRounds: CONVERSATION.maxReadRoundsPerBlock, timeZone: CONVERSATION.timeZone,
        shouldContinue, onCall,
      });
      return { ...result, backend: analysisBackend.name, model: conversationConfig.model.analysis, metadata };
    },
  })
  : null;
const conversationChannelsSeen = new Map();
let gatewayWasReady = false;
let gatewayConnectedAt = null;
let shuttingDown = false;

function recordConversationEvent(event) {
  if (!conversationArchive || !CONVERSATION.captureEnabled) return Promise.resolve(false);
  return conversationArchive.recordEvent(event).catch((err) => {
    logger.warn({ err, guildId: event.guildId, channelId: event.channelId }, 'não foi possível salvar evento da conversa');
    return false;
  });
}

function recordConversationMessage(message) {
  if (!conversationArchive || !CONVERSATION.captureEnabled || !conversationArchive.captureAllowed(message)) return;
  const key = `${message.guildId}:${message.channelId}`;
  if (!conversationChannelsSeen.has(key)) {
    conversationChannelsSeen.set(key, { guildId: message.guildId, channelId: message.channelId });
    void conversationArchive.recordStatus({ guildId: message.guildId, channelId: message.channelId, status: 'capture_started', connectedAt: gatewayConnectedAt })
      .catch((err) => logger.warn({ err }, 'não foi possível registrar início da captura'));
  }
  void conversationArchive.recordMessage(message, { botId: client.user?.id })
    .catch((err) => logger.warn({ err, guildId: message.guildId, channelId: message.channelId }, 'não foi possível salvar mensagem da conversa'));
}

function recordConversationConnectionStatus(status, details = {}) {
  if (!conversationArchive || !CONVERSATION.captureEnabled) return;
  if (status === 'connected' || status === 'resumed') gatewayConnectedAt = details.connectedAt ?? new Date().toISOString();
  else if (status === 'disconnected' || status === 'capture_stopped') gatewayConnectedAt = null;
  for (const { guildId, channelId } of conversationChannelsSeen.values()) {
    void conversationArchive.recordStatus({ guildId, channelId, status, ...details })
      .catch((err) => logger.warn({ err, guildId, channelId }, 'não foi possível registrar estado da captura'));
  }
}

function recordMessageDecision(message, decision, reason = null, details = {}) {
  if (!conversationArchive || !CONVERSATION.captureEnabled || !message.guildId) return;
  return recordConversationEvent({
    type: 'decision', eventId: `decision:${message.id}`, messageId: String(message.id),
    guildId: String(message.guildId), channelId: String(message.channelId),
    createdAt: new Date(message.createdTimestamp).toISOString(), authorId: String(message.author.id),
    authorName: displayName(message), decision, reason, ...details,
  });
}

function sampleConnection() {
  if (!monitor.enabled) return;
  const shards = [...client.ws.shards.values()];
  const connected = shards.length > 0 && shards.every((shard) => shard.status === Status.Ready);
  const heartbeatsValid = connected && shards.every((shard) => shard.ping >= 0 && shard.lastPingTimestamp >= 0);
  monitor.sampleConnection({
    sampledAt: Date.now(),
    connected,
    pingMs: heartbeatsValid ? shards.reduce((sum, shard) => sum + shard.ping, 0) / shards.length : null,
    heartbeatAt: heartbeatsValid ? Math.min(...shards.map((shard) => shard.lastPingTimestamp)) : null,
  });
  refreshConnectionEpisode(shards, Date.now());
  if (gatewayWasReady && !shuttingDown) {
    for (const shard of shards) {
      if (shard.status !== Status.Ready) monitor.openOutage({ shardId: shard.id, cause: 'sample_disconnected' });
    }
  }
}

function refreshConnectionEpisode(shards = [...client.ws.shards.values()], observedAt = Date.now()) {
  if (!gatewayWasReady || shuttingDown) return;
  const connected = shards.length > 0 && shards.every((shard) => shard.status === Status.Ready);
  if (connected) monitor.finishConnectionEpisode({ endedAt: observedAt, reason: 'gateway_ready' });
  else if (!monitor.startConnectionEpisode({ startedAt: observedAt, cause: 'gateway_unavailable' })) {
    monitor.advanceConnectionEpisode({ observedAt });
  }
}

const monitorSampler = setInterval(sampleConnection, 30_000);
monitorSampler.unref?.();
sampleConnection();

client.on('shardReconnecting', (shardId) => {
  if (gatewayWasReady && !shuttingDown) monitor.openOutage({ shardId, cause: 'reconnecting' });
  refreshConnectionEpisode();
});
client.on('shardDisconnect', (_closeEvent, shardId) => {
  if (gatewayWasReady && !shuttingDown) monitor.openOutage({ shardId, cause: 'disconnect' });
  refreshConnectionEpisode();
});
client.on('shardReady', (shardId) => {
  monitor.closeOutage({ shardId, reason: 'ready' });
  refreshConnectionEpisode();
});
client.on('shardResume', (shardId) => {
  monitor.closeOutage({ shardId, reason: 'resume' });
  refreshConnectionEpisode();
});

// Registro global: mudanças podem levar até ~1h para aparecer no autocomplete.
const COMMANDS = [
  { name: 'reset', description: 'Reinicia a sessão do bot neste servidor', contexts: [InteractionContextType.Guild] },
  { name: 'status', description: 'Mostra se o bot está online, o tamanho da sessão e a fila de gerações', contexts: [InteractionContextType.Guild] },
  { name: 'metrics', description: 'Mostra desconexões e uso de tokens da última semana', contexts: [InteractionContextType.Guild] },
  {
    name: 'id',
    description: 'Mostra o ID de um usuário ou cargo',
    contexts: [InteractionContextType.Guild],
    options: [
      { type: ApplicationCommandOptionType.User, name: 'usuario', description: 'Usuário para consultar', required: false },
      { type: ApplicationCommandOptionType.Role, name: 'cargo', description: 'Cargo para consultar', required: false },
    ],
  },
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
  {
    name: 'prompt',
    description: 'Abre o editor do seu prompt personalizado',
    contexts: [InteractionContextType.Guild],
  },
  { name: 'prompt-list', description: 'Lista quem definiu um prompt personalizado', contexts: [InteractionContextType.Guild] },
  ...(conversationScheduler ? [{
    name: 'analise-conversas',
    description: 'Agenda um resumo das conversas de um canal',
    contexts: [InteractionContextType.Guild],
    options: [
      { type: ApplicationCommandOptionType.String, name: 'data', description: `Data de execução local (${CONVERSATION.timeZone}), YYYY-MM-DD`, required: true },
      { type: ApplicationCommandOptionType.String, name: 'hora', description: `Hora de execução local (${CONVERSATION.timeZone}), HH:mm`, required: true },
      { type: ApplicationCommandOptionType.String, name: 'dia', description: 'Dia de conversas a analisar (padrão: hoje)', required: false },
      {
        type: ApplicationCommandOptionType.Channel, name: 'canal', description: 'Canal a analisar (padrão: este canal)', required: false,
        channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.AnnouncementThread, ChannelType.PublicThread, ChannelType.PrivateThread],
      },
    ],
  }] : []),
];

client.once(Events.ClientReady, async (c) => {
  gatewayWasReady = true;
  for (const shard of client.ws.shards.values()) monitor.closeOutage({ shardId: shard.id, reason: 'ready' });
  sampleConnection();
  c.user.setPresence({ status: 'online' });
  logger.info(`conectado como ${c.user.tag}`);
  if (conversationArchive && CONVERSATION.captureEnabled) {
    try {
      for (const channel of await conversationArchive.listRecordedChannels()) conversationChannelsSeen.set(`${channel.guildId}:${channel.channelId}`, channel);
    } catch (err) { logger.warn({ err }, 'não foi possível listar canais arquivados'); }
  }
  recordConversationConnectionStatus('connected');
  if (conversationScheduler) {
    conversationCron = createConversationCron({
      cron,
      listJobs: () => conversationScheduler.listScheduledJobs(),
      tick: () => conversationScheduler.tick(),
      timeZone: CONVERSATION.timeZone,
      onError: (err) => logger.error({ err }, 'cron de análises agendadas falhou'),
    });
    await conversationCron.start();
  }
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
    arquivoConversas: CONVERSATION.captureEnabled ? path.resolve(ROOT, CONVERSATION.archiveDir) : null,
    analiseConversas: CONVERSATION.analysisEnabled ? { backend: analysisBackend.name, model: conversationConfig.model.analysis ?? 'padrão do CLI', timeZone: CONVERSATION.timeZone } : null,
    webMaxTurns: WEB_MAX_TURNS,
    sessao: SESSION,
  }, 'configuração');
});

client.on(Events.ShardDisconnect, (closeEvent, shardId) => recordConversationConnectionStatus('disconnected', {
  shardId, closeCode: closeEvent?.code ?? null, wasClean: Boolean(closeEvent?.wasClean),
}));
client.on(Events.ShardResume, (shardId) => recordConversationConnectionStatus('resumed', { shardId }));

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isModalSubmit()) {
    if (interaction.customId !== PROMPT_MODAL_ID) return;
    const ephemeral = { flags: MessageFlags.Ephemeral };
    if (!isTarget({ authorId: interaction.user.id, roleIds: roleIds(interaction.member) }, config)) {
      await interaction.reply({ content: 'Sem permissão.', ...ephemeral });
      return;
    }
    const prompt = interaction.fields.getTextInputValue(PROMPT_INPUT_ID);
    if (prompt && (!prompt.trim() || Array.from(prompt).length > MAX_USER_PROMPT_LENGTH)) {
      await interaction.reply({ content: `O prompt deve ter entre 1 e ${MAX_USER_PROMPT_LENGTH} caracteres.`, ...ephemeral });
      return;
    }
    // Serializa a mudança com as gerações: uma execução antiga não pode salvar
    // uma sessão depois da mudança e fazê-la parecer nova.
    await interaction.deferReply(ephemeral);
    const { saved, changed } = await queue.add(() => {
      if (userPromptStore.get(interaction.user.id) === (prompt || undefined)) return { saved: true, changed: false };
      const saved = prompt ? userPromptStore.set(interaction.user.id, prompt) : userPromptStore.clear(interaction.user.id);
      return { saved, changed: saved };
    });
    await interaction.editReply(!saved ? '⚠️ Não consegui salvar seu prompt.'
      : !changed ? 'Prompt personalizado mantido.'
        : prompt ? 'Prompt personalizado salvo. A próxima resposta começará uma nova sessão.'
          : 'Prompt personalizado removido. A próxima resposta começará uma nova sessão.');
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  const ephemeral = { flags: MessageFlags.Ephemeral };
  const where = `${interaction.guild.name} #${interaction.channel?.name}`;
  const who = interaction.member?.displayName ?? interaction.user.displayName;
  if (!isTarget({ authorId: interaction.user.id, roleIds: roleIds(interaction.member) }, config)) {
    logger.info({ canal: where, autor: who }, `/${interaction.commandName} recusado: fora da whitelist`);
    await interaction.reply({ content: 'Sem permissão.', ...ephemeral });
    return;
  }
  if (interaction.commandName === 'analise-conversas') {
    if (!conversationScheduler || !conversationArchive || !CONVERSATION.captureEnabled) {
      await interaction.reply({ content: 'A captura e a análise de conversas precisam estar habilitadas.', ...ephemeral });
      return;
    }
    const channel = interaction.options.getChannel('canal') ?? interaction.channel;
    if (!interaction.guildId || !channel || channel.guildId !== interaction.guildId) {
      await interaction.reply({ content: 'Escolha um canal deste servidor.', ...ephemeral });
      return;
    }
    const permissions = channel.permissionsFor?.(interaction.member);
    if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) {
      await interaction.reply({ content: 'Você precisa ter acesso para ver o canal e seu histórico.', ...ephemeral });
      return;
    }
    const botPermissions = channel.permissionsFor?.(interaction.guild.members.me);
    if (!botPermissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) {
      await interaction.reply({ content: 'O bot precisa ter acesso para ver o canal e seu histórico.', ...ephemeral });
      return;
    }
    if (!conversationArchive.captureAllowed({ guildId: interaction.guildId, channelId: channel.id, channel })) {
      await interaction.reply({ content: 'Esse canal não está incluído na captura de conversas.', ...ephemeral });
      return;
    }

    let scheduledAt;
    let localDate;
    try {
      scheduledAt = parseScheduledDateTime(
        interaction.options.getString('data', true), interaction.options.getString('hora', true), CONVERSATION.timeZone,
      );
      if (scheduledAt <= Date.now()) throw new TypeError('a data e hora de execução precisam estar no futuro');
      localDate = interaction.options.getString('dia') ?? localDateInZone(interaction.createdTimestamp, CONVERSATION.timeZone);
    } catch (err) {
      await interaction.reply({ content: err.message, ...ephemeral });
      return;
    }

    await interaction.deferReply(ephemeral);
    try {
      await conversationScheduler.schedule({
        guildId: interaction.guildId, channelId: channel.id, localDate, scheduledAt,
        requestedBy: interaction.user.id, guildName: interaction.guild.name, channelName: channel.name,
      });
      await conversationCron?.refresh();
      await interaction.editReply(`Análise de #${channel.name} (${localDate}) agendada para ${interaction.options.getString('data', true)} às ${interaction.options.getString('hora', true)} ${CONVERSATION.timeZone}. Enviarei o resultado por DM.`);
      logger.info({ canal: where, canalAnalise: channel.name, dia: localDate, scheduledAt: new Date(scheduledAt).toISOString(), autor: who }, 'análise de conversas agendada');
    } catch (err) {
      logger.warn({ err, canal: where, canalAnalise: channel.name, dia: localDate }, 'não foi possível agendar a análise de conversas');
      await interaction.editReply(`Não consegui agendar a análise: ${err.message}`);
    }
    return;
  }
  if (interaction.commandName === 'id') {
    const user = interaction.options.getUser('usuario');
    const role = interaction.options.getRole('cargo');
    if (Boolean(user) === Boolean(role)) {
      await interaction.reply({ content: 'Informe exatamente uma opção: `usuario` ou `cargo`.', ...ephemeral });
      return;
    }
    const result = user
      ? `ID do usuário ${user.username}: \`${user.id}\``
      : `ID do cargo ${role.name}: \`${role.id}\``;
    await interaction.reply({ content: result, ...ephemeral });
    return;
  }
  const mode = resolveMode({ guildId: interaction.guildId, authorId: interaction.user.id }, config);
  const key = sessionKey({ guildId: interaction.guildId, isTarget: true, mode });
  logger.info({ canal: where, autor: who }, `/${interaction.commandName}`);

  if (interaction.commandName === 'status') {
    await interaction.deferReply(ephemeral);
    let usage;
    if (!backend.supportsUsage) {
      usage = 'Uso do plano: indisponível para este backend.';
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

  if (interaction.commandName === 'metrics') {
    await interaction.deferReply(ephemeral);
    const metrics = monitor.readMetrics({ hours: 24, days: 7 });
    if (!metrics) {
      await interaction.editReply('Métricas indisponíveis no momento.');
      return;
    }
    const connection = metrics.connection
      ? `Discord: ${metrics.connection.connected ? 'conectado' : 'desconectado'} · ping ${metrics.connection.ping_ms == null ? 'indisponível' : `${Math.round(metrics.connection.ping_ms)} ms`} · amostra ${formatUtc(metrics.connection.sampled_at)}`
      : 'Discord: ainda sem amostras';
    const longest = metrics.longestDisconnection
      ? `${formatDuration(metrics.longestDisconnection.duration_ms)} (${metrics.longestDisconnection.local_day})`
      : 'nenhuma';
    const dailyLines = metrics.daily.map((day) => {
      const tokensIn = formatAggregate(day.input_tokens_sum, day.input_token_records);
      const tokensOut = formatAggregate(day.output_tokens_sum, day.output_token_records);
      const row = `${day.local_day} · ${day.disconnections_count} desconexões · indisponível ${formatDuration(day.disconnected_ms_sum)} · maior trecho ${formatDuration(day.max_contiguous_ms)}\n` +
        `  tokens entrada/saída: ${tokensIn}/${tokensOut}`;
      const modelLines = day.models.map((model) =>
        `  ${model.model} (${model.mode}/${model.backend}): ${formatAggregate(model.input_tokens_sum, model.input_token_records)}/${formatAggregate(model.output_tokens_sum, model.output_token_records)} tokens entrada/saída`);
      return [row, ...modelLines].join('\n');
    });
    const lines = metrics.hourly.map((row) => {
      const avgMs = row.generation_duration_avg_ms == null ? null : Math.round(row.generation_duration_avg_ms);
      return `${formatUtcHour(row.hour_start_ms)} · ${row.model} (${row.mode}/${row.backend})\n` +
        `  tokens entrada/saída: ${formatAggregate(row.input_tokens_sum, row.input_token_records)}/${formatAggregate(row.output_tokens_sum, row.output_token_records)} · mensagens analisadas: ${row.analyzed_messages_count}\n` +
        `  gerações concluídas: ${row.generations_count} · média: ${avgMs == null ? '—' : `${formatDuration(avgMs)}`} · respostas: ${row.replies_count}`;
    });
    for (const row of metrics.tools) {
      const avgMs = row.duration_avg_ms == null ? null : Math.round(row.duration_avg_ms);
      lines.push(`${formatUtcHour(row.hour_start_ms)} · ferramenta ${row.tool_name} (${row.model}/${row.mode})\n` +
        `  chamadas: ${row.calls_count} · média: ${avgMs == null ? '—' : formatDuration(avgMs)} · falhas: ${row.failures_count}`);
    }
    if (lines.length === 0) lines.push('Ainda não há buckets horários nesta janela.');
    const pages = paginateMetrics([
      connection,
      `Últimos 7 dias (${metrics.timeZone}) · ${metrics.weeklyDisconnections} desconexões · maior período contínuo: ${longest}`,
      'Desconexões e tokens por dia (tokens entrada/saída):',
      ...dailyLines,
      'Últimas 24 horas · buckets UTC:',
      ...lines,
    ]);
    await interaction.editReply({ content: pages[0], allowedMentions: { parse: [] } });
    for (const content of pages.slice(1)) await interaction.followUp({ content, allowedMentions: { parse: [] }, ...ephemeral });
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
      await interaction.reply({
        content: `O modelo \`${choice}\` não está disponível no backend atual (\`${backend.name}\`). Nenhuma alteração foi salva; sua preferência salva não foi alterada. A lista do \`/model\` está desatualizada no Discord. Aguarde a atualização do comando e tente novamente.`,
        ...ephemeral,
      });
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

  if (interaction.commandName === 'prompt') {
    const input = new TextInputBuilder()
      .setCustomId(PROMPT_INPUT_ID)
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(MAX_USER_PROMPT_LENGTH)
      .setRequired(false)
      .setPlaceholder('Escreva seu prompt; deixe vazio para remover');
    const currentPrompt = userPromptStore.get(interaction.user.id);
    if (currentPrompt) input.setValue(currentPrompt);
    const modal = new ModalBuilder()
      .setCustomId(PROMPT_MODAL_ID)
      .setTitle('Seu prompt personalizado')
      .addLabelComponents(new LabelBuilder()
        .setLabel('Prompt personalizado')
        .setDescription(`Até ${MAX_USER_PROMPT_LENGTH} caracteres. Apague o texto para remover.`)
        .setTextInputComponent(input));
    await interaction.showModal(modal);
    return;
  }

  if (interaction.commandName === 'prompt-list') {
    const pages = formatPromptListPages(userPromptStore.list());
    await interaction.reply({ content: pages[0], allowedMentions: { parse: [] }, ...ephemeral });
    for (const content of pages.slice(1)) await interaction.followUp({ content, allowedMentions: { parse: [] }, ...ephemeral });
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
  // Arquiva antes de qualquer regra de atendimento para manter também o
  // contexto das mensagens que não acionam o bot.
  recordConversationMessage(message);
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
    recordMessageDecision(message, 'skipped', skip);
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
  const allowedBot = message.author.bot && config.respondToBotIds.includes(message.author.id);
  if (config.mentionsAndRepliesOnly && !mentionsBot && !allowedBot) {
    if (!message.reference?.messageId) {
      recordMessageDecision(message, 'skipped', 'MENTIONS_AND_REPLIES_ONLY: sem menção nem reply');
      logger.info({ canal: where, autor: who }, `não analisando (MENTIONS_AND_REPLIES_ONLY): sem menção nem reply: ${oneLine(message.cleanContent)}`);
      return;
    }
    reference = await resolveReference(message, item);
    referenceResolved = true;
    if (!isDirectMessageToBot(item)) {
      recordMessageDecision(message, 'skipped', 'MENTIONS_AND_REPLIES_ONLY: reply não é ao bot', { referenceMessageId: message.reference?.messageId ?? null });
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
    recordMessageDecision(message, 'skipped', 'sem texto ou mídia processável');
    logger.info(`ignorada: sem texto (${message.attachments.size} anexo(s), ${message.embeds.length} embed(s))`);
    return;
  }

  recordMessageDecision(message, 'accepted', null, { target: item.target, mentionsBot, replyToBot: item.replyToBot });

  // Entra no lote já (preserva a ordem de chegada); a referência e os anexos
  // são resolvidos em paralelo e aguardados antes de montar o texto.
  trackConversationWork(message, 1);
  item.ready = (referenceResolved ? Promise.resolve(reference) : resolveReference(message, item))
    .then(async (reference) => {
      await Promise.all([
        attachImages(item, reference, { where, who }),
        attachFiles(item, reference, { where, who }),
      ]);
    })
    .catch((err) => logger.warn({ canal: where, autor: who }, `leitura de anexos falhou (${err.message}); seguindo sem eles`))
    .finally(() => trackConversationWork(message, -1));
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
  for (const r of rejected) {
    logger.info({ canal: where, autor: who }, `imagem ignorada: ${r.name} (${r.reason})`);
    recordConversationEvent({ type: 'decision', guildId: message.guildId, channelId: message.channelId,
      createdAt: new Date(message.createdTimestamp).toISOString(), messageId: String(message.id),
      decision: 'media_not_processed', reason: r.reason, attachmentName: r.name });
  }
  if (images.length === 0) return;
  trackConversationWork(message, 1);
  const mediaImages = images.map((image, index) => ({ ...image, mediaAnalysisId: `image:${message.id}:${Date.now()}:${index + 1}:${crypto.randomUUID()}` }));
  item.mediaAnalysisIds = mediaImages.map((image) => image.mediaAnalysisId);
  const hint = stripBotMention(item.content, message);
  for (const [index, image] of mediaImages.entries()) {
    logger.info({ canal: where, autor: who, dica: hint || undefined }, `imagem recebida: ${image.name} (${image.size != null ? `${(image.size / 1e6).toFixed(1)} MB, ` : ''}${image.source}) → analisando`);
    recordConversationEvent({
      type: 'media_analysis_start', eventId: `${image.mediaAnalysisId}:start`, mediaAnalysisId: image.mediaAnalysisId,
      kind: 'image_description', status: 'started', guildId: message.guildId, channelId: message.channelId,
      sourceGuildId: image.sourceGuildId ?? message.guildId, sourceChannelId: image.sourceChannelId ?? message.channelId,
      triggerGuildId: message.guildId, triggerChannelId: message.channelId,
      createdAt: image.sourceCreatedAt ?? new Date(message.createdTimestamp).toISOString(),
      startedAt: new Date().toISOString(), backend: backend.name, model: config.model.vision ?? config.model.web ?? null,
      requestMessageId: String(message.id), requestAuthorId: String(message.author.id),
      sourceMessageId: image.sourceMessageId ?? String(message.id), sourceAuthorId: image.sourceAuthorId ?? String(message.author.id),
      sourceAuthorName: image.sourceAuthorName ?? who, source: image.source, position: index + 1,
      attachmentId: image.id == null ? null : String(image.id), name: image.name, url: image.url ?? null,
      contentType: image.contentType ?? null, size: image.size ?? null,
    });
  }
  // "digitando" durante toda a análise: sinaliza que o fluxo já começou e que
  // o lote fecha em seguida; a geração assume o indicador depois
  const typing = startTyping(message.channel);
  try {
    // mesmo contexto que a geração recebe (10 do canal + 5 do autor + 5 do bot),
    // para o analisador saber do que estão falando
    const { full: context } = await fetchContext([item]);
    item.images = await queue.add(() => analyzeImages(mediaImages, {
      dir: config.imagesDir,
      fileBase: message.id,
      hint,
      context,
      backend,
      config,
      monitor,
      analyzedMessageCount: 1,
      onResult: (r, seconds) => {
        const sourceImage = mediaImages.find((image) => image.mediaAnalysisId === r.mediaAnalysisId);
        recordConversationEvent({
          type: 'media_analysis_end', eventId: `${r.mediaAnalysisId}:end`, mediaAnalysisId: r.mediaAnalysisId,
          kind: 'image_description', status: r.error ? 'failed' : 'success', guildId: message.guildId, channelId: message.channelId,
          sourceGuildId: r.sourceGuildId ?? message.guildId, sourceChannelId: r.sourceChannelId ?? message.channelId,
          triggerGuildId: message.guildId, triggerChannelId: message.channelId,
          createdAt: r.sourceCreatedAt ?? new Date(message.createdTimestamp).toISOString(), observedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(), backend: backend.name, model: config.model.vision ?? config.model.web ?? null,
          requestMessageId: String(message.id), requestAuthorId: String(message.author.id),
          sourceMessageId: r.sourceMessageId ?? String(message.id), sourceAuthorId: r.sourceAuthorId ?? String(message.author.id),
          sourceAuthorName: r.sourceAuthorName ?? who, source: r.source, position: mediaImages.findIndex((image) => image.mediaAnalysisId === r.mediaAnalysisId) + 1,
          attachmentId: r.attachmentId ?? null, name: r.name, url: sourceImage?.url ?? null,
          contentType: sourceImage?.contentType ?? null, size: sourceImage?.size ?? null,
          output: r.description ?? null, error: r.error ?? null, durationMs: Math.round(seconds * 1000),
        });
        if (r.error) logger.warn({ canal: where, autor: who, segundos: seconds.toFixed(1) }, `falha ao analisar imagem ${r.name}: ${r.error}`);
        else logger.info({ canal: where, autor: who, segundos: seconds.toFixed(1), chars: r.description.length, resultado: r.description }, 'imagem descrita');
      },
    }), { priority: 'normal' });
  } finally {
    typing.stop();
    trackConversationWork(message, -1);
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
  const unavailableFiles = rejectedNonImages(rejected);
  for (const file of unavailableFiles) logger.info({ canal: where, autor: who }, `arquivo ignorado: ${file.name} (${file.reason})`);
  const unavailable = unavailableFiles.map((file) => ({ ...file, error: file.reason }));
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
  shuttingDown = true;
  clearInterval(monitorSampler);
  conversationCron?.stop();
  monitor.finishConnectionEpisode({ endedAt: Date.now(), reason: 'shutdown' });
  monitor.closeOpenOutages({ endedAt: Date.now(), reason: 'shutdown' });
  await client.destroy();
  recordConversationConnectionStatus('capture_stopped', { signal });
  if (conversationArchive) {
    const flushed = await conversationArchive.flush();
    if (!flushed) logger.error('captura de conversas não terminou de gravar durante o shutdown');
  }
  monitor.close();
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
  const { prompt: userPrompt, updatedAt: promptUpdatedAt } = userPromptStore.getState(last.author.id);
  if (store.get(key) && promptUpdatedAt != null && promptUpdatedAt >= store.startedAt(key)) {
    store.clear(key);
    clearContextMarkers(key);
    logger.info({ canal: where, autor: displayName(last) }, 'sessão reiniciada após mudança do prompt personalizado');
  }
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
    emphasizeQuote: backend.name === 'commandcode' || backend.name === 'codex',
    userPrompt,
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
  // Escolha fora da lista atual (ex.: troca de backend) fica salva, mas esta
  // execução usa o modelo e esforço padrão do backend ativo.
  const savedChoice = modelStore?.get(last.author.id);
  const entry = entryByValue.get(savedChoice);
  if (savedChoice && !entry) {
    logger.warn({ canal: where, autor: displayName(last), escolha: savedChoice }, 'escolha de modelo fora da lista atual: usando o padrão');
  }
  logger.info({ canal: where, autor: displayName(last), modo: mode, mensagens: items.length, contexto: context.length, sessao: store.get(key) ?? 'nova' }, `gerando com ${entry ? choiceName(entry) : (config.model?.[mode] ?? 'padrão do CLI')}`);
  trackConversationWork(last, 1);
  const typing = startTyping(last.channel);
  const started = Date.now();
  const requestedModel = entry?.model ?? config.model?.[mode] ?? null;
  const generationId = monitor.startGeneration({
    startedAt: started,
    backend: backend.name,
    mode,
    model: requestedModel,
    effort: entry ? entry.effort ?? null : config.effort?.[mode] ?? null,
    analyzedMessageCount: items.length + context.length,
  });
  const promptSnapshotId = `prompt:${generationId}`;
  const metricsEvents = createBackendMetricHandler({ monitor, generationId, backendName: backend.name, fallbackModel: requestedModel });
  let backendSucceeded = false;
  let generatedText = null;
  let sessionReset = null;
  let deliveredText = null;
  let deliveryError = null;
  let responseTargetId = last.id == null ? null : String(last.id);
  let generationOutcome = 'failed';
  const deliveredMessages = [];
  const noteSent = (sentMessage, content) => {
    if (sentMessage?.id) deliveredMessages.push({ messageId: String(sentMessage.id), content });
  };
  const onEvent = (event, metadata) => {
    metricsEvents(event, metadata);
    const activity = backend.describeEvent(event);
    if (!activity) return;
    logger.info(`${backend.name}: ${activity}`);
    typing.poke(); // "digitando" enquanto ele pesquisa/usa ferramentas
  };
  // Daqui em diante mensagem nova do autor não cancela mais (ver inflight.js).
  inflight.lock(run);
  try {
    const requestSnapshot = backend.buildRequest({
      mode, sessionId: store.get(key), workDir: mode === 'full' ? config.workDir : config.webDir,
      extraPrompt: config.extraPrompt?.[mode], model: entry?.model ?? config.model?.[mode],
      effort: entry ? entry.effort ?? null : config.effort?.[mode], maxTurns: config.maxTurns?.[mode], prompt,
    });
    recordConversationEvent({
      type: 'prompt_snapshot', eventId: promptSnapshotId, generationId, guildId: last.guildId, channelId: last.channelId,
      createdAt: new Date(started).toISOString(), mode, backend: backend.name,
      systemPrompt: requestSnapshot.systemPrompt ?? requestSnapshot.instructions ?? null,
      extraPromptFile: prompts[mode]?.file ?? null,
    });
    recordConversationEvent({
      type: 'generation_start', eventId: `generation:${generationId}:start`, generationId, promptSnapshotId,
      guildId: last.guildId, channelId: last.channelId, createdAt: new Date(started).toISOString(),
      backend: backend.name, mode, model: requestedModel, effort: entry ? entry.effort ?? null : config.effort?.[mode] ?? null,
      sessionMode: store.get(key) ? 'resumed' : 'new',
      sourceMessageIds: items.map((item) => String(item.message.id)), contextMessageIds: context.map((event) => String(event.id)),
      mediaAnalysisIds: items.flatMap((item) => item.mediaAnalysisIds ?? []),
      fileTexts: items.flatMap((item) => (item.files ?? []).map((file) => ({ sourceMessageId: String(item.message.id), name: file.name, text: file.text ?? null, error: file.error ?? null }))),
      prompt,
    });
    const sessionBefore = store.get(key);
    const res = await askClaude({ key, mode, prompt, store, config, backend, onEvent, signal, now, messageCount: items.length + context.length, model: entry?.model, effort: entry?.effort });
    backendSucceeded = !res.isError;
    generatedText = res.text ?? '';
    sessionReset = res.sessionReset ?? null;
    generationOutcome = res.isError ? 'model_failed' : isNoReply(res.text) ? 'no_reply' : 'awaiting_delivery';
    if (!metricsEvents.hasTokenEvents(res.attemptNumber)) {
      for (const [index, usage] of (res.tokenUsage ?? []).entries()) {
        monitor.recordTokenUsage({
          generationId,
          sourceKey: `${backend.name}:result:${index}`,
          granularity: 'generation',
          measuredAt: Date.now(),
          ...usage,
          model: usage.model ?? requestedModel,
        });
      }
    }
    monitor.finishGeneration({
      id: generationId,
      finishedAt: Date.now(),
      modelSucceeded: !res.isError,
      outcome: res.isError ? 'failed' : isNoReply(res.text) ? 'no_reply' : 'awaiting_reply',
    });
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
      deliveredText = `⚠️ ${backend.name} retornou erro (${res.subtype}): ${res.text}`;
      await send(last, deliveredText, { onSent: noteSent });
    } else if (isNoReply(res.text)) {
      logger.info({ canal: where, autor: displayName(last), ...stats }, `${backend.name} decidiu não responder: ${oneLine(last.cleanContent)}`);
    } else {
      const { replyTo, text } = target ? parseDirective(res.text) : { replyTo: null, text: res.text };
      deliveredText = text;
      const replyMessage = replyTo ? await resolveReplyTarget(last.channel, context[replyTo - 1], replyTo) : null;
      responseTargetId = String((replyMessage ?? last).id);
      logger.info({ ...stats, chars: text.length, respondendoA: replyMessage ? `#${replyTo}` : undefined }, 'enviando para o discord');
      const sent = await send(replyMessage ?? last, text, { onSent: noteSent });
      if (sent?.ok) {
        generationOutcome = 'delivered';
        monitor.markReplied({ id: generationId });
        logger.info('resposta enviada');
      } else {
        generationOutcome = 'delivery_failed';
        monitor.setGenerationOutcome(generationId, 'delivery_failed');
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      if (backendSucceeded) monitor.setGenerationOutcome(generationId, 'delivery_cancelled');
      else monitor.finishGeneration({ id: generationId, modelSucceeded: false, outcome: 'cancelled' });
      generationOutcome = 'cancelled';
      logger.info({ canal: where, segundos: ((Date.now() - started) / 1000).toFixed(1) }, 'geração descartada');
      return;
    }
    if (backendSucceeded) { monitor.setGenerationOutcome(generationId, 'delivery_failed'); generationOutcome = 'delivery_failed'; }
    else { monitor.finishGeneration({ id: generationId, modelSucceeded: false, outcome: 'failed' }); generationOutcome = 'failed'; }
    logger.error({ err }, 'falha ao gerar resposta');
    deliveryError = err.message;
    if (!backendSucceeded) deliveredText = `⚠️ ${err.message}`;
    await send(last, `⚠️ ${err.message}`, { onSent: noteSent }).catch(() => {});
  } finally {
    recordConversationEvent({
      type: 'generation_end', eventId: `generation:${generationId}:end`, generationId, promptSnapshotId,
      guildId: last.guildId, channelId: last.channelId, createdAt: new Date(started).toISOString(),
      finishedAt: new Date().toISOString(), outcome: generationOutcome, generatedText, deliveredText, sessionReset,
      sourceMessageIds: items.map((item) => String(item.message.id)),
      mediaAnalysisIds: items.flatMap((item) => item.mediaAnalysisIds ?? []),
      deliveredMessages, deliveryError, replyToMessageId: responseTargetId,
    });
    typing.stop();
    trackConversationWork(last, -1);
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

async function send(message, text, { onSent = () => {} } = {}) {
  const chunks = splitMessage(text);
  if (chunks.length === 0) return false;
  const allowedMentions = { parse: ['users'], repliedUser: true }; // nunca @everyone/cargos vindos do texto gerado
  const flags = MessageFlags.SuppressEmbeds;
  const sentMessages = [];
  try {
    sentMessages.push(await message.reply({ content: chunks[0], allowedMentions, flags }));
  } catch (err) {
    // Mensagem original apagada durante o processamento: manda no canal mesmo assim
    logger.warn(`reply falhou (${err.message}); enviando no canal`);
    sentMessages.push(await message.channel.send({ content: chunks[0], allowedMentions, flags }));
  }
  onSent(sentMessages[0], chunks[0]);
  for (const chunk of chunks.slice(1)) {
    const sent = await message.channel.send({ content: chunk, allowedMentions, flags });
    sentMessages.push(sent);
    onSent(sent, chunk);
  }
  return { ok: true, messageIds: sentMessages.map((sent) => String(sent.id)) };
}

const uniqueBy = (list, keyOf) => [...new Map(list.map((x) => [keyOf(x), x])).values()];
const displayName = (message) => message.member?.displayName ?? message.author.displayName;
// Cargos do membro: GuildMember (cache de roles) ou, em interações sem cache, lista de ids.
const roleIds = (member) => (Array.isArray(member?.roles) ? member.roles : [...(member?.roles?.cache?.keys() ?? [])]);
const oneLine = (text) => (text ?? '').replace(/\s+/g, ' ');
const preview = (text) => oneLine(text).slice(0, 80);

function formatUtc(timestamp) {
  return new Date(timestamp).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function formatUtcHour(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 13).replace('T', ' ') + 'h UTC';
}

function formatDuration(milliseconds) {
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  const totalSeconds = Math.floor(milliseconds / 1_000);
  if (totalSeconds < 60) return `${(milliseconds / 1_000).toFixed(1)} s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) return `${totalMinutes}m ${seconds}s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return `${hours}h ${minutes}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function formatAggregate(value, records) {
  return records > 0 ? String(value) : '—';
}

function paginateMetrics(lines) {
  const pages = [];
  let page = '';
  for (const source of lines) {
    const line = source.length > 1_800 ? `${source.slice(0, 1_797)}...` : source;
    const next = page ? `${page}\n\n${line}` : line;
    if (next.length > 1_900 && page) {
      pages.push(page);
      page = line;
    } else {
      page = next;
    }
  }
  if (page) pages.push(page);
  return pages;
}

client.login(token).catch((err) => {
  logger.error(`falha no login do Discord: ${err.message}`);
  shuttingDown = true;
  clearInterval(monitorSampler);
  conversationCron?.stop();
  monitor.finishConnectionEpisode({ endedAt: Date.now(), reason: 'shutdown' });
  monitor.closeOpenOutages({ endedAt: Date.now(), reason: 'shutdown' });
  if (conversationArchive) void conversationArchive.flush();
  monitor.close();
  process.exitCode = 1;
  client.destroy();
});
