import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const REQUIRED_ARRAYS = ['topics', 'interactions', 'worked', 'failed', 'promptChanges', 'codeChanges', 'limitations'];
const EVIDENCE_KEYS = ['eventId', 'quote'];
const ITEM_FIELDS = {
  topics: ['name', 'summary'],
  interactions: ['request', 'outcome'],
  worked: ['observation', 'confidence'],
  failed: ['kind', 'observation', 'confidence'],
  promptChanges: ['rule', 'problem', 'suggestion', 'benefit', 'risk', 'confidence'],
  codeChanges: ['hypothesis', 'component', 'verification', 'confidence'],
};

export async function* chunkEvents(source, { maxChars = 60_000, overlapMessages = 5 } = {}) {
  if (!Number.isInteger(maxChars) || maxChars < 200) throw new RangeError('maxChars deve ser ao menos 200');
  const iterator = source[Symbol.asyncIterator]?.() ?? source[Symbol.iterator]?.();
  if (!iterator) throw new TypeError('events deve ser iterável');
  let current = [];
  let bytes = 2;
  let index = 0;
  const covered = new Set();
  let hasNew = false;
  for await (const raw of { [Symbol.asyncIterator]: () => iterator }) {
    for (const event of splitLargeEvent(raw, maxChars)) {
      const size = serializedSize(event);
      if (size > maxChars) throw new Error(`evento ${event.eventId ?? event.type} excede o orçamento de entrada`);
      if (current.length > 0 && bytes + size > maxChars) {
        if (hasNew) {
          yield makeChunk(index++, current, bytes, covered);
          current = overlapMessages > 0 ? current.filter((item) => item.type === 'message').slice(-overlapMessages) : [];
          bytes = 2 + current.reduce((sum, item) => sum + serializedSize(item) + 1, 0);
          hasNew = false;
        }
        while (current.length > 0 && bytes + size > maxChars) {
          const removed = current.shift();
          bytes -= serializedSize(removed) + 1;
        }
      }
      current.push(event);
      bytes += size + 1;
      hasNew = true;
    }
  }
  if (hasNew) yield makeChunk(index, current, bytes, covered);
}

export function compactTimeline(events, { timeZone = 'America/Sao_Paulo' } = {}) {
  const lines = [];
  let currentDate = null;
  let lastHour = null;
  let lastMinute = null;
  for (const event of events) {
    const stamp = event.createdAt || event.observedAt
      ? localParts(event.createdAt ?? event.observedAt, timeZone)
      : { date: event.localDate ?? 'data desconhecida', hour: '00', minute: '00' };
    // A data e a hora vêm do mesmo instante UTC convertido para o fuso da
    // análise. Usar localDate do caminho pode deixar a data em outro dia.
    const date = stamp.date;
    if (date !== currentDate) {
      const context = event.contextRole === 'previous_day' ? ' (contexto anterior)' : event.contextRole === 'next_day' ? ' (contexto posterior)' : '';
      lines.push(`${date}${context}`);
      currentDate = date;
      lastHour = null;
      lastMinute = null;
    }
    let time = '';
    if (lastHour !== stamp.hour || lastMinute === null) time = `${stamp.hour}h${stamp.minute}`;
    else if (lastMinute !== stamp.minute) time = `${stamp.minute}m`;
    lastHour = stamp.hour;
    lastMinute = stamp.minute;
    const ref = event.analysisRef ?? event.eventId ?? 'evento';
    const speaker = event.type === 'message' ? event.authorName ?? 'desconhecido' : event.type;
    const reply = event.reference?.messageId ? ` ↩${event.reference.messageId}` : '';
    const body = eventText(event);
    const mention = event.mentions ? ' [menção]' : '';
    const prefix = `${time ? `${time} ` : ''}${speaker}${mention} [${ref}]${reply}:`;
    const bodyLines = body.split(/\r?\n/);
    lines.push(`${prefix}${bodyLines[0] ? ` ${bodyLines[0]}` : ''}`);
    for (const line of bodyLines.slice(1)) lines.push(`  | ${line}`);
  }
  return lines.join('\n');
}

export function parseAnalysisResponse(text) {
  return validateShape(parseJson(text));
}

export function validateStructuredAnalysis(value, events) {
  const analysis = validateShape(value);
  const sourceById = new Map();
  for (const event of events) {
    const ids = [event.analysisRef, event.eventId, event.messageId, event.generationId, event.mediaAnalysisId].filter(Boolean).map(String);
    const text = evidenceText(event);
    for (const id of ids) sourceById.set(id, `${sourceById.get(id) ?? ''}\n${text}`);
  }
  for (const evidence of findEvidence(analysis)) {
    const source = sourceById.get(String(evidence.eventId));
    if (source == null) throw new Error(`evidência ${evidence.eventId} está fora da entrada`);
    if (!source.includes(evidence.quote)) throw new Error(`citação da evidência ${evidence.eventId} não confere com a fonte`);
  }
  return analysis;
}

export function renderMemoryMarkdown({ analysis, events, metadata }) {
  const sourceById = new Map();
  const messages = events.filter((event) => event.type === 'message');
  for (const event of events) {
    for (const id of [event.eventId, event.messageId, event.generationId, event.mediaAnalysisId].filter(Boolean)) sourceById.set(String(id), event);
  }
  const evidence = (items = []) => items.map((item) => {
    const event = sourceById.get(String(item.eventId));
    const quote = String(item.quote).replace(/\r?\n/g, ' ').replace(/([*_`])/g, '\\$1');
    const author = event?.authorName ? ` — ${event.authorName}` : '';
    const link = discordLink(event, metadata);
    return `> “${quote}”${author}${link ? ` ([mensagem](${link}))` : ''}`;
  }).join('\n');
  const section = (title, items, format) => `## ${title}\n\n${items.length ? items.map((item) => `${format(item)}\n\n${evidence(item.evidence)}`).join('\n\n') : 'Sem evidências suficientes para registrar.'}`;
  const context = metadata.context ?? {};
  const coverage = metadata.coverage ?? {};
  return [
    `# Memória diária — ${metadata.localDate}`,
    '',
    `- Servidor: ${metadata.guildName ?? metadata.guildId} (${metadata.guildId})`,
    `- Canal: ${metadata.channelName ?? metadata.channelId} (${metadata.channelId})`,
    `- Fuso: ${metadata.timeZone}`,
    `- Fonte: \`${metadata.sourceHash}\``,
    `- Configuração do analisador: \`${metadata.analyzerConfigHash ?? '1'}\``,
    `- Backend/modelo: ${metadata.backend ?? 'desconhecido'} / ${metadata.model ?? 'padrão'}`,
    `- Analisador: ${metadata.analyzerVersion ?? '1'}; gerado em ${metadata.generatedAt ?? new Date().toISOString()}`,
    `- Cobertura: ${coverage.messageCount ?? messages.length} mensagens; captura ${coverage.captureComplete === false ? 'parcial' : 'da fonte disponível'}`,
    `- Contexto auxiliar congelado: ${context.previous?.count ?? 0} mensagens de ${context.previous?.date ?? 'dia anterior indisponível'}; ${context.next?.count ?? 0} mensagens de ${context.next?.date ?? 'dia posterior indisponível'}${context.frozenAt ? ` (congelado em ${context.frozenAt})` : ''}`,
    `- Lacunas conhecidas: ${(coverage.gaps ?? []).length ? coverage.gaps.join('; ') : 'nenhuma registrada'}`,
    '',
    '## Resumo geral do canal',
    '',
    analysis.summary,
    '',
    section('Temas', analysis.topics, (item) => `- **${item.name}**: ${item.summary}`),
    '',
    section('Interações com o bot', analysis.interactions, (item) => `- **Pedido:** ${item.request}\n  **Resposta/desfecho:** ${item.response ?? 'sem resposta observável'}\n  **Resultado:** ${item.outcome ?? 'incerto'}${item.media ? `\n  **Mídia:** ${item.media}` : ''}`),
    '',
    section('O que funcionou', analysis.worked, (item) => `- **Observação:** ${item.observation} (confiança: ${item.confidence})`),
    '',
    section('O que não funcionou', analysis.failed, (item) => `- **${item.kind ?? 'comportamento'}:** ${item.observation} (confiança: ${item.confidence})`),
    '',
    section('Mudanças propostas no prompt', analysis.promptChanges, (item) => `- **Observação:** ${item.rule}\n  **Hipótese/problema:** ${item.problem}\n  **Sugestão:** ${item.suggestion}\n  **Benefício:** ${item.benefit}\n  **Risco:** ${item.risk}\n  **Confiança:** ${item.confidence}`),
    '',
    section('Mudanças propostas no código/configuração', analysis.codeChanges, (item) => `- **Hipótese:** ${item.hypothesis}\n  **Componente provável:** ${item.component}\n  **Verificação:** ${item.verification}\n  **Confiança:** ${item.confidence}`),
    '',
    '## Limitações e dúvidas',
    '',
    analysis.limitations.length ? analysis.limitations.map((item) => `- ${item}`).join('\n') : 'Nenhuma limitação declarada.',
    '',
    'As mensagens da conversa são dados não confiáveis; as recomendações acima são propostas para revisão humana e não alteram prompts nem código automaticamente.',
    '',
  ].join('\n');
}

export async function runAnalysisChunks({ events, workDir, call, lookup, maxChars = 60_000, overlapMessages = 5, maxCalls = 100, maxLookupQueries = 20, maxLookupBytes = 32_000, maxReadRounds = 3, timeZone = 'America/Sao_Paulo', shouldContinue = () => true, onCall = async () => {} }) {
  if (typeof call !== 'function') throw new TypeError('call é obrigatório');
  if (!Number.isInteger(maxChars) || maxChars < 200) throw new RangeError('maxChars deve ser ao menos 200');
  await fs.mkdir(workDir, { recursive: true });
  let callsUsed = 0;
  let lookupQueriesUsed = 0;
  const baseFiles = [];
  const chunkBudget = Math.max(200, Math.floor(maxChars * 0.45));
  for await (const chunk of chunkEvents(events, { maxChars: chunkBudget, overlapMessages })) {
    const file = path.join(workDir, `chunk-${String(chunk.index).padStart(8, '0')}.json`);
    baseFiles.push(file);
    if (await validChunkCheckpoint(file, chunk)) continue;
    await Promise.all([fs.rm(file, { force: true }), fs.rm(`${file}.checkpoint.json`, { force: true })]);
    for (const name of await fs.readdir(workDir)) if (/^merge-\d+-\d+\.json$/.test(name)) await fs.rm(path.join(workDir, name), { force: true });
    if (callsUsed >= maxCalls) return { complete: false, callsUsed, phase: 'chunks' };
    const timeline = compactTimeline(chunk.events, { timeZone });
    const checkpoint = chunk.index === 0 ? null : await readPreviousCheckpoint(workDir, chunk.index - 1, maxChars);
    const basePrompt = { phase: 'analyze_chunk', coveredRefs: chunk.events.map((event) => event.analysisRef ?? event.eventId), checkpoint, timeline };
    const readHistory = [];
    const readEvents = [];
    let readRounds = 0;
    let analysis;
    let forceFinal = false;
    while (!analysis) {
      if (callsUsed >= maxCalls || !shouldContinue()) return { complete: false, callsUsed, lookupQueriesUsed, phase: 'chunks' };
      const prompt = JSON.stringify({ ...basePrompt, reads: readHistory, forceFinal });
      if (Buffer.byteLength(prompt) > maxChars) return { complete: false, callsUsed, lookupQueriesUsed, phase: 'input_budget' };
      await onCall();
      let output = await call(prompt, { phase: readHistory.length ? 'lookup_followup' : 'chunk', index: chunk.index });
      callsUsed++;
      let value;
      try { value = parseJson(output); }
      catch (error) {
        if (callsUsed >= maxCalls) return { complete: false, callsUsed, lookupQueriesUsed, phase: 'repair' };
        await onCall();
        output = await call(`${prompt}\n\nSua resposta anterior era inválida (${error.message}). Retorne somente JSON válido, sem inventar evidências.`, { phase: 'repair', index: chunk.index });
        callsUsed++;
        value = parseJson(output);
      }
      if (Array.isArray(value.readRequests)) {
        if (!lookup || lookupQueriesUsed >= maxLookupQueries || readRounds >= maxReadRounds) {
          if (forceFinal) throw new Error('analisador continuou pedindo leituras após o limite configurado');
          readHistory.push({ error: 'limite de leituras adicionais atingido; finalize com os dados já fornecidos e registre a limitação.' });
          forceFinal = true;
          continue;
        }
        readRounds++;
        let requests;
        try { requests = validateReadRequests(value.readRequests); }
        catch (error) {
          readHistory.push({ error: `consulta de leitura rejeitada: ${String(error.message ?? error).slice(0, 160)}` });
          if (readRounds >= maxReadRounds) forceFinal = true;
          continue;
        }
        const results = [];
        for (const request of requests) {
          if (lookupQueriesUsed >= maxLookupQueries) { results.push({ request, error: 'limite de leituras adicionais do job atingido' }); break; }
          if (callsUsed >= maxCalls || !shouldContinue()) return { complete: false, callsUsed, lookupQueriesUsed, phase: 'lookup' };
          const reserve = Math.max(256, Math.floor(maxChars * 0.1));
          const currentPrompt = { ...basePrompt, reads: [...readHistory, ...results], forceFinal };
          const availableBytes = Math.min(maxLookupBytes, Math.floor((maxChars - Buffer.byteLength(JSON.stringify(currentPrompt)) - reserve) / 2));
          if (availableBytes < 128) {
            results.push({ request, error: 'sem orçamento do bloco para incluir outra leitura; finalize ou reduza a consulta.' });
            continue;
          }
          lookupQueriesUsed++;
          try {
            const result = await lookup(request, { maxBytes: availableBytes });
            const returnedEvents = result.events ?? [];
            const entry = { request, nextCursor: result.nextCursor ?? null, truncated: Boolean(result.truncated), timeline: compactTimeline(returnedEvents, { timeZone }) };
            if (Buffer.byteLength(JSON.stringify({ ...basePrompt, reads: [...readHistory, ...results, entry], forceFinal })) > maxChars - reserve) {
              results.push({ request, error: 'resultado excede orçamento do bloco; refine a página ou peça um trecho menor.' });
            } else {
              readEvents.push(...returnedEvents);
              results.push(entry);
            }
          } catch (error) { results.push({ request, error: String(error.message ?? error).slice(0, 180) }); }
        }
        readHistory.push(...results);
        continue;
      }
      try { analysis = normalizeEvidenceRefs(validateStructuredAnalysis(value, [...chunk.events, ...readEvents]), [...chunk.events, ...readEvents]); }
      catch (firstError) {
        if (callsUsed >= maxCalls) return { complete: false, callsUsed, lookupQueriesUsed, phase: 'repair' };
        await onCall();
        output = await call(`${prompt}\n\nSua resposta anterior foi inválida: ${firstError.message}. Retorne somente JSON válido e use apenas os refs/citações presentes nos dados.`, { phase: 'repair', index: chunk.index });
        callsUsed++;
        analysis = normalizeEvidenceRefs(validateStructuredAnalysis(parseAnalysisResponse(output), [...chunk.events, ...readEvents]), [...chunk.events, ...readEvents]);
      }
    }
    await atomicJson(file, analysis);
    await atomicJson(`${file}.checkpoint.json`, {
      chunkIndex: chunk.index, coveredIds: chunk.coveredIds, inputHash: chunkHash(chunk.events),
      lookupRefs: readEvents.map(({ analysisRef, eventId }) => ({ analysisRef, eventId })),
      lookupQueries: readHistory, lookupResults: readEvents,
      completedAt: new Date().toISOString(),
    });
  }
  if (baseFiles.length === 0) return { complete: true, callsUsed, lookupQueriesUsed, analysis: emptyAnalysis() };

  let inputs = baseFiles;
  let level = 0;
  while (inputs.length > 1) {
    const groups = await groupFiles(inputs, maxChars);
    const outputs = [];
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const outputFile = path.join(workDir, `merge-${level}-${String(i).padStart(8, '0')}.json`);
      outputs.push(outputFile);
      try { await fs.access(outputFile); continue; } catch (err) { if (err.code !== 'ENOENT') throw err; }
      if (group.length === 1) { await fs.copyFile(group[0], outputFile); continue; }
      if (callsUsed >= maxCalls || !shouldContinue()) return { complete: false, callsUsed, lookupQueriesUsed, phase: 'merge' };
      const analyses = await Promise.all(group.map((file) => fs.readFile(file, 'utf8').then(JSON.parse)));
      const allowed = analyses.flatMap(findEvidence).reduce((list, item) => {
        const previous = list.find((entry) => entry.eventId === item.eventId && entry.quote === item.quote);
        if (!previous) list.push(item);
        return list;
      }, []);
      const prompt = JSON.stringify({ phase: 'consolidate', analyses, allowedEvidence: allowed });
      await onCall();
      let output = await call(prompt, { phase: 'merge', level, index: i });
      callsUsed++;
      let analysis;
      try { analysis = validateStructuredAnalysis(parseAnalysisResponse(output), allowed.map((item) => ({ eventId: item.eventId, content: item.quote }))); }
      catch (firstError) {
        if (callsUsed >= maxCalls) return { complete: false, callsUsed, lookupQueriesUsed, phase: 'repair' };
        await onCall();
        output = await call(`${prompt}\n\nSua resposta anterior foi inválida: ${firstError.message}. Retorne somente JSON válido e use apenas as evidências permitidas.`, { phase: 'repair', level, index: i });
        callsUsed++;
        analysis = validateStructuredAnalysis(parseAnalysisResponse(output), allowed.map((item) => ({ eventId: item.eventId, content: item.quote })));
      }
      await atomicJson(outputFile, analysis);
    }
    inputs = outputs;
    level++;
  }
  return { complete: true, callsUsed, lookupQueriesUsed, analysis: JSON.parse(await fs.readFile(inputs[0], 'utf8')) };
}

async function validChunkCheckpoint(file, chunk) {
  try {
    const [analysisText, checkpointText] = await Promise.all([
      fs.readFile(file, 'utf8'), fs.readFile(`${file}.checkpoint.json`, 'utf8'),
    ]);
    parseAnalysisResponse(analysisText);
    const checkpoint = JSON.parse(checkpointText);
    return checkpoint.chunkIndex === chunk.index
      && checkpoint.inputHash === chunkHash(chunk.events)
      && JSON.stringify(checkpoint.coveredIds) === JSON.stringify(chunk.coveredIds);
  } catch { return false; }
}

async function readPreviousCheckpoint(workDir, chunkIndex, maxChars) {
  const file = path.join(workDir, `chunk-${String(chunkIndex).padStart(8, '0')}.json`);
  const [analysisText, checkpointText] = await Promise.all([
    fs.readFile(file, 'utf8'), fs.readFile(`${file}.checkpoint.json`, 'utf8'),
  ]);
  const analysis = parseAnalysisResponse(analysisText);
  const checkpoint = JSON.parse(checkpointText);
  if (checkpoint.chunkIndex !== chunkIndex || typeof checkpoint.inputHash !== 'string' || !Array.isArray(checkpoint.coveredIds)) {
    throw new Error(`checkpoint inválido no bloco ${chunkIndex}`);
  }
  return summarizeCheckpoint(analysis, Math.max(100, Math.floor(maxChars * 0.2)));
}

function summarizeCheckpoint(analysis, budget) {
  const fields = ['topics', 'interactions', 'worked', 'failed', 'promptChanges', 'codeChanges'];
  const checkpoint = { summary: analysis.summary.slice(0, 1_200) };
  for (const field of fields) checkpoint[field] = analysis[field].slice(0, 3).map((item) => ({
    ...Object.fromEntries(Object.entries(item).filter(([key, value]) => key !== 'evidence' && typeof value === 'string').map(([key, value]) => [key, value.slice(0, 240)])),
    evidence: (item.evidence ?? []).slice(0, 2).map((evidence) => ({ eventId: evidence.eventId, quote: evidence.quote.slice(0, 120) })),
  }));
  checkpoint.limitations = analysis.limitations.slice(0, 3).map((item) => item.slice(0, 200));
  while (Buffer.byteLength(JSON.stringify(checkpoint)) > budget) {
    const longest = [...fields, 'limitations'].sort((a, b) => checkpoint[b].length - checkpoint[a].length)[0];
    if (checkpoint[longest].length) checkpoint[longest].pop();
    else if (checkpoint.summary.length > 32) checkpoint.summary = checkpoint.summary.slice(0, Math.floor(checkpoint.summary.length / 2));
    else return { summary: checkpoint.summary.slice(0, 64) };
  }
  return checkpoint;
}

function chunkHash(events) {
  return crypto.createHash('sha256').update(JSON.stringify(events)).digest('hex');
}

function makeChunk(index, events, bytes, covered) {
  const coveredIds = [...new Set(events.map((event) => event.eventId).filter(Boolean).map(String))].filter((id) => !covered.has(id));
  for (const id of coveredIds) covered.add(id);
  return { index, events, bytes, coveredIds };
}

function serializedSize(event) { return Buffer.byteLength(JSON.stringify(event)); }

function parseJson(text) {
  if (typeof text !== 'string') throw new TypeError('resposta do analisador deve ser texto');
  const json = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(json); } catch { throw new Error('saída do analisador não é JSON válido'); }
}

function validateReadRequests(requests) {
  if (requests.length < 1 || requests.length > 3) throw new Error('readRequests deve conter de 1 a 3 consultas');
  const keys = new Set(['ref', 'field', 'offset', 'length', 'role', 'cursor', 'limit', 'eventId', 'messageId', 'relatedTo']);
  for (const request of requests) {
    if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some((key) => !keys.has(key))) throw new Error('consulta de leitura inválida');
    if (request.ref != null) {
      if (typeof request.ref !== 'string' || !/^[epn][0-9a-z]+$/i.test(request.ref)) throw new Error('ref de leitura inválida');
    } else if (request.role != null) {
      if (!['target', 'previous_day', 'next_day'].includes(request.role) || !Number.isInteger(request.cursor) || request.cursor < 0 || (request.limit != null && (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 20))) throw new Error('paginação de leitura inválida');
    } else if (!['eventId', 'messageId', 'relatedTo'].some((key) => typeof request[key] === 'string' && request[key])) throw new Error('seletor de leitura ausente');
  }
  return requests;
}

function normalizeEvidenceRefs(analysis, events) {
  const aliases = new Map(events.filter((event) => event.analysisRef && event.eventId).map((event) => [String(event.analysisRef), String(event.eventId)]));
  const normalized = structuredClone(analysis);
  for (const item of findEvidence(normalized)) if (aliases.has(String(item.eventId))) item.eventId = aliases.get(String(item.eventId));
  return normalized;
}

function localParts(timestamp, timeZone) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) throw new Error(`timestamp inválido na transcrição: ${timestamp}`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: parts.hour, minute: parts.minute };
}

function eventText(event) {
  if (event.fieldSlice && typeof event.text === 'string') return `${event.field}[${event.fieldSlice.offset}]: ${event.text}`;
  if (event.type === 'message') {
    const body = typeof event.content === 'string' ? event.content : typeof event.cleanContent === 'string' ? event.cleanContent : '[conteúdo indisponível]';
    const extras = [
      ...(event.attachments ?? []).map((item) => `[anexo: ${item.name ?? item.id ?? 'sem nome'}${item.contentType ? ` (${item.contentType})` : ''}]`),
      ...(event.embeds ?? []).flatMap((item) => [item.title, item.description, ...(item.fields ?? []).flatMap((field) => [field.name, field.value])].filter(Boolean).map((text) => `[embed: ${text}]`)),
    ];
    return [body, ...extras].filter((text) => text !== '').join('\n');
  }
  const fields = event.type === 'decision'
    ? [event.decision, event.reason, event.stage]
    : event.type?.startsWith('media_analysis')
      ? [event.kind, event.status, event.output, event.description, event.transcript, event.error, event.sourceAuthorName]
      : event.type?.startsWith('generation')
        ? [event.outcome, event.prompt, event.systemPrompt, event.output, event.generatedText, event.deliveredText, event.deliveryError, ...(event.deliveredMessages ?? []).map((item) => item.content)]
        : [event.status, event.reason, event.prompt, event.output, event.text];
  return fields.filter((value) => typeof value === 'string' && value.length > 0).join('\n');
}

function splitLargeEvent(event, maxChars) {
  if (serializedSize(event) <= maxChars) return [event];
  const field = ['content', 'prompt', 'output', 'description', 'transcript'].find((key) => typeof event[key] === 'string');
  const content = field ? event[field] : '';
  if (!content) return [event];
  const characters = Array.from(content);
  let size = Math.max(1, Math.floor(maxChars / 5));
  while (size > 0) {
    const pieces = [];
    for (let start = 0; start < characters.length; start += size) {
      const part = characters.slice(start, start + size).join('');
      pieces.push({ ...event, [field]: part, ...(field === 'content' && typeof event.cleanContent === 'string' ? { cleanContent: part } : {}), fragment: { index: pieces.length + 1, total: Math.ceil(characters.length / size) } });
    }
    if (pieces.every((piece) => serializedSize(piece) <= maxChars)) {
      const total = pieces.length;
      return pieces.map((piece, index) => ({ ...piece, fragment: { index: index + 1, total } }));
    }
    size = Math.floor(size / 2);
  }
  return [event];
}

function validateShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('saída do analisador deve ser um objeto JSON');
  if (typeof value.summary !== 'string' || !value.summary.trim()) throw new Error('campo obrigatório summary ausente');
  for (const key of REQUIRED_ARRAYS) if (!Array.isArray(value[key])) throw new Error(`campo obrigatório ${key} ausente`);
  for (const [key, fields] of Object.entries(ITEM_FIELDS)) for (const item of value[key]) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${key} deve conter objetos`);
    for (const field of fields) if (typeof item[field] !== 'string' || !item[field].trim()) throw new Error(`${key}.${field} obrigatório`);
    if (!Array.isArray(item.evidence) || item.evidence.length === 0) throw new Error(`${key} exige ao menos uma evidência`);
    if (item.confidence != null && !['baixa', 'media', 'alta'].includes(item.confidence)) throw new Error(`${key}.confidence inválida`);
    if (key === 'failed' && !['conteudo', 'entrega', 'contexto', 'atendimento', 'tecnico'].includes(item.kind)) throw new Error('failed.kind inválido');
  }
  for (const item of value.interactions) {
    if (item.response != null && typeof item.response !== 'string') throw new Error('interactions.response deve ser texto ou null');
    if (item.media != null && typeof item.media !== 'string') throw new Error('interactions.media deve ser texto ou null');
  }
  if (value.limitations.some((item) => typeof item !== 'string' || !item.trim())) throw new Error('limitations deve conter textos não vazios');
  for (const evidence of findEvidence(value)) {
    if (!EVIDENCE_KEYS.every((key) => typeof evidence[key] === 'string' && evidence[key].trim())) throw new Error('evidência precisa conter eventId e quote');
    if (Array.from(evidence.quote).length > 300) throw new Error('citação excede 300 caracteres');
  }
  return value;
}

function* findEvidence(value) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) yield* findEvidence(item); return; }
  if (Array.isArray(value.evidence)) yield* value.evidence;
  for (const [key, child] of Object.entries(value)) if (key !== 'evidence') yield* findEvidence(child);
}

function evidenceText(event) {
  return ['content', 'cleanContent', 'text', 'output', 'response', 'description', 'transcript', 'error', 'prompt', 'quote']
    .map((key) => typeof event[key] === 'string' ? event[key] : '')
    .concat((event.deliveredMessages ?? []).map((item) => typeof item.content === 'string' ? item.content : ''))
    .join('\n');
}

function discordLink(event, metadata) {
  const messageId = event?.messageId ?? event?.sourceMessageId ?? event?.deliveredMessages?.at?.(-1)?.messageId ?? event?.sourceMessageIds?.at?.(-1) ?? event?.messageIds?.at?.(-1);
  const guildId = event?.guildId ?? event?.sourceGuildId ?? metadata.guildId;
  const channelId = event?.channelId ?? event?.sourceChannelId ?? metadata.channelId;
  return guildId && channelId && messageId ? `https://discord.com/channels/${guildId}/${channelId}/${messageId}` : null;
}

function emptyAnalysis() {
  return { summary: 'Nenhuma mensagem foi capturada neste dia.', topics: [], interactions: [], worked: [], failed: [], promptChanges: [], codeChanges: [], limitations: ['Sem mensagens disponíveis para análise.'] };
}

async function groupFiles(files, maxChars) {
  const groups = [];
  let group = [];
  let size = 0;
  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    const itemSize = Buffer.byteLength(text) + 1;
    if (group.length > 0 && size + itemSize > maxChars) { groups.push(group); group = []; size = 0; }
    group.push(file);
    size += itemSize;
  }
  if (group.length) groups.push(group);
  if (groups.length === files.length && files.length > 1) throw new Error('resumos parciais não cabem no orçamento de consolidação');
  return groups;
}

async function atomicJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value)}\n`, 'utf8');
  await fs.rename(tmp, file);
}
