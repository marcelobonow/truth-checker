import * as claude from './claude.js';
import { NO_REPLY } from './prompts.js';
import { formatImage } from './images.js';

// Regras de roteamento (ver docs/superpowers/specs, §2 e §3).

export function resolveMode({ guildId, isTarget }, config) {
  return isTarget && config.fullAccessGuildIds.includes(guildId) ? 'full' : 'web';
}

// Por que a mensagem não será analisada (texto para o log), ou null se for.
export function skipReason({ authorId, isBot, guildId, channelId, mentionsBot }, config) {
  if (isBot) return 'autor é bot';
  if (!guildId) return 'fora de servidor (DM)';
  if (config.watchChannelIds.length > 0 && !config.watchChannelIds.includes(channelId)) return 'canal fora de WATCH_CHANNEL_IDS';
  if (config.targetUserIds.includes(authorId)) return null;
  if (!mentionsBot) return 'usuário fora da whitelist e sem menção ao bot';
  return config.mentionAnyone ? null : 'usuário fora da whitelist (MENTION_ANYONE desligado)';
}

export function shouldHandle(meta, config) {
  return skipReason(meta, config) === null;
}

// Texto de verdade na mensagem (conteúdo bruto, com <@id>): menções de
// usuário/cargo/canal sozinhas não contam. Mensagem só com imagem não é
// analisada; "@bot" + imagem passa por outra regra (imagens em index.js).
export function hasText(rawContent) {
  return (rawContent ?? '').replace(/<[@#][!&]?\d+>/g, '').trim().length > 0;
}

// "@Nome" escrito como texto (mensagem copiada/colada ou digitada sem escolher
// no autocomplete): o Discord não registra menção, mas a intenção é a mesma.
// `names`: nome de usuário e apelido do bot no servidor. Texto bruto, onde a
// menção real aparece como <@id> e não confunde.
export function mentionsByName(rawContent, names) {
  const text = rawContent ?? '';
  return names.filter(Boolean).some((name) => new RegExp(`(^|\\s)@${escapeRegExp(name)}(?![\\w-])`, 'iu').test(text));
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function sessionKey({ guildId, isTarget }) {
  return isTarget ? guildId : `${guildId}:public`;
}

// Resposta do "/status": tamanho da sessão atual (mensagens/limite) e
// inatividade, para decidir se vale a pena `/reset` antes de continuar.
// `queued` (opcional): gerações na fila serial, contando a em andamento;
// `waiting` (opcional): lotes ainda na janela de silêncio, antes de entrar na fila.
export function formatStatus(info, { maxMessages, maxContextTokens, queued, waiting }, now = Date.now()) {
  let text;
  if (!info) {
    text = 'Online. Nenhuma sessão ativa neste servidor.';
  } else {
    const idleMin = Math.floor((now - info.lastUsed) / 60_000);
    const limit = maxMessages > 0 ? `/${maxMessages}` : '';
    const k = (n) => `${Math.round(n / 1000)}k`;
    const tokens = `${k(info.contextTokens ?? 0)}${maxContextTokens > 0 ? `/${k(maxContextTokens)}` : ''} tokens`;
    text = `Online. Sessão: ${info.messages}${limit} mensagens, ${tokens}, inativa há ${idleMin}min.`;
  }
  if (queued == null) return text;
  const fila = queued === 0 ? 'Fila: vazia' : `Fila: ${queued} ${queued === 1 ? 'geração' : 'gerações'} (1 em andamento)`;
  const espera = waiting > 0 ? `; ${waiting} ${waiting === 1 ? 'lote' : 'lotes'} esperando fechar` : '';
  return `${text} ${fila}${espera}.`;
}

// Contexto do canal: as últimas `channel` mensagens + as últimas `author`
// mensagens de cada pessoa em `authorIds` (quem escreveu e quem foi citado),
// unidas sem duplicar, em ordem cronológica.
// `history` pode vir em qualquer ordem; mensagens vazias e as do próprio lote ficam de fora.
export function selectContext(history, { channel, author, authorId, authorIds = [authorId], excludeIds }) {
  const usable = history
    .filter((m) => m.content.trim() && !excludeIds.includes(m.id))
    .sort((a, b) => a.timestamp - b.timestamp);
  const lastOfChannel = usable.slice(-channel);
  const lastOfAuthors = authorIds.flatMap((id) => usable.filter((m) => m.authorId === id).slice(-author));
  const chosen = new Map([...lastOfAuthors, ...lastOfChannel].map((m) => [m.id, m]));
  return [...chosen.values()].sort((a, b) => a.timestamp - b.timestamp);
}

// Cabeçalho de metadados + pessoas citadas + contexto recente (opcional) +
// mensagens do lote (formato descrito no system prompt). `indexed` (lotes da
// whitelist): lista os citados com id e numera o contexto (#n) para o Claude
// poder pedir reply numa mensagem específica.
// Mensagens de contexto mais antigas que isso (em relação à mensagem que
// disparou o lote) ganham um prefixo de hora, para o Claude perceber que
// pode não ser mais a mesma conversa.
const STALE_CONTEXT_MS = 10 * 60_000;

const formatTime = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// `emphasizeQuote`: modelos menores tomam a pergunta citada num reply a outra
// pessoa como se fosse para o bot; repete na própria citação que não é.
export function buildUserMessage({ guildName, channelName, authorName, items, context = [], mentions = [], indexed = false, referenceTimestamp = Date.now(), emphasizeQuote = false }) {
  const forced = items.some((i) => i.replyToBot || i.mentionsBot);
  let header = `[discord] servidor: ${guildName} | canal: #${channelName} | autor: ${authorName} | responder: ${forced ? 'sempre' : 'se couber'}`;
  if (indexed && mentions.length > 0) {
    header += `\npessoas citadas: ${mentions.map((m) => `${m.name} → <@${m.id}>`).join(', ')}`;
  }
  // o que é do autor: descrições das imagens (src/images.js) no lugar delas, antes do texto
  const own = items.map((item) => [...(item.images ?? []).map(formatImage), item.content].filter(Boolean).join(' '));
  const lines = items.map((item, i) => {
    const who = emphasizeQuote ? `${item.quoted?.author}, não a você` : item.quoted?.author;
    const quote = item.quoted ? `(em resposta a ${who}: "${item.quoted.content}") ` : '';
    return quote + own[i];
  });
  const body = lines.length === 1 ? lines[0] : lines.map((line, i) => `${i + 1}. ${line}`).join('\n');
  // Lembrete no fim: a sessão é compartilhada e o lote espera alguns segundos,
  // então há mensagens de outras pessoas antes e depois; deixa explícito a
  // quem e a quê responder.
  const reminder = `>> responda a ${authorName}: só às mensagens novas acima (a última: "${preview(own.at(-1))}"). Mensagens de outras pessoas, no contexto ou em rodadas anteriores, são pano de fundo, não o que você responde.`;
  if (context.length === 0) return [header, body, reminder].join('\n');

  const contextLines = context.map((m, i) => {
    const stale = m.timestamp != null && referenceTimestamp - m.timestamp > STALE_CONTEXT_MS;
    const time = stale ? `[${formatTime(m.timestamp)}] ` : '';
    return `- ${time}${indexed ? `#${i + 1} ` : ''}${m.authorName}: ${m.content}`;
  });
  return [header, 'contexto recente do canal (mais antigo primeiro):', ...contextLines, 'mensagens novas:', body, reminder].join('\n');
}

const preview = (text, max = 80) => {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

// "[responder: #n]" no começo de uma das primeiras linhas da resposta: pedido
// de reply na mensagem #n do contexto (1-based). Devolve o índice e o texto
// sem a diretiva e sem o que veio antes dela (alguns modelos anunciam "a
// resposta para postar é:" antes; isso não vai para o Discord).
const DIRECTIVE_RE = /^\s*\[responder:\s*#(\d+)\]\s*\n?/i;
const DIRECTIVE_MAX_LINE = 3; // linhas de preâmbulo toleradas antes da diretiva

export function parseDirective(text) {
  const lines = text.split('\n');
  for (let i = 0; i < Math.min(lines.length, DIRECTIVE_MAX_LINE + 1); i++) {
    const rest = lines.slice(i).join('\n');
    const m = rest.match(DIRECTIVE_RE);
    if (m) return { replyTo: Number(m[1]), text: rest.slice(m[0].length).replace(/^\s+/, '') };
  }
  return { replyTo: null, text };
}

export function isNoReply(text) {
  return text.trim().replace(/^[`\s]+|[`\s.!]+$/g, '') === NO_REPLY;
}

// Motivo para começar uma sessão nova em vez de retomar (ou null).
export function sessionResetReason(info, { maxMessages, maxContextTokens = 0, idleMs }, now) {
  if (!info) return null;
  if (maxMessages > 0 && info.messages >= maxMessages) return 'mensagens';
  if (maxContextTokens > 0 && (info.contextTokens ?? 0) >= maxContextTokens) return 'tokens';
  if (idleMs > 0 && now - info.lastUsed > idleMs) return 'inatividade';
  return null;
}

// Uma execução do claude na sessão `key`, com retomada; se a sessão salva não
// existir mais, apaga e tenta uma vez do zero. `messageCount` (mensagens do
// lote + contexto) alimenta o reinício automático por volume/inatividade.
export async function askClaude({ key, mode, prompt, store, config, backend = claude, runner = backend.run, onEvent, messageCount = 0, now = Date.now(), signal }) {
  const cwd = mode === 'full' ? config.workDir : config.webDir;
  const sessionReset = config.session ? sessionResetReason(store.info?.(key), config.session, now) : null;
  if (sessionReset) store.clear(key);
  const run = (sessionId) =>
    runner({
      ...backend.buildRequest({
        mode,
        sessionId,
        workDir: cwd,
        extraPrompt: config.extraPrompt?.[mode],
        model: config.model?.[mode],
        effort: config.effort?.[mode],
        maxTurns: config.maxTurns?.[mode],
        prompt,
      }),
      cwd,
      bin: config.bin,
      timeoutMs: config.timeoutMs,
      onEvent,
      signal,
    });

  const sessionId = store.get(key);
  let result;
  try {
    result = await run(sessionId);
  } catch (err) {
    if (err.name === 'AbortError' || !sessionId || !backend.isSessionMissing(err)) throw err;
    store.clear(key);
    result = await run(undefined);
  }

  if (result.sessionId) {
    store.set(key, result.sessionId);
    store.touch?.(key, messageCount, now, result.contextTokens);
  }
  return { ...result, sessionReset };
}
