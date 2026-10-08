import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { renderMemoryMarkdown } from './conversation-analysis.js';
import { createOrderedJsonlSnapshot } from './conversation-order.js';

export function createConversationScheduler({
  archive, statePath, memoriesRoot, analyze, now = Date.now, timeZone = archive?.timeZone ?? 'America/Sao_Paulo',
  neighborMessages = 20, maxCallsPerAnalysis = 100, maxRetries = 3, analyzerConfigHash = '1',
  isJobIdle = () => true, onComplete = async () => {}, onError = () => {},
}) {
  if (!archive || !statePath || !memoriesRoot || typeof analyze !== 'function') throw new TypeError('archive, statePath, memoriesRoot e analyze são obrigatórios');
  let ticking = false;
  let stateCache;
  let stateWriteQueue = Promise.resolve();
  let scheduleQueue = Promise.resolve();
  const stateSnapshots = new WeakMap();

  function cloneState(state) {
    const copy = structuredClone(state);
    stateSnapshots.set(copy, structuredClone(copy.jobs));
    return copy;
  }

  async function readState() {
    if (stateCache) return cloneState(stateCache);
    try {
      const state = JSON.parse(await fsp.readFile(statePath, 'utf8'));
      if (state.schemaVersion === 1) {
        stateCache = { schemaVersion: 2, jobs: {} };
        return cloneState(stateCache);
      }
      if (state.schemaVersion !== 2 || !state.jobs || typeof state.jobs !== 'object') throw new Error('estado de análise de conversas incompatível');
      stateCache = state;
      return cloneState(state);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      stateCache = { schemaVersion: 2, jobs: {} };
      return cloneState(stateCache);
    }
  }

  async function saveState(state) {
    const baseline = stateSnapshots.get(state) ?? {};
    const write = stateWriteQueue.then(async () => {
      const merged = structuredClone(stateCache ?? { schemaVersion: 2, jobs: {} });
      const keys = new Set([...Object.keys(baseline), ...Object.keys(state.jobs)]);
      for (const key of keys) {
        if (JSON.stringify(baseline[key]) === JSON.stringify(state.jobs[key])) continue;
        if (state.jobs[key] === undefined) delete merged.jobs[key];
        else merged.jobs[key] = structuredClone(state.jobs[key]);
      }
      stateCache = merged;
      await atomicWrite(statePath, `${JSON.stringify(merged, null, 2)}\n`);
      stateSnapshots.set(state, structuredClone(state.jobs));
    });
    stateWriteQueue = write.catch(() => {});
    await write;
  }

  function schedule(input) {
    const result = scheduleQueue.then(() => scheduleOne(input));
    scheduleQueue = result.catch(() => {});
    return result;
  }

  async function scheduleOne({ guildId, channelId, localDate, scheduledAt, requestedBy, guildName = null, channelName = null }) {
    const identity = { guildId: safeSegment(guildId), channelId: safeSegment(channelId), localDate: validLocalDate(localDate) };
    const timestamp = Number(scheduledAt);
    if (!Number.isFinite(timestamp)) throw new TypeError('scheduledAt inválido');
    if (!requestedBy) throw new TypeError('requestedBy é obrigatório');
    const key = jobKey(identity);
    const state = await readState();
    const existing = state.jobs[key];
    if (existing && ['scheduled', 'pending', 'running'].includes(existing.status)) throw new Error('já existe uma análise agendada para esse canal e dia');
    const retained = existing?.status === 'failed' ? existing : {};
    const job = {
      ...retained,
      ...identity, id: key, sourceFile: archive.filePath(identity.guildId, identity.channelId, identity.localDate),
      guildName, channelName, scheduledAt: timestamp, requestedBy: String(requestedBy),
      status: 'scheduled', attempts: 0, callsUsed: retained.callsUsed ?? 0, nextAttemptAt: null,
      deferredUntilIdle: false, deliveryStatus: 'pending', lastError: undefined,
    };
    state.jobs[key] = job;
    await saveState(state);
    return structuredClone(job);
  }

  async function listScheduledJobs() {
    const state = await readState();
    let changed = false;
    for (const job of Object.values(state.jobs)) {
      if (job.status === 'running') { job.status = 'pending'; job.deferredUntilIdle = false; changed = true; }
    }
    if (changed) await saveState(state);
    return Object.values(state.jobs)
      .filter((job) => ['scheduled', 'pending'].includes(job.status) && !job.deferredUntilIdle)
      .map((job) => ({ ...job, dueAt: Number(job.nextAttemptAt ?? job.scheduledAt) }));
  }

  async function prepare(job, key, state) {
    if (!await archive.flush()) throw new Error('a fila do arquivo da conversa não drenou antes da análise');
    if (!isJobIdle(job)) return false;
    const currentHash = await hashFileOrEmpty(job.sourceFile);
    if (currentHash !== job.sourceHash) return false;
    if (job.sourceSnapshot && job.auxSnapshot && job.workDir && job.frozenAt) {
      const sourceSnapshotHash = await hashFile(job.sourceSnapshot).catch(() => '');
      const auxSnapshotHash = await hashFile(job.auxSnapshot).catch(() => '');
      const currentFormat = job.sourceSnapshot.endsWith('.messages-v2.jsonl') && job.auxSnapshot.endsWith('.context-v2.jsonl');
      if (currentFormat && sourceSnapshotHash === job.sourceHash && auxSnapshotHash === job.auxSnapshotHash) {
        const expectedWorkDir = path.join(archive.root, '.work', safeSegment(job.guildId), safeSegment(job.channelId), job.localDate,
          digest(`${job.sourceHash}:${job.contextHash}:${analyzerConfigHash}`));
        if (path.resolve(job.workDir) !== path.resolve(expectedWorkDir)) {
          await cleanupJobFiles({ ...job, sourceSnapshot: null, auxSnapshot: null });
          job.workDir = expectedWorkDir;
        }
        const orderedSnapshot = `${job.sourceSnapshot}.ordered.jsonl`;
        let orderedSnapshotHash = await hashFile(orderedSnapshot).catch(() => '');
        if (!orderedSnapshotHash || orderedSnapshotHash !== job.orderedSnapshotHash) {
          await createOrderedJsonlSnapshot(job.sourceSnapshot, orderedSnapshot, {
            tempDir: path.join(expectedWorkDir, 'sort'),
            normalizeEvent: (record, lineNo) => archive.normalizeRecord(record, { ...job, timeZone, lineNo }),
          });
          orderedSnapshotHash = await hashFile(orderedSnapshot);
        }
        job.orderedSnapshot = orderedSnapshot;
        job.orderedSnapshotHash = orderedSnapshotHash;
        state.jobs[key] = job;
        await saveState(state);
        return true;
      }
      await cleanupJobFiles(job);
      job.sourceSnapshot = job.orderedSnapshot = job.orderedSnapshotHash = job.auxSnapshot = job.workDir = job.frozenAt = job.auxSnapshotHash = job.contextHash = undefined;
    }
    const context = await archive.neighbors({ guildId: job.guildId, channelId: job.channelId, localDate: job.localDate, limit: neighborMessages });
    const frozenAt = new Date(now()).toISOString();
    const previous = context.previous.map((event) => ({ ...event, contextRole: 'previous_day' }));
    const next = context.next.map((event) => ({ ...event, contextRole: 'next_day' }));
    const contextEvents = [...previous, ...next];
    const contextHash = crypto.createHash('sha256').update(JSON.stringify(contextEvents)).digest('hex');
    const sourceSnapshot = path.join(archive.root, '.work', safeSegment(job.guildId), safeSegment(job.channelId), `${job.localDate}-${job.sourceHash}.messages-v2.jsonl`);
    const auxSnapshot = `${sourceSnapshot}.context-v2.jsonl`;
    const orderedSnapshot = `${sourceSnapshot}.ordered.jsonl`;
    const workDir = path.join(archive.root, '.work', safeSegment(job.guildId), safeSegment(job.channelId), job.localDate,
      digest(`${job.sourceHash}:${contextHash}:${analyzerConfigHash}`));
    await fsp.mkdir(path.dirname(sourceSnapshot), { recursive: true });
    Object.assign(job, { contextHash, sourceSnapshot, orderedSnapshot, auxSnapshot, workDir, frozenAt });
    state.jobs[key] = job;
    await saveState(state);
    try { await fsp.copyFile(job.sourceFile, sourceSnapshot); }
    catch (err) { if (err.code !== 'ENOENT') throw err; await fsp.writeFile(sourceSnapshot, '', 'utf8'); }
    if (await hashFile(sourceSnapshot) !== job.sourceHash || await hashFileOrEmpty(job.sourceFile) !== job.sourceHash) return false;
    await fsp.writeFile(auxSnapshot, contextEvents.map((event) => JSON.stringify(event)).join('\n') + (contextEvents.length ? '\n' : ''), 'utf8');
    await createOrderedJsonlSnapshot(sourceSnapshot, orderedSnapshot, {
      tempDir: path.join(workDir, 'sort'),
      normalizeEvent: (record, lineNo) => archive.normalizeRecord(record, { ...job, timeZone, lineNo }),
    });
    Object.assign(job, {
      sourceHash: currentHash, contextHash, auxSnapshotHash: await hashFile(auxSnapshot), sourceSnapshot, orderedSnapshot,
      orderedSnapshotHash: await hashFile(orderedSnapshot), auxSnapshot, workDir, frozenAt,
      context: { previous: { date: context.previousDate, count: context.previous.length }, next: { date: context.nextDate, count: context.next.length } },
    });
    state.jobs[key] = job;
    await saveState(state);
    return true;
  }

  async function* inputEvents(job) {
    const aux = await readAux(job.auxSnapshot);
    for (const [cursor, event] of aux.previous.entries()) yield { ...event, analysisRef: `p${cursor.toString(36)}`, sourceRole: 'previous_day', sourceCursor: cursor };
    let cursor = 0;
    for await (const event of readJsonl(job.orderedSnapshot ?? job.sourceSnapshot)) {
      yield { ...event, analysisRef: `e${cursor.toString(36)}`, sourceRole: 'target', sourceCursor: cursor };
      cursor++;
    }
    for (const [cursor, event] of aux.next.entries()) yield { ...event, analysisRef: `n${cursor.toString(36)}`, sourceRole: 'next_day', sourceCursor: cursor };
  }

  async function execute(job, key, state) {
    if (!await prepare(job, key, state)) {
      job.status = 'pending';
      job.nextAttemptAt = now() + 60_000;
      await cleanupJobFiles(job);
      job.sourceSnapshot = job.orderedSnapshot = job.orderedSnapshotHash = job.auxSnapshot = job.workDir = job.frozenAt = job.auxSnapshotHash = job.contextHash = undefined;
      state.jobs[key] = job;
      await saveState(state);
      return false;
    }
    if (!isJobIdle(job)) {
      job.status = 'pending'; job.deferredUntilIdle = true; state.jobs[key] = job; await saveState(state); return false;
    }
    const remaining = maxCallsPerAnalysis - Number(job.callsUsed ?? 0);
    if (remaining <= 0) {
      job.status = 'failed'; job.lastError = 'limite de chamadas desta análise atingido antes de completar todos os blocos';
      state.jobs[key] = job; await saveState(state); onError(new Error(job.lastError), job); return false;
    }
    const callsBefore = Number(job.callsUsed ?? 0);
    const onCall = async () => {
      job.callsUsed = Number(job.callsUsed ?? 0) + 1;
      state.jobs[key] = job;
      await saveState(state);
    };
    const result = await analyze({
      events: inputEvents(job), context: await readAux(job.auxSnapshot), workDir: job.workDir,
      sourceSnapshot: job.orderedSnapshot ?? job.sourceSnapshot, auxSnapshot: job.auxSnapshot, lookupStatePath: path.join(job.workDir, 'lookup-state.json'),
      maxCalls: remaining, shouldContinue: () => true,
      onCall, metadata: { guildId: job.guildId, channelId: job.channelId, localDate: job.localDate, timeZone, context: job.context, frozenAt: job.frozenAt, sourceHash: job.sourceHash, analyzerConfigHash },
    });
    if (Number(job.callsUsed ?? 0) === callsBefore) job.callsUsed = callsBefore + Number(result.callsUsed ?? 0);
    await saveState(state);
    if (!result.complete) {
      job.status = 'failed'; job.lastError = 'análise incompleta: o limite de chamadas foi atingido; agende novamente após revisar a memória parcial dos checkpoints';
      state.jobs[key] = job; await saveState(state); onError(new Error(job.lastError), job); return false;
    }
    if (await hashFileOrEmpty(job.sourceFile) !== job.sourceHash) {
      job.status = 'pending';
      job.nextAttemptAt = now() + 60_000;
      await cleanupJobFiles(job);
      job.sourceSnapshot = job.orderedSnapshot = job.orderedSnapshotHash = job.auxSnapshot = job.workDir = job.frozenAt = job.auxSnapshotHash = job.contextHash = undefined;
      state.jobs[key] = job; await saveState(state); return false;
    }
    const coverage = await scanCoverage(job.orderedSnapshot ?? job.sourceSnapshot);
    const sources = await evidenceSources(result.analysis, job);
    const memoryPath = path.join(memoriesRoot, safeSegment(job.guildId), safeSegment(job.channelId), `memoria-${job.localDate}.md`);
    const markdown = renderMemoryMarkdown({ analysis: result.analysis, events: sources, metadata: {
      guildId: job.guildId, channelId: job.channelId, localDate: job.localDate, timeZone,
      sourceHash: job.sourceHash, analyzerConfigHash, backend: result.backend, model: result.model,
      analyzerVersion: '1', generatedAt: new Date(now()).toISOString(), context: { ...job.context, frozenAt: job.frozenAt }, coverage,
    } });
    await atomicWrite(memoryPath, markdown);
    job.status = 'completed'; job.completedAt = new Date(now()).toISOString(); job.memoryPath = memoryPath;
    job.analyzerConfigHash = analyzerConfigHash; job.deliveryStatus = 'pending'; job.coverage = coverage; state.jobs[key] = job;
    await saveState(state);
    await cleanupJobFiles(job);
    return true;
  }

  async function deliverPending(state) {
    for (const [key, job] of Object.entries(state.jobs)) {
      if (job.status !== 'completed' || job.deliveryStatus !== 'pending' || !job.memoryPath) continue;
      try {
        const markdown = await fsp.readFile(job.memoryPath, 'utf8');
        await onComplete(structuredClone(job), markdown);
        job.deliveryStatus = 'sent';
      } catch (err) {
        job.deliveryStatus = 'failed'; job.deliveryError = safeError(err);
        onError(err, job);
      }
      state.jobs[key] = job;
      await saveState(state);
    }
  }

  async function tick(at = now()) {
    if (ticking) return { completed: 0, skipped: true };
    ticking = true;
    try {
      const state = await readState();
      for (const job of Object.values(state.jobs)) {
        if (job.status === 'running') { job.status = 'pending'; job.deferredUntilIdle = false; }
        else if (job.deferredUntilIdle) job.deferredUntilIdle = false;
      }
      const dueJobs = Object.entries(state.jobs)
        .filter(([, job]) => ['scheduled', 'pending'].includes(job.status) && Number(job.nextAttemptAt ?? job.scheduledAt) <= Number(at))
        .sort(([, a], [, b]) => Number(a.nextAttemptAt ?? a.scheduledAt) - Number(b.nextAttemptAt ?? b.scheduledAt));
      let completed = 0;
      for (const [key, job] of dueJobs) {
        if (!isJobIdle(job)) { job.deferredUntilIdle = true; continue; }
        const sourceHash = await hashFileOrEmpty(job.sourceFile);
        if (!job.sourceHash || job.sourceHash !== sourceHash) {
          job.sourceHash = sourceHash;
          job.sourceSnapshot = job.orderedSnapshot = job.orderedSnapshotHash = job.auxSnapshot = job.workDir = job.frozenAt = job.auxSnapshotHash = job.contextHash = undefined;
        }
        if (job.status !== 'completed' && await isPublished(job, sourceHash)) {
          job.status = 'completed'; job.completedAt ??= new Date(now()).toISOString();
          job.memoryPath = path.join(memoriesRoot, safeSegment(job.guildId), safeSegment(job.channelId), `memoria-${job.localDate}.md`);
          job.deliveryStatus ??= 'pending';
          state.jobs[key] = job;
          continue;
        }
        job.status = 'running'; job.deferredUntilIdle = false; job.attempts = (job.attempts ?? 0) + 1; job.nextAttemptAt = null;
        await saveState(state);
        try {
          if (await execute(job, key, state)) completed++;
        } catch (err) {
          job.status = job.attempts >= maxRetries ? 'failed' : 'pending';
          job.nextAttemptAt = job.status === 'failed' ? null : now() + (job.attempts === 1 ? 5 : 15) * 60_000;
          job.deferredUntilIdle = false;
          job.lastError = safeError(err);
          state.jobs[key] = job;
          await saveState(state);
          onError(err, job);
        }
      }
      await deliverPending(state);
      await saveState(state);
      const retryTimes = Object.values(state.jobs).filter((job) => ['scheduled', 'pending'].includes(job.status) && !job.deferredUntilIdle)
        .map((job) => Number(job.nextAttemptAt ?? job.scheduledAt));
      return { completed, nextAttemptAt: retryTimes.length ? Math.min(...retryTimes) : null };
    } finally { ticking = false; }
  }

  return { schedule, listScheduledJobs, tick, readState };

  async function evidenceSources(analysis, job) {
    const ids = new Set(collectEvidenceIds(analysis));
    const selected = [];
    for await (const event of inputEvents(job)) {
      if ([event.eventId, event.messageId, event.generationId, event.mediaAnalysisId].some((id) => id != null && ids.has(String(id)))) selected.push(event);
    }
    return selected;
  }

  async function isPublished(discovered, sourceHash) {
    const file = path.join(memoriesRoot, safeSegment(discovered.guildId), safeSegment(discovered.channelId), `memoria-${discovered.localDate}.md`);
    try {
      const text = await fsp.readFile(file, 'utf8');
      return text.includes(`- Fonte: \`${sourceHash}\``) && text.includes(`- Configuração do analisador: \`${analyzerConfigHash}\``);
    } catch (err) { if (err.code === 'ENOENT') return false; throw err; }
  }

  async function cleanupJobFiles(job) {
    const workRoot = path.resolve(archive.root, '.work');
    for (const target of [job.sourceSnapshot, job.orderedSnapshot, job.auxSnapshot, job.workDir].filter(Boolean)) {
      const resolved = path.resolve(target);
      if (!resolved.startsWith(`${workRoot}${path.sep}`)) throw new Error('caminho temporário de análise fora da raiz permitida');
      await fsp.rm(resolved, { recursive: true, force: true });
    }
  }
}

async function scanCoverage(file) {
  const counts = { messageCount: 0 };
  for await (const event of readJsonl(file)) {
    if (event.type === 'message') counts.messageCount++;
  }
  counts.captureComplete = true;
  return counts;
}

function collectEvidenceIds(value, ids = new Set()) {
  if (!value || typeof value !== 'object') return ids;
  if (Array.isArray(value)) { for (const item of value) collectEvidenceIds(item, ids); return ids; }
  if (Array.isArray(value.evidence)) for (const item of value.evidence) if (item?.eventId) ids.add(String(item.eventId));
  for (const [key, item] of Object.entries(value)) if (key !== 'evidence') collectEvidenceIds(item, ids);
  return ids;
}

async function* readJsonl(file) {
  try { await fsp.access(file); } catch (err) { if (err.code === 'ENOENT') return; throw err; }
  const input = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let lineNo = 0;
  try {
    for await (const line of lines) {
      lineNo++;
      if (!line) continue;
      try { yield JSON.parse(line); } catch { throw new Error(`JSON inválido em snapshot, linha ${lineNo}`); }
    }
  } finally { lines.close(); input.destroy(); }
}

async function readAux(file) {
  const events = [];
  for await (const event of readJsonl(file)) events.push(event);
  return { previous: events.filter((event) => event.contextRole === 'previous_day'), next: events.filter((event) => event.contextRole === 'next_day') };
}

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(file);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function hashFileOrEmpty(file) {
  try { return await hashFile(file); }
  catch (err) { if (err.code === 'ENOENT') return crypto.createHash('sha256').digest('hex'); throw err; }
}

async function atomicWrite(file, contents) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(temp, contents, 'utf8');
  await fsp.rename(temp, file);
}

function jobKey({ guildId, channelId, localDate }) { return `${guildId}:${channelId}:${localDate}`; }
function safeSegment(value) { if (!/^[\w-]+$/.test(String(value))) throw new Error(`ID inválido para caminho: ${value}`); return String(value); }
function validLocalDate(value) {
  const date = String(value ?? '');
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new TypeError(`data local inválida: ${date}`);
  return date;
}
function digest(text) { return crypto.createHash('sha256').update(text).digest('hex').slice(0, 24); }
function safeError(error) { return `${error?.name ?? 'Error'}: ${String(error?.message ?? 'falha').replace(/(?:token|secret|api[_ -]?key|authorization)\s*[:=]\s*\S+/gi, '[redigido]').slice(0, 180)}`; }
