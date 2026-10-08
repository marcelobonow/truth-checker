import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

const ROLES = new Set(['target', 'previous_day', 'next_day']);
const TEXT_FIELDS = ['content', 'cleanContent', 'prompt', 'systemPrompt', 'output', 'response', 'text', 'description', 'transcript', 'error'];

// The model can only address the current job's frozen snapshots by role/cursor
// or an event reference. It never supplies a filesystem path.
export function createConversationLookup({
  targetFile, previousEvents = [], nextEvents = [], statePath = `${targetFile}.lookup.json`,
  maxResults = 20, maxBytes = 32_000, maxQueries = 100, maxFieldChars = 12_000,
}) {
  if (!targetFile || !statePath) throw new TypeError('targetFile e statePath são obrigatórios');
  for (const [name, value] of Object.entries({ maxResults, maxBytes, maxQueries, maxFieldChars })) {
    if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} deve ser inteiro positivo`);
  }
  let tail = Promise.resolve();

  function lookup(request, { maxBytes: requestedMaxBytes } = {}) {
    const run = tail.then(() => runQuery(request, requestedMaxBytes));
    tail = run.catch(() => {});
    return run;
  }

  async function runQuery(request, requestedMaxBytes = maxBytes) {
    const parsed = validateRequest(request, { maxResults, maxFieldChars });
    const byteLimit = Math.min(maxBytes, requestedMaxBytes);
    if (!Number.isInteger(byteLimit) || byteLimit < 128) throw new RangeError('orçamento de leitura deve ser ao menos 128 bytes');
    const state = await loadState(statePath);
    const requestKey = JSON.stringify(parsed);
    const cached = state.queries.findLast((entry) => JSON.stringify(entry.request) === requestKey && entry.result);
    if (cached && Buffer.byteLength(JSON.stringify(cached.result)) <= byteLimit) return { ...structuredClone(cached.result), queryCount: state.queries.length, cached: true };
    if (state.queries.length >= maxQueries) throw new Error('limite de consultas do job atingido');
    const result = await executeQuery(parsed, byteLimit);
    const serialized = JSON.stringify(result);
    if (Buffer.byteLength(serialized) > byteLimit) throw new Error('resultado excede o limite de bytes; refine a consulta');
    if (Buffer.byteLength(JSON.stringify({ ...result, queryCount: state.queries.length + 1 })) > byteLimit) throw new Error('resultado excede o limite de bytes; refine a consulta');
    state.queries.push({
      at: new Date().toISOString(), request: parsed,
      returned: result.events.map(({ eventId, analysisRef, truncated }) => ({
        eventId, analysisRef, truncated: Boolean(truncated), sha256: crypto.createHash('sha256').update(JSON.stringify(result.events.find((item) => item.analysisRef === analysisRef))).digest('hex'),
      })),
      nextCursor: result.nextCursor, result,
      bytes: Buffer.byteLength(serialized),
    });
    await atomicJson(statePath, state);
    return { ...result, queryCount: state.queries.length };
  }

  async function executeQuery(query, byteLimit) {
    let candidates;
    let nextCursor = null;
    let more = false;
    if (query.ref) {
      const ref = decodeRef(query.ref);
      const event = await eventAt(ref.role, ref.cursor);
      candidates = event ? [decorate(event, ref.role, ref.cursor)] : [];
      if (query.field) candidates = candidates.map((event) => fieldSlice(event, query.field, query.offset, query.length));
    } else if (query.role) {
      const page = await pageAt(query.role, query.cursor, query.limit);
      candidates = page.events;
      nextCursor = page.nextCursor;
    } else {
      candidates = await findMatches(query);
      more = candidates.length > query.limit;
      candidates = candidates.slice(0, query.limit);
    }

    const events = [];
    let bytes = Buffer.byteLength('{"events":[],"nextCursor":null,"truncated":false}');
    for (const event of candidates) {
      const bounded = fitEvent(event, byteLimit - bytes);
      if (!bounded) { more = true; break; }
      const size = Buffer.byteLength(JSON.stringify(bounded)) + (events.length ? 1 : 0);
      if (bytes + size > byteLimit) { more = true; break; }
      events.push(bounded);
      bytes += size;
    }
    const truncated = more || events.some((event) => event.truncated);
    if (query.role && (more || nextCursor != null)) nextCursor = query.cursor + events.length;
    return { events, nextCursor, truncated, bytes };
  }

  async function eventAt(role, cursor) {
    if (role === 'previous_day') return decorate(previousEvents[cursor], role, cursor);
    if (role === 'next_day') return decorate(nextEvents[cursor], role, cursor);
    let index = 0;
    for await (const event of readJsonl(targetFile)) {
      if (index === cursor) return decorate(event, role, cursor);
      index++;
    }
    return null;
  }

  async function pageAt(role, cursor, limit) {
    const events = [];
    let index = 0;
    let next = null;
    const accept = (event) => {
      if (index < cursor) { index++; return false; }
      if (events.length >= limit) { next = index; return true; }
      events.push(decorate(event, role, index));
      index++;
      return false;
    };
    if (role === 'target') {
      for await (const event of readJsonl(targetFile)) if (accept(event)) break;
    } else {
      const source = role === 'previous_day' ? previousEvents : nextEvents;
      for (const event of source) if (accept(event)) break;
    }
    return { events, nextCursor: next };
  }

  async function findMatches(query) {
    const found = [];
    for (const role of ['previous_day', 'target', 'next_day']) {
      const matcher = (event) => {
        if (query.eventId) return String(event.eventId) === query.eventId;
        if (query.messageId) return String(event.messageId ?? '') === query.messageId;
        const relatedTo = query.relatedTo;
        return String(event.reference?.messageId ?? '') === relatedTo
          || String(event.sourceMessageId ?? '') === relatedTo
          || (Array.isArray(event.sourceMessageIds) && event.sourceMessageIds.some((id) => String(id) === relatedTo))
          || (Array.isArray(event.mediaAnalysisIds) && event.mediaAnalysisIds.some((id) => String(id) === relatedTo))
          || (Array.isArray(event.deliveredMessages) && event.deliveredMessages.some((item) => String(item.messageId ?? '') === relatedTo))
          || String(event.generationId ?? '') === relatedTo;
      };
      if (role === 'target') {
        let cursor = 0;
        for await (const event of readJsonl(targetFile)) {
          if (matcher(event)) found.push(decorate(event, role, cursor));
          cursor++;
          if (found.length > query.limit) return found;
        }
      } else {
        const source = role === 'previous_day' ? previousEvents : nextEvents;
        for (const [cursor, event] of source.entries()) {
          if (matcher(event)) found.push(decorate(event, role, cursor));
          if (found.length > query.limit) return found;
        }
      }
    }
    return found;
  }

  return lookup;
}

function validateRequest(request, { maxResults, maxFieldChars }) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('consulta inválida');
  const allowed = new Set(['ref', 'field', 'offset', 'length', 'role', 'cursor', 'limit', 'eventId', 'messageId', 'relatedTo']);
  if (Object.keys(request).some((key) => !allowed.has(key))) throw new Error('consulta inválida: campo não permitido');
  const selectors = ['ref', 'role', 'eventId', 'messageId', 'relatedTo'].filter((key) => request[key] != null);
  if (selectors.length !== 1) throw new Error('consulta inválida: informe um único seletor');
  if (request.ref != null) {
    if (typeof request.ref !== 'string' || !/^[epn][0-9a-z]+$/i.test(request.ref)) throw new Error('consulta inválida: referência desconhecida');
    if (request.field != null && (!TEXT_FIELDS.includes(request.field) || !Number.isInteger(request.offset) || request.offset < 0 || !Number.isInteger(request.length) || request.length < 1 || request.length > maxFieldChars)) throw new Error('consulta inválida: intervalo de texto inválido');
    return { ref: request.ref.toLowerCase(), field: request.field, offset: request.offset, length: request.length };
  }
  if (request.role != null) {
    if (!ROLES.has(request.role) || !Number.isInteger(request.cursor) || request.cursor < 0) throw new Error('consulta inválida: paginação inválida');
    const limit = request.limit ?? maxResults;
    if (!Number.isInteger(limit) || limit < 1 || limit > maxResults) throw new Error('consulta inválida: limite de resultados excedido');
    return { role: request.role, cursor: request.cursor, limit };
  }
  const key = selectors[0];
  if (typeof request[key] !== 'string' || !request[key]) throw new Error('consulta inválida: identificador inválido');
  const limit = request.limit ?? maxResults;
  if (!Number.isInteger(limit) || limit < 1 || limit > maxResults) throw new Error('consulta inválida: limite de resultados excedido');
  return { [key]: request[key], limit };
}

function decodeRef(ref) {
  const prefix = ref[0];
  const cursor = Number.parseInt(ref.slice(1), 36);
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('consulta inválida: referência desconhecida');
  return { role: prefix === 'p' ? 'previous_day' : prefix === 'n' ? 'next_day' : 'target', cursor };
}

function decorate(event, role, cursor) {
  if (!event) return null;
  const prefix = role === 'previous_day' ? 'p' : role === 'next_day' ? 'n' : 'e';
  return { ...event, analysisRef: `${prefix}${cursor.toString(36)}`, sourceRole: role, sourceCursor: cursor };
}

function fieldSlice(event, field, offset, length) {
  const value = event[field];
  if (typeof value !== 'string') throw new Error(`campo ${field} não é texto neste evento`);
  const text = value.slice(offset, offset + length);
  return {
    analysisRef: event.analysisRef, sourceRole: event.sourceRole, sourceCursor: event.sourceCursor,
    eventId: event.eventId, type: event.type, field, text,
    createdAt: event.createdAt, observedAt: event.observedAt, localDate: event.localDate, authorName: event.authorName,
    fieldSlice: { offset, length: text.length, totalChars: value.length, nextOffset: offset + text.length < value.length ? offset + text.length : null },
  };
}

function fitEvent(input, budget) {
  if (budget < 128) return null;
  let event = structuredClone(input);
  if (Buffer.byteLength(JSON.stringify(event)) <= budget) return event;
  const truncatedFields = [];
  for (const field of TEXT_FIELDS) {
    if (typeof event[field] !== 'string' || event[field].length < 256) continue;
    let keep = Math.max(128, Math.floor(event[field].length / 2));
    while (keep >= 128 && Buffer.byteLength(JSON.stringify(event)) > budget) {
      event[field] = `${input[field].slice(0, keep)}…[truncado; use ${input.analysisRef} com field=${field} para continuar]`;
      keep = Math.floor(keep / 2);
    }
    truncatedFields.push(field);
    if (Buffer.byteLength(JSON.stringify(event)) <= budget) break;
  }
  if (Buffer.byteLength(JSON.stringify(event)) > budget) {
    const compact = Object.fromEntries(['eventId', 'messageId', 'generationId', 'mediaAnalysisId', 'type', 'createdAt', 'observedAt', 'localDate', 'timeZone', 'authorId', 'authorName', 'analysisRef', 'sourceRole', 'sourceCursor'].filter((key) => event[key] != null).map((key) => [key, event[key]]));
    compact.truncated = true;
    compact.truncatedFields = TEXT_FIELDS.filter((key) => typeof input[key] === 'string');
    return Buffer.byteLength(JSON.stringify(compact)) <= budget ? compact : null;
  }
  event.truncated = true;
  event.truncatedFields = truncatedFields;
  return event;
}

async function* readJsonl(file) {
  const input = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) if (line) yield JSON.parse(line);
  } finally { lines.close(); input.destroy(); }
}

async function loadState(file) {
  try {
    const state = JSON.parse(await fsp.readFile(file, 'utf8'));
    if (state.schemaVersion !== 1 || !Array.isArray(state.queries)) throw new Error('estado de consulta incompatível');
    return state;
  } catch (err) {
    if (err.code === 'ENOENT') return { schemaVersion: 1, queries: [] };
    throw err;
  }
}

async function atomicJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(temp, `${JSON.stringify(value)}\n`, 'utf8');
  await fsp.rename(temp, file);
}
