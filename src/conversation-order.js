import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

// External stable sort: memory use is bounded by one small run plus fan-in.
export async function createOrderedJsonlSnapshot(source, destination, {
  tempDir = `${destination}.sort`, chunkBytes = 4_000_000, maxOpenFiles = 16, normalizeEvent,
} = {}) {
  if (!Number.isInteger(chunkBytes) || chunkBytes < 256) throw new RangeError('chunkBytes deve ser ao menos 256');
  if (!Number.isInteger(maxOpenFiles) || maxOpenFiles < 2) throw new RangeError('maxOpenFiles deve ser ao menos 2');
  await fsp.mkdir(tempDir, { recursive: true });
  const runs = [];
  let records = [];
  let bytes = 0;
  let sequence = 0;
  const flush = async () => {
    if (!records.length) return;
    records.sort(compareConversationEvents);
    const run = path.join(tempDir, `run-0-${String(sequence++).padStart(8, '0')}.jsonl`);
    await fsp.writeFile(run, `${records.map(JSON.stringify).join('\n')}\n`, 'utf8');
    runs.push(run);
    records = [];
    bytes = 0;
  };

  try {
    for await (const { record, lineNo } of readJsonlWithLineNumbers(source)) {
      const event = normalizeEvent ? normalizeEvent(record, lineNo) : record;
      if (!event) continue;
      const size = Buffer.byteLength(JSON.stringify(event)) + 1;
      if (records.length && bytes + size > chunkBytes) await flush();
      records.push(event);
      bytes += size;
    }
    await flush();
    let current = runs;
    let pass = 1;
    while (current.length > maxOpenFiles) {
      const next = [];
      for (let offset = 0; offset < current.length; offset += maxOpenFiles) {
        const group = current.slice(offset, offset + maxOpenFiles);
        const output = path.join(tempDir, `run-${pass}-${String(next.length).padStart(8, '0')}.jsonl`);
        await mergeRuns(group, output);
        next.push(output);
        for (const file of group) await fsp.rm(file, { force: true });
      }
      current = next;
      pass++;
    }
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    const tempOutput = `${destination}.${process.pid}.tmp`;
    await mergeRuns(current, tempOutput);
    await fsp.rename(tempOutput, destination);
    return destination;
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

async function mergeRuns(files, output) {
  const iterators = files.map((file) => readJsonl(file)[Symbol.asyncIterator]());
  const heads = await Promise.all(iterators.map((iterator) => iterator.next()));
  const handle = await fsp.open(output, 'w');
  let buffer = '';
  try {
    while (heads.some((head) => !head.done)) {
      let selected = -1;
      for (let i = 0; i < heads.length; i++) {
        if (heads[i].done) continue;
        if (selected < 0 || compareConversationEvents(heads[i].value, heads[selected].value) < 0) selected = i;
      }
      buffer += `${JSON.stringify(heads[selected].value)}\n`;
      if (Buffer.byteLength(buffer) >= 64_000) { await handle.write(buffer); buffer = ''; }
      heads[selected] = await iterators[selected].next();
    }
    if (buffer) await handle.write(buffer);
  } finally {
    await Promise.all(iterators.map((iterator) => iterator.return?.()));
    await handle.close();
  }
}

export function compareConversationEvents(a, b) {
  const time = timestamp(a) - timestamp(b);
  if (time !== 0) return time;
  if (a.type === 'message' && b.type === 'message') {
    const left = String(a.messageId ?? '');
    const right = String(b.messageId ?? '');
    if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
      const idOrder = BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0;
      if (idOrder !== 0) return idOrder;
    }
  }
  const observed = timestamp({ createdAt: a.observedAt }) - timestamp({ createdAt: b.observedAt });
  return observed || String(a.eventId ?? '').localeCompare(String(b.eventId ?? ''));
}

function timestamp(event) {
  const value = Date.parse(event.createdAt ?? event.observedAt ?? '');
  return Number.isFinite(value) ? value : 0;
}

async function* readJsonl(file) {
  let input;
  try { input = fs.createReadStream(file, { encoding: 'utf8' }); }
  catch (err) { if (err.code === 'ENOENT') return; throw err; }
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) if (line) yield JSON.parse(line);
  } finally { lines.close(); input.destroy(); }
}

async function* readJsonlWithLineNumbers(file) {
  let input;
  try { input = fs.createReadStream(file, { encoding: 'utf8' }); }
  catch (err) { if (err.code === 'ENOENT') return; throw err; }
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let lineNo = 0;
  try {
    for await (const line of lines) {
      lineNo++;
      if (line) yield { record: JSON.parse(line), lineNo };
    }
  } finally { lines.close(); input.destroy(); }
}
