import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArgs, parseResult, describeEvent } from '../src/claude.js';

function flagValue(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

test('modo web: só WebSearch/WebFetch, sem bypass de permissões', () => {
  const args = buildArgs({ mode: 'web' });
  assert.ok(args.includes('-p'));
  assert.equal(flagValue(args, '--output-format'), 'stream-json');
  assert.ok(args.includes('--verbose'));
  assert.equal(flagValue(args, '--tools'), 'WebSearch,WebFetch');
  assert.equal(flagValue(args, '--allowedTools'), 'WebSearch,WebFetch');
  assert.ok(!args.includes('--dangerously-skip-permissions'));
  assert.match(flagValue(args, '--append-system-prompt'), /Discord/);
});

test('modo full: bypass de permissões, todas as ferramentas, cwd no system prompt', () => {
  const args = buildArgs({ mode: 'full', workDir: 'C:\projetos\app' });
  assert.ok(args.includes('--dangerously-skip-permissions'));
  assert.ok(!args.includes('--tools'));
  assert.ok(!args.includes('--allowedTools'));
  assert.match(flagValue(args, '--append-system-prompt'), /C:\projetos\app/);
});

test('sessionId presente adiciona --resume; ausente não', () => {
  assert.equal(flagValue(buildArgs({ mode: 'web', sessionId: 'abc' }), '--resume'), 'abc');
  assert.ok(!buildArgs({ mode: 'web' }).includes('--resume'));
});

test('modo desconhecido lança erro', () => {
  assert.throws(() => buildArgs({ mode: 'x' }), /modo/i);
});

test('parseResult extrai texto e session_id de um resultado de sucesso', () => {
  const out = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Olá!', session_id: 's1', num_turns: 3, total_cost_usd: 0.02 });
  const parsed = parseResult(out);
  assert.equal(parsed.text, 'Olá!');
  assert.equal(parsed.sessionId, 's1');
  assert.equal(parsed.isError, false);
  assert.equal(parsed.subtype, 'success');
  assert.equal(parsed.numTurns, 3);
  assert.equal(parsed.costUsd, 0.02);
});

test('parseResult ignora linhas de aviso antes do JSON', () => {
  const out = 'warning: algo\n' + JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 's2' }) + '\n';
  assert.equal(parseResult(out).text, 'ok');
});

test('parseResult marca erro e usa o subtype quando não há result', () => {
  const out = JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, session_id: 's3' });
  const parsed = parseResult(out);
  assert.equal(parsed.isError, true);
  assert.equal(parsed.text, 'error_max_turns');
});

test('parseResult lança erro com a saída bruta quando não há JSON', () => {
  assert.throws(() => parseResult('nada de json aqui'), /nada de json aqui/);
});

import { spawn } from 'node:child_process';
import path from 'node:path';
import { runClaude } from '../src/claude.js';

const FAKE = path.resolve('test/fake-claude.js');
const fakeSpawn = (bin, args, opts) => spawn(process.execPath, [FAKE, ...args], opts);

test('runClaude envia o prompt por stdin e devolve o resultado parseado', async () => {
  const res = await runClaude({ prompt: 'olá mundo', args: ['-p', '--resume', 'abc'], cwd: process.cwd(), timeoutMs: 5000 }, fakeSpawn);
  assert.equal(res.sessionId, 'abc');
  assert.equal(res.isError, false);
  assert.match(res.text, /^echo: olá mundo \| args: -p --resume abc$/);
});

test('runClaude rejeita com stderr quando o processo sai com erro', async () => {
  process.env.FAKE_FAIL = '1';
  try {
    await assert.rejects(
      runClaude({ prompt: 'x', args: [], cwd: process.cwd(), timeoutMs: 5000 }, fakeSpawn),
      /código 1.*falha simulada/s,
    );
  } finally {
    delete process.env.FAKE_FAIL;
  }
});

test('runClaude mata o processo e rejeita ao exceder o tempo limite', async () => {
  process.env.FAKE_SLEEP_MS = '3000';
  const start = Date.now();
  try {
    await assert.rejects(
      runClaude({ prompt: 'x', args: [], cwd: process.cwd(), timeoutMs: 200 }, fakeSpawn),
      /tempo limite/,
    );
  } finally {
    delete process.env.FAKE_SLEEP_MS;
  }
  assert.ok(Date.now() - start < 2500, 'não esperou o processo terminar sozinho');
});

test('system prompt explica o cabeçalho, a regra de julgamento e o sentinela NO_REPLY', () => {
  for (const mode of ['web', 'full']) {
    const prompt = flagValue(buildArgs({ mode, workDir: 'C:\w' }), '--append-system-prompt');
    assert.match(prompt, /responder: sempre/);
    assert.match(prompt, /responder: se couber/);
    assert.match(prompt, /NO_REPLY/);
  }
});

test('extraPrompt é anexado ao final do system prompt', () => {
  const prompt = flagValue(buildArgs({ mode: 'web', extraPrompt: 'Premissa: o Node 24 é LTS.' }), '--append-system-prompt');
  assert.ok(prompt.endsWith('Premissa: o Node 24 é LTS.'));
  assert.ok(!flagValue(buildArgs({ mode: 'web' }), '--append-system-prompt').includes('undefined'));
});

test('modo web é enxuto: sem skills, sem MCP', () => {
  const args = buildArgs({ mode: 'web' });
  assert.ok(args.includes('--strict-mcp-config'));
  assert.ok(args.includes('--disable-slash-commands'));
  assert.ok(!buildArgs({ mode: 'full' }).includes('--strict-mcp-config'));
});

test('model e effort viram --model/--effort só quando informados', () => {
  const args = buildArgs({ mode: 'web', model: 'sonnet', effort: 'low' });
  assert.equal(flagValue(args, '--model'), 'sonnet');
  assert.equal(flagValue(args, '--effort'), 'low');
  const plain = buildArgs({ mode: 'web' });
  assert.ok(!plain.includes('--model') && !plain.includes('--effort'));
});

test('runClaude rejeita no tempo limite mesmo se um processo-neto segurar o stdout', async () => {
  process.env.FAKE_SLEEP_MS = '3000';
  process.env.FAKE_SPAWN_HOLDER = '1';
  const start = Date.now();
  try {
    await assert.rejects(
      runClaude({ prompt: 'x', args: [], cwd: process.cwd(), timeoutMs: 200 }, fakeSpawn),
      /tempo limite/,
    );
  } finally {
    delete process.env.FAKE_SLEEP_MS;
    delete process.env.FAKE_SPAWN_HOLDER;
  }
  assert.ok(Date.now() - start < 2500, 'ficou esperando o pipe fechar');
});

test('runClaude anexa stderr e stdout completos ao erro de saída', async () => {
  process.env.FAKE_FAIL = '1';
  try {
    await runClaude({ prompt: 'x', args: [], cwd: process.cwd(), timeoutMs: 5000 }, fakeSpawn);
    assert.fail('deveria rejeitar');
  } catch (err) {
    assert.match(err.stderr, /falha simulada/);
    assert.equal(typeof err.stdout, 'string');
  } finally {
    delete process.env.FAKE_FAIL;
  }
});

test('system prompt explica a seção de contexto recente', () => {
  assert.match(flagValue(buildArgs({ mode: 'web' }), '--append-system-prompt'), /contexto recente/);
});

test('parseResult acha a linha de resultado no meio do stream NDJSON', () => {
  const out = [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 's9' }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'oi' }] }, session_id: 's9' }),
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'oi', session_id: 's9' }),
  ].join('\n') + '\n';
  assert.equal(parseResult(out).text, 'oi');
  assert.equal(parseResult(out).sessionId, 's9');
});

const assistant = (block) => ({ type: 'assistant', message: { role: 'assistant', content: [block] } });

test('describeEvent traduz ferramentas e texto em atividade legível', () => {
  assert.equal(describeEvent(assistant({ type: 'tool_use', name: 'WebSearch', input: { query: 'node 24 lts' } })), 'procurando na web: "node 24 lts"');
  assert.equal(describeEvent(assistant({ type: 'tool_use', name: 'WebFetch', input: { url: 'https://nodejs.org' } })), 'lendo página: https://nodejs.org');
  assert.equal(describeEvent(assistant({ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } })), 'executando comando: npm test');
  assert.equal(describeEvent(assistant({ type: 'tool_use', name: 'Read', input: { file_path: 'C:/x/a.js' } })), 'lendo arquivo: C:/x/a.js');
  assert.equal(describeEvent(assistant({ type: 'tool_use', name: 'Edit', input: { file_path: 'C:/x/a.js' } })), 'editando arquivo: C:/x/a.js');
  assert.equal(describeEvent(assistant({ type: 'tool_use', name: 'Glob', input: { pattern: '**/*.js' } })), 'usando ferramenta Glob');
  assert.equal(describeEvent(assistant({ type: 'text', text: 'Olá' })), 'gerando resposta');
});

test('describeEvent ignora o que não é atividade e avisa limite de uso', () => {
  assert.equal(describeEvent(assistant({ type: 'thinking', thinking: '...' })), null);
  assert.equal(describeEvent({ type: 'system', subtype: 'init' }), null);
  assert.equal(describeEvent({ type: 'user', message: { content: [] } }), null);
  assert.equal(describeEvent({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }), null);
  assert.equal(describeEvent({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour' } }), 'limite de uso: rejected (five_hour)');
});

test('runClaude entrega cada evento do stream ao onEvent e ainda devolve o resultado', async () => {
  const events = [];
  const res = await runClaude({ prompt: 'x', args: [], cwd: process.cwd(), timeoutMs: 5000, onEvent: (e) => events.push(e) }, fakeSpawn);
  assert.deepEqual(events.map((e) => e.type), ['system', 'assistant', 'user', 'result']);
  assert.match(res.text, /^echo: x/);
  assert.equal(res.numTurns, 2);
});

test('runClaude mata o processo e rejeita com AbortError ao abortar', async () => {
  process.env.FAKE_SLEEP_MS = '3000';
  const controller = new AbortController();
  const start = Date.now();
  setTimeout(() => controller.abort(), 100);
  try {
    await assert.rejects(
      runClaude({ prompt: 'x', args: [], cwd: process.cwd(), timeoutMs: 5000, signal: controller.signal }, fakeSpawn),
      (err) => err.name === 'AbortError',
    );
  } finally {
    delete process.env.FAKE_SLEEP_MS;
  }
  assert.ok(Date.now() - start < 2500, 'não esperou o processo terminar sozinho');
});

test('system prompt explica pessoas citadas, índices #n e a diretiva [responder: #n]', () => {
  const prompt = flagValue(buildArgs({ mode: 'web' }), '--append-system-prompt');
  assert.match(prompt, /pessoas citadas/);
  assert.match(prompt, /\[responder: #n\]/);
  assert.match(prompt, /<@id>/);
});
