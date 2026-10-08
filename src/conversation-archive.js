import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { compareConversationEvents } from './conversation-order.js';

const SCHEMA_VERSION = 1;
const EVENT_TYPES = new Set(['message', 'decision', 'media_analysis_start', 'media_analysis_end', 'generation_start', 'generation_end', 'prompt_snapshot', 'capture_status']);

export function localDateInZone(timestamp, timeZone = 'America/Sao_Paulo') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp));
  const fields = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export function createConversationArchive({ root, timeZone = 'America/Sao_Paulo', watchChannelIds = [], maxQueueBytes = 8_000_000, now = Date.now, onError = () => {} }) {
  if (!root) throw new TypeError('root é obrigatório');
  if (!Number.isFinite(maxQueueBytes) || maxQueueBytes <= 0) throw new RangeError('maxQueueBytes deve ser positivo');
  const base = path.resolve(root);
  const watched = new Set(watchChannelIds.map(String));
  const queues = new Map();
  const pendingEvents = new Set();
  const dropped = new Map();
  let pendingBytes = 0;
  let rootReady;

  const filePath = (guildId, channelId, localDate) => path.join(base, segment(guildId), segment(channelId), `conversa-${validDate(localDate)}.jsonl`);
  const prepareRoot = () => rootReady ??= (async () => {
    await fsp.mkdir(base, { recursive: true });
    const marker = path.join(base, 'timezone.json');
    try {
      const saved = JSON.parse(await fsp.readFile(marker, 'utf8'));
      if (saved.timeZone !== timeZone) throw new Error(`fuso de conversas mudou de ${saved.timeZone} para ${timeZone}; configure uma nova raiz ou migre os arquivos`);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      await atomicWrite(marker, `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, timeZone }, null, 2)}\n`);
    }
  })();

  function queueFor(file) {
    let queue = queues.get(file);
    if (!queue) {
      queue = { tail: Promise.resolve(), loaded: false, seen: new Set(), pending: 0 };
      queues.set(file, queue);
    }
    return queue;
  }

  function captureAllowed(message) {
    if (!message.guildId || !message.channelId) return false;
    if (watched.size === 0 || watched.has(String(message.channelId))) return true;
    const isThread = Boolean(message.channel?.isThread?.() ?? message.channel?.parentId);
    return isThread && watched.has(String(message.channel?.parentId));
  }

  function recordMessage(message, { botId } = {}) {
    if (!captureAllowed(message)) return Promise.resolve(false);
    const guildId = String(message.guildId);
    const channelId = String(message.channelId);
    const createdTimestamp = Number(message.createdTimestamp ?? Date.parse(message.createdAt ?? now()));
    const localDate = localDateInZone(createdTimestamp, timeZone);
    const event = {
      type: 'message', eventId: `message:${message.id}`, messageId: String(message.id),
      guildId, guildName: message.guild?.name ?? null, channelId, channelName: message.channel?.name ?? null,
      parentChannelId: message.channel?.parentId ? String(message.channel.parentId) : null,
      channelType: message.channel?.type ?? null, channelIsThread: Boolean(message.channel?.isThread?.()),
      createdAt: new Date(createdTimestamp).toISOString(), observedAt: new Date(now()).toISOString(), localDate, timeZone,
      authorId: String(message.author?.id ?? ''), authorName: message.member?.displayName ?? message.author?.globalName ?? message.author?.username ?? 'desconhecido',
      authorIsBot: Boolean(message.author?.bot), isOwnBot: botId != null && String(message.author?.id) === String(botId), webhookId: message.webhookId ?? null,
      authorUsername: message.author?.username ?? null, authorGlobalName: message.author?.globalName ?? null,
      messageType: message.type ?? null, system: Boolean(message.system), pinned: Boolean(message.pinned), editedAt: message.editedAt?.toISOString?.() ?? null,
      flags: message.flags?.bitfield ?? null, applicationId: message.applicationId ?? null,
      content: typeof message.content === 'string' ? message.content : null,
      cleanContent: typeof message.cleanContent === 'string' ? message.cleanContent : null,
      contentUnavailable: typeof message.content !== 'string',
      mentionUserIds: values(message.mentions?.users).map((user) => String(user.id)),
      mentionRoleIds: values(message.mentions?.roles).map((role) => String(role.id)),
      mentionChannelIds: values(message.mentions?.channels).map((channel) => String(channel.id)),
      mentionsEveryone: Boolean(message.mentions?.everyone),
      reference: message.reference ? {
        messageId: message.reference.messageId == null ? null : String(message.reference.messageId),
        channelId: message.reference.channelId == null ? null : String(message.reference.channelId),
        guildId: message.reference.guildId == null ? null : String(message.reference.guildId),
      } : null,
      attachments: values(message.attachments).map((attachment) => ({
        id: attachment.id == null ? null : String(attachment.id), name: attachment.name ?? null,
        url: attachment.url ?? null, contentType: attachment.contentType ?? null, size: attachment.size ?? null,
        description: attachment.description ?? null, duration: attachment.duration ?? null, spoiler: Boolean(attachment.spoiler),
      })),
      embeds: values(message.embeds).map(embedRecord),
      stickers: values(message.stickers).map((sticker) => ({ id: String(sticker.id), name: sticker.name ?? null, format: sticker.format ?? null })),
      components: (message.components ?? []).map(componentRecord),
      poll: message.poll ? { question: message.poll.question?.text ?? null, answers: values(message.poll.answers).map((answer) => ({ id: answer.id ?? null, text: answer.text ?? null })) } : null,
      interaction: message.interaction ? { id: message.interaction.id ?? null, type: message.interaction.type ?? null, name: message.interaction.commandName ?? null, userId: message.interaction.user?.id ?? null } : null,
      interactionMetadata: message.interactionMetadata ? { id: message.interactionMetadata.id ?? null, type: message.interactionMetadata.type ?? null, userId: message.interactionMetadata.user?.id ?? null, originalResponseMessageId: message.interactionMetadata.originalResponseMessageId ?? null } : null,
    };
    return recordEvent(event);
  }

  function recordEvent(input) {
    const guildId = String(input.guildId ?? '');
    const channelId = String(input.channelId ?? '');
    if (!guildId || !channelId) return Promise.resolve(false);
    if (!EVENT_TYPES.has(input.type)) return Promise.reject(new Error(`tipo de evento desconhecido: ${input.type}`));
    const observedAt = input.observedAt ?? new Date(now()).toISOString();
    const localDate = input.localDate ?? localDateInZone(input.createdAt ?? observedAt, timeZone);
    const event = { ...input, schemaVersion: SCHEMA_VERSION, guildId, channelId, eventId: String(input.eventId ?? `${input.type}:${randomId()}`), observedAt, localDate, timeZone };
    const file = filePath(guildId, channelId, localDate);
    const jsonLine = `${JSON.stringify(event)}\n`;
    const bytes = Buffer.byteLength(jsonLine);
    if (pendingBytes + bytes > maxQueueBytes) {
      const entry = dropped.get(file) ?? { count: 0, guildId, channelId, localDate };
      entry.count++;
      dropped.set(file, entry);
      return Promise.resolve(false);
    }
    pendingBytes += bytes;
    pendingEvents.add(file);
    const queue = queueFor(file);
    queue.pending++;
    const run = queue.tail.then(async () => {
      await prepareRoot();
      await recoverTail(file);
      if (!queue.loaded) {
        queue.seen = await readIds(file);
        queue.loaded = true;
      }
      const eventKey = event.type === 'message' && event.messageId ? `message:${event.messageId}` : event.eventId;
      if (queue.seen.has(eventKey)) return false;
      const lost = dropped.get(file)?.count ?? 0;
      if (lost > 0) {
        const gap = {
          schemaVersion: SCHEMA_VERSION, type: 'capture_status', eventId: `capture-gap:${localDate}:${event.eventId}`,
          guildId, channelId, localDate, timeZone, observedAt: new Date(now()).toISOString(),
          status: 'gap', lostRecords: lost, reason: 'limite de fila de captura excedido',
        };
        await appendLine(file, `${JSON.stringify(gap)}\n`);
        queue.seen.add(gap.eventId);
        dropped.delete(file);
      }
      await appendLine(file, jsonLine);
      queue.seen.add(eventKey);
      return true;
    }).finally(() => {
      queue.pending--;
      pendingBytes -= bytes;
      if (queue.pending === 0) pendingEvents.delete(file);
    });
    queue.tail = run.catch((err) => {
      queue.loaded = false;
      const entry = dropped.get(file) ?? { count: 0, guildId, channelId, localDate };
      entry.count++;
      dropped.set(file, entry);
      onError(err);
    });
    return run;
  }

  async function* iterateDay({ guildId, channelId, localDate }) {
    const file = filePath(guildId, channelId, localDate);
    await prepareRoot();
    let lineNo = 0;
    try { await fsp.access(file); } catch (err) { if (err.code === 'ENOENT') return; throw err; }
    const input = fs.createReadStream(file, { encoding: 'utf8' });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        lineNo++;
        if (!line) continue;
        let event;
        try { event = JSON.parse(line); } catch { throw new Error(`JSON inválido em ${file}, linha ${lineNo}`); }
        if (event.schemaVersion !== SCHEMA_VERSION) throw new Error(`schemaVersion desconhecida (${event.schemaVersion}) em ${file}, linha ${lineNo}`);
        if (!EVENT_TYPES.has(event.type)) throw new Error(`tipo de evento desconhecido (${event.type}) em ${file}, linha ${lineNo}`);
        yield event;
      }
    } finally { lines.close(); input.destroy(); }
  }

  async function neighbors({ guildId, channelId, localDate, limit = 20 }) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit de mensagens vizinhas deve ser positivo');
    const previousDate = shiftDate(localDate, -1);
    const nextDate = shiftDate(localDate, 1);
    const previous = [];
    for await (const event of iterateDay({ guildId, channelId, localDate: previousDate })) {
      if (event.type !== 'message') continue;
      previous.push(event);
      previous.sort(compareConversationEvents);
      if (previous.length > limit) previous.shift();
    }
    const next = [];
    for await (const event of iterateDay({ guildId, channelId, localDate: nextDate })) {
      if (event.type !== 'message') continue;
      next.push(event);
      next.sort(compareConversationEvents);
      if (next.length > limit) next.pop();
    }
    return { previous, next, previousDate, nextDate };
  }

  async function flush(timeoutMs = 5_000) {
    const waits = [...queues.values()].map(({ tail }) => tail);
    for (const [file, entry] of dropped) {
      const amount = entry.count;
      const queue = queueFor(file);
      const writeGap = queue.tail.then(async () => {
        await prepareRoot();
        await recoverTail(file);
        const gap = {
          schemaVersion: SCHEMA_VERSION, type: 'capture_status', eventId: `capture-gap:${entry.localDate}:${randomId()}`,
          guildId: entry.guildId, channelId: entry.channelId, localDate: entry.localDate, timeZone,
          observedAt: new Date(now()).toISOString(), status: 'gap', lostRecords: amount,
          reason: 'falha ou limite de fila de captura',
        };
        await appendLine(file, `${JSON.stringify(gap)}\n`);
      });
      queue.tail = writeGap.catch((err) => { onError(err); });
      waits.push(writeGap);
      if (dropped.get(file)?.count === amount) dropped.delete(file);
      else if (dropped.has(file)) dropped.get(file).count -= amount;
    }
    if (waits.length === 0) return dropped.size === 0;
    let timer;
    const done = Promise.allSettled(waits);
    const timedOut = new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
    const result = await Promise.race([done.then(() => true), timedOut]);
    clearTimeout(timer);
    return result;
  }

  async function listRecordedChannels() {
    await prepareRoot();
    const channels = [];
    for (const guild of await fsp.readdir(base, { withFileTypes: true })) {
      if (!guild.isDirectory() || guild.name.startsWith('.')) continue;
      const guildPath = path.join(base, guild.name);
      for (const channel of await fsp.readdir(guildPath, { withFileTypes: true })) {
        if (!channel.isDirectory()) continue;
        const channelPath = path.join(guildPath, channel.name);
        const files = await fsp.readdir(channelPath);
        if (files.some((file) => /^conversa-\d{4}-\d{2}-\d{2}\.jsonl$/.test(file))) {
          channels.push({ guildId: guild.name, channelId: channel.name });
        }
      }
    }
    return channels;
  }

  function recordStatus({ guildId, channelId, status, ...fields }) {
    return recordEvent({ type: 'capture_status', eventId: `status:${status}:${randomId()}`, guildId, channelId, status, ...fields });
  }

  return { root: base, timeZone, filePath, captureAllowed, recordMessage, recordEvent, recordStatus, iterateDay, neighbors, listRecordedChannels, flush, get pendingBytes() { return pendingBytes; } };
}

async function recoverTail(file) {
  let data;
  try { data = await fsp.readFile(file); } catch (err) { if (err.code === 'ENOENT') return; throw err; }
  if (data.length === 0 || data.at(-1) === 10) return;
  const lastNewline = data.lastIndexOf(10);
  const tail = data.subarray(lastNewline + 1);
  try {
    JSON.parse(tail.toString('utf8'));
    await fsp.appendFile(file, '\n', 'utf8');
  } catch {
    const valid = data.subarray(0, lastNewline + 1);
    await fsp.writeFile(`${file}.corrupt`, tail);
    await fsp.writeFile(file, valid);
  }
}

async function readIds(file) {
  const ids = new Set();
  try { await fsp.access(file); } catch (err) { if (err.code === 'ENOENT') return ids; throw err; }
  const input = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let lineNo = 0;
  try {
    for await (const line of lines) {
      lineNo++;
      if (!line) continue;
      let event;
      try { event = JSON.parse(line); } catch { throw new Error(`JSON inválido em ${file}, linha ${lineNo}`); }
      if (event.eventId) ids.add(event.type === 'message' && event.messageId ? `message:${event.messageId}` : event.eventId);
    }
  } finally { lines.close(); input.destroy(); }
  return ids;
}

async function appendLine(file, line) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.appendFile(file, line, 'utf8');
}

async function atomicWrite(file, contents) {
  const tmp = `${file}.${randomId()}.tmp`;
  await fsp.writeFile(tmp, contents, 'utf8');
  await fsp.rename(tmp, file);
}

function embedRecord(embed) {
  return {
    title: embed.title ?? null, description: embed.description ?? null, url: embed.url ?? null,
    fields: (embed.fields ?? []).map(({ name, value, inline }) => ({ name, value, inline: Boolean(inline) })),
    author: embed.author?.name ?? null, footer: embed.footer?.text ?? null,
    imageUrl: embed.image?.url ?? null, thumbnailUrl: embed.thumbnail?.url ?? null, videoUrl: embed.video?.url ?? null,
    provider: embed.provider?.name ?? null,
  };
}

function componentRecord(component) {
  return {
    type: component.type ?? null, customId: component.customId ?? null,
    label: component.label ?? null, url: component.url ?? null,
    placeholder: component.placeholder ?? null,
    options: (component.options ?? []).map((option) => ({ label: option.label ?? null, value: option.value ?? null, description: option.description ?? null })),
    components: (component.components ?? []).map(componentRecord),
  };
}

function values(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return [];
}

function validDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new TypeError(`data local inválida: ${date}`);
  return date;
}

function segment(value) {
  const result = String(value ?? '');
  if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new TypeError(`ID inválido para caminho: ${result}`);
  return result;
}

function shiftDate(date, amount) {
  const value = new Date(`${validDate(date)}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function randomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
