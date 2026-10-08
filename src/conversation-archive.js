import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { compareConversationEvents } from './conversation-order.js';

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
  const dropped = new Map();
  let pendingBytes = 0;
  let rootReady;

  const filePath = (guildId, channelId, localDate) => path.join(base, segment(guildId), segment(channelId), `conversa-${validDate(localDate)}.jsonl`);
  const prepareRoot = () => rootReady ??= fsp.mkdir(base, { recursive: true });

  function queueFor(file) {
    let queue = queues.get(file);
    if (!queue) {
      queue = { tail: Promise.resolve(), recovered: false, seen: new Set() };
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

  function recordMessage(message) {
    if (!captureAllowed(message)) return Promise.resolve(false);
    const guildId = String(message.guildId);
    const channelId = String(message.channelId);
    const createdTimestamp = Number(message.createdTimestamp ?? Date.parse(message.createdAt ?? now()));
    const localDate = localDateInZone(createdTimestamp, timeZone);
    const record = {
      timestamp: createdTimestamp,
      author: message.member?.displayName ?? message.author?.globalName ?? message.author?.username ?? 'desconhecido',
      mentions: hasMentions(message.mentions),
      content: typeof message.content === 'string' ? message.content : '',
    };
    const file = filePath(guildId, channelId, localDate);
    const jsonLine = `${JSON.stringify(record)}\n`;
    const bytes = Buffer.byteLength(jsonLine);
    const eventKey = message.id == null ? null : String(message.id);
    if (pendingBytes + bytes > maxQueueBytes) {
      dropped.set(file, (dropped.get(file) ?? 0) + 1);
      return Promise.resolve(false);
    }
    pendingBytes += bytes;
    const queue = queueFor(file);
    const run = queue.tail.then(async () => {
      await prepareRoot();
      if (!queue.recovered) {
        await recoverTail(file);
        queue.recovered = true;
      }
      if (eventKey && queue.seen.has(eventKey)) return false;
      await appendLine(file, jsonLine);
      if (eventKey) queue.seen.add(eventKey);
      return true;
    }).finally(() => {
      pendingBytes -= bytes;
    });
    queue.tail = run.catch((err) => {
      queue.recovered = false;
      dropped.set(file, (dropped.get(file) ?? 0) + 1);
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
        let record;
        try { record = JSON.parse(line); } catch { throw new Error(`JSON inválido em ${file}, linha ${lineNo}`); }
        const event = normalizeRecord(record, { guildId, channelId, localDate, timeZone, lineNo });
        if (event) yield event;
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
    const lostRecords = dropped.size > 0;
    dropped.clear();
    if (waits.length === 0) return !lostRecords && dropped.size === 0;
    let timer;
    const done = Promise.allSettled(waits);
    const timedOut = new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
    const result = await Promise.race([done.then(() => true), timedOut]);
    clearTimeout(timer);
    return result && !lostRecords && dropped.size === 0;
  }

  return {
    root: base, timeZone, filePath, captureAllowed, recordMessage, iterateDay, neighbors,
    normalizeRecord, flush, get pendingBytes() { return pendingBytes; },
  };
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

async function appendLine(file, line) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.appendFile(file, line, 'utf8');
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


function normalizeRecord(record, { guildId, channelId, localDate, timeZone, lineNo = 0 }) {
  if (!Number.isFinite(record?.timestamp) || typeof record.author !== 'string'
    || typeof record.mentions !== 'boolean' || typeof record.content !== 'string') {
    throw new Error('registro de conversa incompatível');
  }
  if (!Number.isFinite(new Date(record.timestamp).getTime())) {
    throw new Error('horário de mensagem inválido no arquivo');
  }
  return {
    type: 'message',
    eventId: `archive-line:${lineNo}`,
    guildId: String(guildId),
    channelId: String(channelId),
    createdAt: new Date(record.timestamp).toISOString(),
    localDate,
    timeZone,
    authorName: record.author,
    content: record.content,
    mentions: record.mentions,
  };
}

function hasMentions(mentions) {
  const hasValues = (value) => Array.isArray(value) ? value.length > 0 : Number(value?.size ?? 0) > 0;
  return hasValues(mentions?.users) || hasValues(mentions?.roles) || hasValues(mentions?.channels) || Boolean(mentions?.everyone);
}
