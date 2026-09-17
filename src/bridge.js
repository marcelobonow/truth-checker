import { buildArgs, runClaude, NO_REPLY } from './claude.js';

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

export function sessionKey({ guildId, isTarget }) {
  return isTarget ? guildId : `${guildId}:public`;
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
export function buildUserMessage({ guildName, channelName, authorName, items, context = [], mentions = [], indexed = false }) {
  const forced = items.some((i) => i.replyToBot || i.mentionsBot);
  let header = `[discord] servidor: ${guildName} | canal: #${channelName} | autor: ${authorName} | responder: ${forced ? 'sempre' : 'se couber'}`;
  if (indexed && mentions.length > 0) {
    header += `\npessoas citadas: ${mentions.map((m) => `${m.name} → <@${m.id}>`).join(', ')}`;
  }
  const lines = items.map((item) => {
    const quote = item.quoted ? `(em resposta a ${item.quoted.author}: "${item.quoted.content}") ` : '';
    return quote + item.content;
  });
  const body = lines.length === 1 ? lines[0] : lines.map((line, i) => `${i + 1}. ${line}`).join('\n');
  if (context.length === 0) return `${header}\n${body}`;

  const contextLines = context.map((m, i) => `- ${indexed ? `#${i + 1} ` : ''}${m.authorName}: ${m.content}`);
  return [header, 'contexto recente do canal (mais antigo primeiro):', ...contextLines, 'mensagens novas:', body].join('\n');
}

// Primeira linha "[responder: #n]" da resposta: pedido de reply na mensagem #n
// do contexto (1-based). Devolve o índice e o texto sem a linha.
const DIRECTIVE_RE = /^\s*\[responder:\s*#(\d+)\]\s*\n?/i;

export function parseDirective(text) {
  const m = text.match(DIRECTIVE_RE);
  if (!m) return { replyTo: null, text };
  return { replyTo: Number(m[1]), text: text.slice(m[0].length).replace(/^\s+/, '') };
}

export function isNoReply(text) {
  return text.trim().replace(/^[`\s]+|[`\s.!]+$/g, '') === NO_REPLY;
}

// Mensagem exata do CLI ao retomar sessão inexistente (verificada em 2026-09-17).
const RESUME_FAILURE = /No conversation found with session ID/i;

// Motivo para começar uma sessão nova em vez de retomar (ou null).
export function sessionResetReason(info, { maxMessages, idleMs }, now) {
  if (!info) return null;
  if (maxMessages > 0 && info.messages >= maxMessages) return 'mensagens';
  if (idleMs > 0 && now - info.lastUsed > idleMs) return 'inatividade';
  return null;
}

// Uma execução do claude na sessão `key`, com retomada; se a sessão salva não
// existir mais, apaga e tenta uma vez do zero. `messageCount` (mensagens do
// lote + contexto) alimenta o reinício automático por volume/inatividade.
export async function askClaude({ key, mode, prompt, store, config, runner = runClaude, onEvent, messageCount = 0, now = Date.now(), signal }) {
  const cwd = mode === 'full' ? config.workDir : config.webDir;
  const sessionReset = config.session ? sessionResetReason(store.info?.(key), config.session, now) : null;
  if (sessionReset) store.clear(key);
  const run = (sessionId) =>
    runner({
      prompt,
      args: buildArgs({
        mode,
        sessionId,
        workDir: cwd,
        extraPrompt: config.extraPrompt?.[mode],
        model: config.model?.[mode],
        effort: config.effort?.[mode],
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
    // stderr completo (a mensagem do erro é truncada e pode esconder a frase)
    if (err.name === 'AbortError' || !sessionId || !RESUME_FAILURE.test(`${err.stderr ?? ''}\n${err.message}`)) throw err;
    store.clear(key);
    result = await run(undefined);
  }

  if (result.sessionId) {
    store.set(key, result.sessionId);
    store.touch?.(key, messageCount, now);
  }
  return { ...result, sessionReset };
}
