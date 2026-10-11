import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chunkEvents, compactTimeline, parseAnalysisResponse, validateStructuredAnalysis, renderMemoryMarkdown, runAnalysisChunks, runAnalysisFromFile } from '../src/conversation-analysis.js';

const event = (id, content) => ({ schemaVersion: 1, type: 'message', eventId: `message:${id}`, messageId: id, guildId: 'g1', channelId: 'c1', authorName: `autor-${id}`, content, cleanContent: content, localDate: '2026-10-08' });
const valid = (id, quote) => ({ summary: 'Resumo', topics: [], interactions: [], worked: [{ observation: 'Funcionou', confidence: 'media', evidence: [{ eventId: `message:${id}`, quote }] }], failed: [], promptChanges: [], codeChanges: [], limitations: [] });

 test('chunkEvents limita entrada, separa mensagens longas e declara IDs cobertos', async () => {
  const chunks = [];
  for await (const part of chunkEvents([event('1', 'a'.repeat(80)), event('2', 'b'.repeat(80))], { maxChars: 260, overlapMessages: 0 })) chunks.push(part);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((part) => part.bytes <= 260));
  assert.deepEqual(new Set(chunks.flatMap((part) => part.coveredIds)), new Set(['message:1', 'message:2']));
  assert.ok(chunks.some((part) => part.events.some((item) => item.fragment)));
});

test('validateStructuredAnalysis exige evidência presente no input e citação literal', () => {
  assert.doesNotThrow(() => validateStructuredAnalysis(valid('1', 'trecho real'), [event('1', 'um trecho real aqui')]));
  assert.throws(() => validateStructuredAnalysis(valid('2', 'trecho real'), [event('1', 'um trecho real aqui')]), /fora da entrada/);
  assert.throws(() => validateStructuredAnalysis(valid('1', 'invento'), [event('1', 'um trecho real aqui')]), /não confere/);
  assert.throws(() => parseAnalysisResponse('{"summary":"ok"}'), /campo obrigatório/);
  assert.throws(() => parseAnalysisResponse(JSON.stringify({ ...valid('1', 'trecho real'), worked: [{ observation: 'Funcionou', confidence: 'alta', evidence: [null] }] })), /evidência precisa conter eventId e quote/);
});

test('validateStructuredAnalysis restaura a citação literal quando só mudam os espaços', () => {
  const source = '<@1549995906584289452> Explique para o <@1071521379482087485>  o conceito de seita.';
  const analysis = valid('1', 'Explique para o <@1071521379482087485> o conceito de seita.');
  validateStructuredAnalysis(analysis, [event('1', source)]);
  assert.equal(analysis.worked[0].evidence[0].quote, 'Explique para o <@1071521379482087485>  o conceito de seita.');
});

test('validação flexível de espaços não junta campos distintos da fonte', () => {
  const source = { ...event('1', 'prefixo'), cleanContent: 'sufixo' };
  assert.throws(() => validateStructuredAnalysis(valid('1', 'prefixo sufixo'), [source]), /não confere/);
});

test('validateStructuredAnalysis rejeita recomendações sem campos ou evidência obrigatórios', () => {
  assert.throws(() => validateStructuredAnalysis({ ...valid('1', 'trecho real'), promptChanges: [{ rule: 'Responda melhor.', problem: 'Resposta prolixa.', benefit: 'Clareza.', risk: 'Perder contexto.', confidence: 'alta', evidence: [{ eventId: 'message:1', quote: 'trecho real' }] }] }, [event('1', 'um trecho real aqui')]), /promptChanges\.suggestion/);
  assert.throws(() => validateStructuredAnalysis({ ...valid('1', 'trecho real'), worked: [{ observation: 'Funcionou', confidence: 'alta' }] }, [event('1', 'um trecho real aqui')]), /evidência/);
});

test('compactTimeline omite horários repetidos e mantém autor, fronteira e troca de hora', () => {
  const events = [
    { ...event('1', 'teste'), analysisRef: 'e0', createdAt: '2026-10-08T17:16:04.000Z', authorName: 'Tuctuc' },
    { ...event('2', 'teste dnv.\nsegunda linha'), analysisRef: 'e1', createdAt: '2026-10-08T17:16:42.000Z', authorName: 'Tuctuc' },
    { ...event('3', 'teste2'), analysisRef: 'e2', createdAt: '2026-10-08T17:18:00.000Z', authorName: 'Fulano' },
    { ...event('4', 'nova hora'), analysisRef: 'e3', createdAt: '2026-10-08T18:01:00.000Z', authorName: 'Fulano' },
  ];
  assert.equal(compactTimeline(events, { timeZone: 'America/Sao_Paulo' }), [
    '2026-10-08',
    '14h16 Tuctuc [e0]: teste',
    'Tuctuc [e1]: teste dnv.',
    '  | segunda linha',
    '18m Fulano [e2]: teste2',
    '15h01 Fulano [e3]: nova hora',
  ].join('\n'));
});

test('renderMemoryMarkdown gera links a partir da fonte e separa evidência/hipótese/sugestão', () => {
  const analysis = { ...valid('1', 'trecho real'), promptChanges: [{ rule: 'Responda direto', problem: 'Desvio', suggestion: 'Começar pela resposta', benefit: 'Clareza', risk: 'Pode resumir demais', confidence: 'media', evidence: [{ eventId: 'message:1', quote: 'trecho real' }] }] };
  const md = renderMemoryMarkdown({ analysis, events: [event('1', 'um trecho real aqui')], metadata: { guildId: 'g1', channelId: 'c1', localDate: '2026-10-08', sourceHash: 'abc', timeZone: 'America/Sao_Paulo' } });
  assert.match(md, /https:\/\/discord.com\/channels\/g1\/c1\/1/);
  assert.match(md, /Mudanças propostas no prompt/);
  assert.match(md, /Observação.*Funcionou/);
  assert.match(md, /Hipótese\/problema.*Desvio/);
});

test('memória liga evidência de entrega ao trecho realmente enviado', () => {
  const end = { eventId: 'generation:g1:end', type: 'generation_end', generationId: 'g1', guildId: 'g1', channelId: 'c1', deliveredMessages: [{ messageId: 'reply1', content: 'parte enviada' }] };
  const memory = renderMemoryMarkdown({
    analysis: { ...valid('1', 'parte enviada'), worked: [{ observation: 'Uma parte chegou ao canal.', confidence: 'alta', evidence: [{ eventId: end.eventId, quote: 'parte enviada' }] }] },
    events: [end], metadata: { guildId: 'g1', channelId: 'c1', localDate: '2026-10-08', timeZone: 'America/Sao_Paulo' },
  });
  assert.match(memory, /discord\.com\/channels\/g1\/c1\/reply1/);
  assert.match(memory, /parte enviada/);
});

test('runAnalysisChunks salva checkpoints e retoma sem repetir chamadas', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'analysis-checkpoint-'));
  try {
    let calls = 0;
    const run = async (events, { workDir: dir, maxCalls }) => runAnalysisChunks({
      events, workDir: dir, maxChars: 370, overlapMessages: 0, maxCalls,
      call: async () => { calls++; return JSON.stringify({ summary: 'Resumo', topics: [], interactions: [], worked: [], failed: [], promptChanges: [], codeChanges: [], limitations: [] }); },
    });
    const events = [event('1', 'texto 1'), event('2', 'texto 2')];
    const first = await run(events, { workDir, maxCalls: 1 });
    assert.equal(first.complete, false);
    assert.equal(first.callsUsed, 1);
    const second = await run(events, { workDir, maxCalls: 4 });
    assert.equal(second.complete, true);
    assert.equal(calls, 3);
    assert.equal(second.analysis.summary, 'Resumo');
  } finally { await fs.rm(workDir, { recursive: true, force: true }); }
});

test('runAnalysisChunks repete o reparo quando a resposta ainda traz evidência incompleta', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'analysis-invalid-evidence-'));
  try {
    let calls = 0;
    const result = await runAnalysisChunks({
      events: [{ ...event('1', 'trecho da fonte'), analysisRef: 'e0' }],
      workDir,
      maxChars: 4_000,
      call: async () => {
        calls++;
        if (calls < 3) return JSON.stringify({ ...valid('1', 'trecho da fonte'), worked: [{ observation: 'Funcionou', confidence: 'media', evidence: [{ eventId: 'e0' }] }] });
        return JSON.stringify({ ...valid('1', 'trecho da fonte'), worked: [{ observation: 'Funcionou', confidence: 'media', evidence: [{ eventId: 'e0', quote: 'trecho da fonte' }] }] });
      },
    });
    assert.equal(result.complete, true);
    assert.equal(calls, 3);
    assert.equal(result.analysis.worked[0].evidence[0].quote, 'trecho da fonte');
  } finally { await fs.rm(workDir, { recursive: true, force: true }); }
});

test('runAnalysisChunks descarta achados sem evidência válida após esgotar os reparos', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'analysis-discard-invalid-evidence-'));
  try {
    let calls = 0;
    const result = await runAnalysisChunks({
      events: [{ ...event('1', 'trecho da fonte'), analysisRef: 'e0' }],
      workDir,
      maxChars: 4_000,
      call: async () => {
        calls++;
        return JSON.stringify({ ...valid('1', 'trecho da fonte'), worked: [{ observation: 'Sem citação válida', confidence: 'media', evidence: [{ eventId: 'e0' }] }] });
      },
    });
    assert.equal(result.complete, true);
    assert.equal(calls, 3);
    assert.deepEqual(result.analysis.worked, []);
    assert.match(result.analysis.limitations[0], /evidência incompleta/);
  } finally { await fs.rm(workDir, { recursive: true, force: true }); }
});

test('runAnalysisChunks não reutiliza um bloco sem checkpoint de cobertura válido', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'analysis-missing-checkpoint-'));
  try {
    let calls = 0;
    const options = {
      events: [{ ...event('1', 'texto'), analysisRef: 'e0' }], workDir, maxChars: 4_000,
      call: async () => { calls++; return JSON.stringify({ summary: 'Resumo', topics: [], interactions: [], worked: [], failed: [], promptChanges: [], codeChanges: [], limitations: [] }); },
    };
    await runAnalysisChunks(options);
    await fs.rm(path.join(workDir, 'chunk-00000000.json.checkpoint.json'));
    await runAnalysisChunks(options);
    assert.equal(calls, 2);
    assert.ok(await fs.readFile(path.join(workDir, 'chunk-00000000.json.checkpoint.json'), 'utf8').then((text) => JSON.parse(text).coveredIds.includes('message:1')));
  } finally { await fs.rm(workDir, { recursive: true, force: true }); }
});

test('runAnalysisChunks permite leituras limitadas e converte alias em evidência verificável', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'analysis-lookup-'));
  try {
    const target = { ...event('2', 'este é o trecho adicional'), analysisRef: 'e1', createdAt: '2026-10-08T17:20:00.000Z' };
    let calls = 0;
    let lookups = 0;
    const result = await runAnalysisChunks({
      events: [{ ...event('1', 'mensagem inicial'), analysisRef: 'e0', createdAt: '2026-10-08T17:16:00.000Z' }],
      workDir,
      maxChars: 4_000,
      maxLookupQueries: 2,
      lookup: async (request) => { lookups++; assert.deepEqual(request, { role: 'target', cursor: 1, limit: 1 }); return { events: [target], nextCursor: 2 }; },
      call: async (prompt) => {
        calls++;
        if (calls === 1) {
          assert.match(prompt, /14h16/);
          return JSON.stringify({ readRequests: [{ role: 'target', cursor: 1, limit: 1 }] });
        }
        assert.match(prompt, /este é o trecho adicional/);
        return JSON.stringify({ ...valid('2', 'trecho adicional'), worked: [{ observation: 'Funcionou', confidence: 'media', evidence: [{ eventId: 'e1', quote: 'trecho adicional' }] }] });
      },
    });
    assert.equal(result.complete, true);
    assert.equal(result.callsUsed, 2);
    assert.equal(lookups, 1);
    assert.equal(result.analysis.worked[0].evidence[0].eventId, 'message:2');
    const checkpoint = JSON.parse(await fs.readFile(path.join(workDir, 'chunk-00000000.json.checkpoint.json'), 'utf8'));
    assert.equal(checkpoint.lookupResults[0].eventId, 'message:2');
    assert.equal(checkpoint.lookupQueries[0].request.role, 'target');
  } finally { await fs.rm(workDir, { recursive: true, force: true }); }
});

test('cada bloco recebe somente o checkpoint resumido do bloco anterior', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'analysis-previous-checkpoint-'));
  try {
    const events = [
      { ...event('1', 'a'.repeat(130)), analysisRef: 'e0' },
      { ...event('2', 'b'.repeat(130)), analysisRef: 'e1' },
    ];
    const chunkSummaries = [];
    const result = await runAnalysisChunks({
      events, workDir, maxChars: 1_100, overlapMessages: 0,
      call: async (prompt, meta) => {
        if (meta.phase === 'chunk') {
          const input = JSON.parse(prompt);
          chunkSummaries.push(input.checkpoint?.summary ?? null);
          return JSON.stringify({ summary: input.coveredRefs.includes('e0') ? 'Resumo do primeiro bloco.' : 'Resumo do segundo bloco.', topics: [], interactions: [], worked: [], failed: [], promptChanges: [], codeChanges: [], limitations: [] });
        }
        return JSON.stringify({ summary: 'Resumo consolidado.', topics: [], interactions: [], worked: [], failed: [], promptChanges: [], codeChanges: [], limitations: [] });
      },
    });
    assert.equal(result.complete, true);
    assert.equal(chunkSummaries.length, 2);
    assert.equal(chunkSummaries[0], null);
    assert.equal(chunkSummaries[1], 'Resumo do primeiro bloco.');
  } finally { await fs.rm(workDir, { recursive: true, force: true }); }
});

test('pedido de leitura inválido é rejeitado e explicado ao modelo sem executar paths', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'analysis-invalid-lookup-'));
  try {
    let calls = 0;
    const result = await runAnalysisChunks({
      events: [{ ...event('1', 'mensagem'), analysisRef: 'e0' }], workDir,
      lookup: async () => { throw new Error('lookup não deveria ser chamado'); },
      call: async (prompt) => {
        calls++;
        if (calls === 1) return JSON.stringify({ readRequests: [{ path: '../secret.txt' }] });
        assert.match(prompt, /consulta de leitura inválida/);
        return JSON.stringify({ summary: 'Resumo', topics: [], interactions: [], worked: [], failed: [], promptChanges: [], codeChanges: [], limitations: ['Leitura inválida rejeitada.'] });
      },
    });
    assert.equal(result.complete, true);
    assert.equal(calls, 2);
  } finally { await fs.rm(workDir, { recursive: true, force: true }); }
});

test('leituras adicionais consomem somente o orçamento restante do bloco', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'analysis-read-budget-'));
  try {
    const prompts = [];
    let requestedBytes;
    const result = await runAnalysisChunks({
      events: [{ ...event('1', 'mensagem inicial'), analysisRef: 'e0' }], workDir, maxChars: 4_000, maxLookupBytes: 2_000,
      lookup: async (_request, options) => {
        requestedBytes = options.maxBytes;
        return { events: [{ ...event('2', 'x'.repeat(20_000)), analysisRef: 'e1' }], nextCursor: 2, truncated: true };
      },
      call: async (prompt) => {
        prompts.push(prompt);
        const parsed = JSON.parse(prompt);
        if (!parsed.reads.length) return JSON.stringify({ readRequests: [{ role: 'target', cursor: 1, limit: 1 }] });
        assert.match(JSON.stringify(parsed.reads), /orçamento do bloco/);
        return JSON.stringify({ summary: 'Resumo', topics: [], interactions: [], worked: [], failed: [], promptChanges: [], codeChanges: [], limitations: ['Leitura limitada pelo orçamento.'] });
      },
    });
    assert.equal(result.complete, true);
    assert.ok(requestedBytes > 0 && requestedBytes < 2_000);
    assert.ok(prompts.every((prompt) => Buffer.byteLength(prompt) <= 4_000));
  } finally { await fs.rm(workDir, { recursive: true, force: true }); }
});


test('análise por arquivo consulta o dia completo em uma chamada sem blocos', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'analysis-file-'));
  try {
    const events = Array.from({ length: 150 }, (_, i) => ({ ...event(String(i), `texto ${i}`), analysisRef: `e${i}` }));
    events[0].content = '😀'.repeat(2_000);
    const phases = [];
    let calls = 0;
    const result = await runAnalysisFromFile({ events, workDir,
      onProgress: async (progress) => phases.push(progress.phase),
      call: async (prompt, options) => {
        calls++;
        const input = JSON.parse(prompt);
        assert.ok(path.isAbsolute(input.conversationFile));
        assert.equal(options.workDir, path.dirname(input.conversationFile));
        assert.equal(options.phase, 'analysis');
        const text = await fs.readFile(input.conversationFile, 'utf8');
        const records = text.trim().split('\n').map((line) => JSON.parse(line));
        assert.equal(input.lineCount, records.length);
        assert.equal(input.byteCount, Buffer.byteLength(text));
        assert.equal(input.messageCount, 150);
        assert.equal(records.filter((r) => r.recordType === 'event').length, 150);
        assert.equal(records.filter((r) => r.analysisRef === 'e0' && r.field === 'content').map((r) => r.text).join(''), events[0].content);
        assert.ok(text.trim().split('\n').every((line) => Buffer.byteLength(line) <= 1_500));
        return JSON.stringify({ ...valid('149', 'texto 149'), worked: [{ observation: 'Última mensagem lida', confidence: 'alta', evidence: [{ eventId: 'e149', quote: 'texto 149' }] }] });
      },
    });
    assert.equal(result.complete, true);
    assert.equal(calls, 1);
    assert.equal(result.analysis.worked[0].evidence[0].eventId, 'message:149');
    assert.ok(phases.includes('analysis_file_ready'));
    assert.ok(!phases.some((phase) => phase.startsWith('chunk')));
    assert.deepEqual(await fs.readdir(workDir), ['analysis-inputs']);
  } finally { await fs.rm(workDir, { recursive: true, force: true }); }
});

test('reparo por arquivo recebe resposta anterior e corrige citação rejeitada', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'analysis-file-repair-'));
  try {
    let calls = 0;
    const invalid = JSON.stringify(valid('1', 'citação inventada'));
    const result = await runAnalysisFromFile({ events: [event('1', 'fonte literal')], workDir,
      call: async (prompt, options) => {
        if (++calls === 1) return invalid;
        assert.equal(options.phase, 'repair');
        assert.match(prompt, /Não refaça a análise inteira/);
        assert.match(prompt, /citação inventada/);
        assert.equal(await fs.readFile(path.join(options.workDir, 'previous-response.txt'), 'utf8'), invalid);
        return JSON.stringify(valid('1', 'fonte literal'));
      },
    });
    assert.equal(result.complete, true);
    assert.equal(result.callsUsed, 2);
  } finally { await fs.rm(workDir, { recursive: true, force: true }); }
});

test('análise por arquivo respeita orçamento sem publicar resposta inválida', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'analysis-file-budget-'));
  try {
    let calls = 0;
    const result = await runAnalysisFromFile({ events: [event('1', 'fonte')], workDir, maxCalls: 1,
      call: async () => { calls++; return JSON.stringify(valid('1', 'invento')); },
    });
    assert.equal(result.complete, false);
    assert.equal(result.phase, 'repair');
    assert.equal(result.analysis, undefined);
    assert.equal(calls, 1);
  } finally { await fs.rm(workDir, { recursive: true, force: true }); }
});
