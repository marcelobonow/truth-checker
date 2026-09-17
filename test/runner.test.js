import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { runCli } from '../src/runner.js';

// Runner genérico: spawn + stdin + stream de linhas; quem chama diz como
// interpretar a saída. Aqui o "CLI" é um spawn falso que devolve stdout fixo.
function fakeProcess({ stdout = '', stderr = '', code = 0 } = {}) {
  const child = new EventEmitter();
  child.pid = 4242;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => {};
  setImmediate(() => {
    child.stdout.end(stdout);
    child.stderr.end(stderr);
    setImmediate(() => child.emit('close', code));
  });
  return child;
}

const parseResult = (stdout) => {
  const line = stdout.trim().split('\n').findLast((l) => l.startsWith('{'));
  if (!line) throw new Error('sem resultado');
  const r = JSON.parse(line);
  return { text: r.text, isError: Boolean(r.err) };
};
const parseLine = (line) => (line.trim().startsWith('{') ? JSON.parse(line) : null);

test('runCli: bin .mjs roda pelo node com o arquivo na frente dos args', async () => {
  let spawned;
  const spawnImpl = (bin, args, opts) => {
    spawned = { bin, args, opts };
    return fakeProcess({ stdout: '{"text":"ok"}\n' });
  };
  const res = await runCli({ bin: 'C:/x/dist/index.mjs', args: ['-p'], prompt: 'oi', cwd: 'C:/w', timeoutMs: 1000, parseResult, parseLine, label: 'cc' }, spawnImpl);
  assert.equal(spawned.bin, process.execPath);
  assert.deepEqual(spawned.args, ['C:/x/dist/index.mjs', '-p']);
  assert.equal(spawned.opts.cwd, 'C:/w');
  assert.equal(res.text, 'ok');
});

test('runCli: bin comum roda direto', async () => {
  let spawned;
  const spawnImpl = (bin, args) => {
    spawned = { bin, args };
    return fakeProcess({ stdout: '{"text":"ok"}\n' });
  };
  await runCli({ bin: 'claude', args: ['-p'], prompt: 'oi', cwd: 'C:/w', timeoutMs: 1000, parseResult, parseLine, label: 'claude' }, spawnImpl);
  assert.equal(spawned.bin, 'claude');
  assert.deepEqual(spawned.args, ['-p']);
});

test('runCli: label entra na mensagem de erro de saída', async () => {
  const spawnImpl = () => fakeProcess({ stderr: 'quebrou', code: 3 });
  await assert.rejects(
    runCli({ bin: 'x', args: [], prompt: '', cwd: '.', timeoutMs: 1000, parseResult, parseLine, label: 'command-code' }, spawnImpl),
    /^Error: command-code saiu com código 3: quebrou$/,
  );
});

test('runCli: com resultOnFailure, saída com código ≠ 0 mas com resultado resolve com ele', async () => {
  const spawnImpl = () => fakeProcess({ stdout: '{"text":"parcial","err":true}\n', stderr: 'aviso', code: 8 });
  const res = await runCli({ bin: 'x', args: [], prompt: '', cwd: '.', timeoutMs: 1000, parseResult, parseLine, label: 'cc', resultOnFailure: true }, spawnImpl);
  assert.equal(res.text, 'parcial');
  assert.equal(res.isError, true);
});

test('runCli: com resultOnFailure, saída com código ≠ 0 e sem resultado rejeita', async () => {
  const spawnImpl = () => fakeProcess({ stdout: 'lixo\n', stderr: 'falhou', code: 1 });
  await assert.rejects(
    runCli({ bin: 'x', args: [], prompt: '', cwd: '.', timeoutMs: 1000, parseResult, parseLine, label: 'cc', resultOnFailure: true }, spawnImpl),
    /cc saiu com código 1: falhou/,
  );
});

test('runCli: entrega cada linha parseada a onEvent conforme chega', async () => {
  const spawnImpl = () => fakeProcess({ stdout: '{"a":1}\nnão json\n{"text":"fim"}\n' });
  const events = [];
  await runCli({ bin: 'x', args: [], prompt: '', cwd: '.', timeoutMs: 1000, parseResult, parseLine, label: 'cc', onEvent: (e) => events.push(e) }, spawnImpl);
  assert.deepEqual(events, [{ a: 1 }, { text: 'fim' }]);
});
