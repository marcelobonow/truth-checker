import { watch } from 'node:fs';
import { appendFileSync, closeSync, mkdirSync, openSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const levels = { 10: 'TRACE', 20: 'DEBUG', 30: 'INFO', 40: 'WARN', 50: 'ERROR', 60: 'FATAL' };
const defaultPrefixes = ['bot'];
const tracked = new Map();

export function MapLogs(logFolder, prefixes = defaultPrefixes, { tag = null } = {}) {
  const folder = resolve(logFolder);
  const mappedFolder = join(folder, 'mapped');
  mkdirSync(mappedFolder, { recursive: true });

  for (const prefix of prefixes) MapPrefix(folder, mappedFolder, prefix, tag);
}

export function FormatLine(line) {
  let log;
  try {
    log = JSON.parse(line);
  } catch {
    return oneLine(line);
  }

  if (!log || typeof log !== 'object' || Array.isArray(log)) return oneLine(line);
  const { level, time, msg, pid, hostname, ...data } = log;
  const date = FormatTime(time);
  const label = (levels[level] ?? String(level ?? 'LOG')).padEnd(5);
  const context = Object.entries(data)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(' ');
  return `[${date}] ${label} ${[msg, context].filter(Boolean).join(' ')}`.trimEnd();
}

function MapPrefix(logFolder, mappedFolder, prefix, tag) {
  const sources = readdirSync(logFolder)
    .filter((file) => file.startsWith(`${prefix}.`) && file.endsWith('.log'))
    .sort();
  const suffix = tag ? `-${safeName(tag)}` : '';
  const target = join(mappedFolder, `${prefix}${suffix}.log`);
  const targetKey = `${logFolder}|${prefix}|${tag ?? ''}`;
  const targetState = tracked.get(targetKey) ?? { initialized: false };
  if (!targetState.initialized) {
    writeFileSync(target, '');
    targetState.initialized = true;
    tracked.set(targetKey, targetState);
  }

  for (const file of sources) {
    const source = join(logFolder, file);
    const key = `${logFolder}|${file}`;
    const size = statSync(source).size;
    let current = tracked.get(key);
    if (!current || size < current.offset) {
      current = { offset: 0, carry: Buffer.alloc(0) };
      tracked.set(key, current);
    }
    if (size === current.offset) continue;

    const fd = openSync(source, 'r');
    const buffer = Buffer.alloc(size - current.offset);
    try {
      readSync(fd, buffer, 0, buffer.length, current.offset);
    } finally {
      closeSync(fd);
    }
    current.offset = size;

    const chunk = Buffer.concat([current.carry, buffer]);
    const lastBreak = chunk.lastIndexOf(0x0a);
    if (lastBreak === -1) {
      current.carry = chunk;
      continue;
    }

    current.carry = chunk.subarray(lastBreak + 1);
    const mapped = chunk.subarray(0, lastBreak).toString('utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => FormatLineForTag(line, tag))
      .filter((line) => line !== null);
    if (mapped.length) appendFileSync(target, `${mapped.join('\n')}\n`);
  }
}

function FormatLineForTag(line, tag) {
  const formatted = FormatLine(line);
  if (!tag || formatted === null) return formatted;
  try {
    const log = JSON.parse(line);
    return log.tag === tag ? formatted : null;
  } catch {
    return null;
  }
}

function FormatTime(time) {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return String(time ?? 'hora desconhecida');
  return date.toLocaleString('sv-SE').replace('T', ' ');
}

function formatValue(value) {
  if (typeof value === 'string') return JSON.stringify(oneLine(value));
  return JSON.stringify(value).replace(/\\n/g, ' ');
}

function oneLine(value) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const logFolder = resolve(process.env.LOG_FOLDER || 'logs');
  const prefixes = process.argv.slice(2).filter((arg) => !arg.startsWith('--tag='));
  const tagArg = process.argv.slice(2).find((arg) => arg.startsWith('--tag='));
  const tag = tagArg ? tagArg.slice('--tag='.length) : process.env.LOG_TAG || null;
  const selectedPrefixes = prefixes.length ? prefixes : defaultPrefixes;
  let mapTimer = null;

  MapLogs(logFolder, selectedPrefixes, { tag });
  console.log(`Logs formatados em ${join(logFolder, 'mapped')} (Ctrl+C para parar)`);
  if (tag) console.log(`Filtro de tag: ${tag}`);

  watch(logFolder, (_event, filename) => {
    const name = filename?.toString();
    if (!name || !name.endsWith('.log') || name.startsWith('mapped')) return;
    if (!selectedPrefixes.some((prefix) => name.startsWith(`${prefix}.`))) return;
    if (mapTimer) return;
    mapTimer = setTimeout(() => {
      mapTimer = null;
      try {
        MapLogs(logFolder, selectedPrefixes, { tag });
      } catch (error) {
        console.error(`Falha ao mapear logs: ${error.message}`);
      }
    }, 300);
  });
}
