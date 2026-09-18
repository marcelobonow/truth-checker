import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import * as cc from '../src/commandcode.js';

function flagValue(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}
// valor de um `--mod-option nome=valor`
function modOption(args, name) {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === '--mod-option' && args[i + 1].startsWith(`${name}=`)) return args[i + 1].slice(name.length + 1);
  }
  return undefined;
}

test('buildRequest web: allowlist só web, sem skills, sem yolo, com teto de turnos; prompt vai no stdin', () => {
  const { args, prompt } = cc.buildRequest({ mode: 'web', prompt: 'oi', maxTurns: 8 });
  assert.ok(args.includes('-p'));
  assert.equal(flagValue(args, '--output-format'), 'json');
  assert.ok(args.includes('--skip-onboarding') && args.includes('--trust') && args.includes('--no-auto-update'));
  assert.equal(modOption(args, 'tools'), 'web_search,web_fetch,search_tools');
  assert.ok(args.includes('--no-skills'));
  assert.ok(!args.includes('--yolo'));
  assert.equal(flagValue(args, '--max-turns'), '8');
  assert.equal(prompt, 'oi');
});

test('buildRequest full: todas as ferramentas e --yolo, sem --no-skills, cwd no system prompt', () => {
  const { args } = cc.buildRequest({ mode: 'full', workDir: 'C:/app', prompt: 'oi' });
  assert.equal(modOption(args, 'tools'), '*');
  assert.ok(args.includes('--yolo'));
  assert.ok(!args.includes('--no-skills'));
  assert.ok(!args.includes('--max-turns'));
  assert.match(modOption(args, 'systemPrompt'), /C:\/app/);
});

test('buildRequest: --mod aponta para commandcode/mod.ts e o system prompt é o do modo + extra', () => {
  const { args } = cc.buildRequest({ mode: 'web', prompt: 'oi', extraPrompt: 'Premissa: X.' });
  assert.match(flagValue(args, '--mod').replace(/\\/g, '/'), /\/commandcode\/mod\.ts$/);
  const sys = modOption(args, 'systemPrompt');
  assert.match(sys, /Discord/);
  assert.match(sys, /NO_REPLY/);
  assert.ok(sys.endsWith('Premissa: X.'));
});

test('buildRequest: -m/--effort/--resume só quando informados', () => {
  const args = cc.buildRequest({ mode: 'web', prompt: '', model: 'deepseek/x', effort: 'low', sessionId: 's1' }).args;
  assert.equal(flagValue(args, '-m'), 'deepseek/x');
  assert.equal(flagValue(args, '--effort'), 'low');
  assert.equal(flagValue(args, '--resume'), 's1');
  const plain = cc.buildRequest({ mode: 'web', prompt: '' }).args;
  assert.ok(!plain.includes('-m') && !plain.includes('--effort') && !plain.includes('--resume'));
});

const line = (o) => JSON.stringify(o);
const ev = (event) => line({ type: 'event', event });

test('parseResult: sucesso com sessão, turnos do run_end e contexto do último model_request_end', () => {
  const out = [
    ev({ type: 'run_start', sessionId: 's1' }),
    ev({ type: 'model_request_end', model: 'm', usage: { inputTokens: 100, outputTokens: 5, cacheReadTokens: 50 } }),
    ev({ type: 'model_request_end', model: 'm', usage: { inputTokens: 16232, outputTokens: 50, cacheReadTokens: 7168 } }),
    ev({ type: 'run_end', result: { finalText: 'oi', turnCount: 2 } }),
    line({ type: 'result', subtype: 'success', sessionId: 's1', stopReason: 'end_turn', usage: { inputTokens: 16332, outputTokens: 55 }, durationMs: 10, finalText: 'oi' }),
  ].join('\n') + '\n';
  const r = cc.parseResult(out);
  assert.equal(r.text, 'oi');
  assert.equal(r.sessionId, 's1');
  assert.equal(r.isError, false);
  assert.equal(r.subtype, 'success');
  assert.equal(r.numTurns, 2);
  assert.equal(r.contextTokens, 16232);
  assert.equal(r.costUsd, undefined);
});

test('parseResult: max_turns é resultado com erro e texto parcial', () => {
  const r = cc.parseResult(line({ type: 'result', subtype: 'max_turns', sessionId: 's1', usage: {}, durationMs: 1, finalText: 'parcial' }));
  assert.equal(r.isError, true);
  assert.equal(r.subtype, 'max_turns');
  assert.equal(r.text, 'parcial');
  assert.equal(r.contextTokens, 0);
});

test('parseResult: subtype error lança com a mensagem do CLI', () => {
  const out = line({ type: 'result', subtype: 'error', usage: {}, durationMs: 11, finalText: '', error: 'Error: No session "abc" found to resume.' });
  assert.throws(() => cc.parseResult(out), /No session "abc" found to resume/);
});

test('parseResult: sem linha de resultado lança com a saída bruta', () => {
  assert.throws(() => cc.parseResult('nada de json aqui'), /nada de json aqui/);
});

test('describeEvent traduz ferramentas, bloqueios e texto em atividade legível', () => {
  const queued = (toolName, input) => ({ type: 'event', event: { type: 'tool_queued', toolCallId: 't', toolName, input } });
  assert.equal(cc.describeEvent(queued('web_search', { query: 'node 24 lts' })), 'procurando na web: "node 24 lts"');
  assert.equal(cc.describeEvent(queued('web_fetch', { url: 'https://nodejs.org' })), 'lendo página: https://nodejs.org');
  assert.equal(cc.describeEvent(queued('shell_command', { command: 'npm test' })), 'executando comando: npm test');
  assert.equal(cc.describeEvent(queued('powershell', { command: 'ls' })), 'executando comando: ls');
  assert.equal(cc.describeEvent(queued('read_file', { file_path: 'C:/x/a.js' })), 'lendo arquivo: C:/x/a.js');
  assert.equal(cc.describeEvent(queued('edit_file', { file_path: 'C:/x/a.js' })), 'editando arquivo: C:/x/a.js');
  assert.equal(cc.describeEvent(queued('write_file', { file_path: 'C:/x/a.js' })), 'editando arquivo: C:/x/a.js');
  assert.equal(cc.describeEvent(queued('glob', { pattern: '*' })), 'usando ferramenta glob');
  assert.equal(cc.describeEvent(queued('search_tools', { query: 'select:web_search' })), null);
  assert.equal(cc.describeEvent({ type: 'event', event: { type: 'tool_denied', toolCallId: 't', toolName: 'monitor_command' } }), 'ferramenta negada: monitor_command');
  assert.equal(cc.describeEvent({ type: 'event', event: { type: 'message_end', content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'Olá' }] } }), 'gerando resposta');
  assert.equal(cc.describeEvent({ type: 'event', event: { type: 'message_end', content: [{ type: 'tool_use', name: 'web_search' }] } }), null);
  assert.equal(cc.describeEvent({ type: 'event', event: { type: 'text_delta', delta: 'O' } }), null);
  assert.equal(cc.describeEvent({ type: 'result', subtype: 'success' }), null);
});

test('isSessionMissing reconhece a mensagem do CLI no stderr ou na mensagem do erro', () => {
  const err = new Error('command-code saiu com código 1: ...');
  err.stderr = 'Error: No session "abc" found to resume.\n';
  assert.equal(cc.isSessionMissing(err), true);
  assert.equal(cc.isSessionMissing(new Error('No session "x" found to resume.')), true);
  assert.equal(cc.isSessionMissing(new Error('command-code excedeu o tempo limite')), false);
});

test('webDir é a pasta vazia commandcode/web; supportsUsage é false', () => {
  assert.equal(cc.webDir('C:/bot'), path.join('C:/bot', 'commandcode', 'web'));
  assert.equal(cc.supportsUsage, false);
  assert.equal(cc.name, 'commandcode');
});

test('resolveBin: COMMANDCODE_BIN definido vence', () => {
  assert.equal(cc.resolveBin({ COMMANDCODE_BIN: 'C:/x/index.mjs', PATH: '' }), 'C:/x/index.mjs');
});

test('resolveBin: acha o dist/index.mjs ao lado do shim npm no PATH (layout Windows)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-bin-'));
  const entry = path.join(dir, 'node_modules', 'command-code', 'dist', 'index.mjs');
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, '');
  fs.writeFileSync(path.join(dir, 'command-code.cmd'), '');
  try {
    assert.equal(cc.resolveBin({ PATH: `C:/nada${path.delimiter}${dir}` }), entry);
    assert.throws(() => cc.resolveBin({ PATH: 'C:/nada' }), /COMMANDCODE_BIN/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const FAKE = path.resolve('test/fake-commandcode.js');
const fakeSpawn = (bin, args, opts) => spawn(process.execPath, [FAKE, ...args], opts);

test('run: prompt por stdin, eventos em onEvent e resultado parseado', async () => {
  const events = [];
  const res = await cc.run({ prompt: 'olá mundo', args: ['-p', '--resume', 'abc'], cwd: process.cwd(), bin: 'x', timeoutMs: 5000, onEvent: (e) => events.push(e) }, fakeSpawn);
  assert.equal(res.sessionId, 'abc');
  assert.equal(res.isError, false);
  assert.match(res.text, /^echo: olá mundo \| args: -p --resume abc$/);
  assert.ok(events.some((e) => e.event?.type === 'tool_queued'));
});

test('run: teto de turnos (exit 8) vira resultado com erro em vez de rejeitar', async () => {
  process.env.FAKE_MAX_TURNS = '1';
  try {
    const res = await cc.run({ prompt: 'x', args: [], cwd: process.cwd(), bin: 'x', timeoutMs: 5000 }, fakeSpawn);
    assert.equal(res.isError, true);
    assert.equal(res.subtype, 'max_turns');
  } finally {
    delete process.env.FAKE_MAX_TURNS;
  }
});

test('run: falha sem resultado rejeita com stderr', async () => {
  process.env.FAKE_FAIL = '1';
  try {
    await assert.rejects(cc.run({ prompt: 'x', args: [], cwd: process.cwd(), bin: 'x', timeoutMs: 5000 }, fakeSpawn), /command-code saiu com código 1.*falha simulada/s);
  } finally {
    delete process.env.FAKE_FAIL;
  }
});

test('run: sessão inexistente rejeita com a mensagem do CLI (stderr) e isSessionMissing reconhece', async () => {
  process.env.FAKE_NO_SESSION = '1';
  try {
    await cc.run({ prompt: 'x', args: ['--resume', 'velha'], cwd: process.cwd(), bin: 'x', timeoutMs: 5000 }, fakeSpawn);
    assert.fail('deveria rejeitar');
  } catch (err) {
    assert.equal(cc.isSessionMissing(err), true);
  } finally {
    delete process.env.FAKE_NO_SESSION;
  }
});
