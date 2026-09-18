import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInflight } from '../src/inflight.js';

test('start registra o lote e devolve um signal não abortado', () => {
  const inflight = createInflight();
  const { signal } = inflight.start('k', [1, 2]);
  assert.equal(signal.aborted, false);
  assert.equal(inflight.has('k'), true);
});

test('cancel aborta o signal, remove a entrada e devolve os itens na ordem', () => {
  const inflight = createInflight();
  const { signal } = inflight.start('k', ['a', 'b']);
  assert.deepEqual(inflight.cancel('k'), ['a', 'b']);
  assert.equal(signal.aborted, true);
  assert.equal(inflight.has('k'), false);
});

test('cancel sem entrada devolve null', () => {
  const inflight = createInflight();
  assert.equal(inflight.cancel('x'), null);
});

test('finish remove a entrada; finish de um lote já cancelado (e substituído) não remove o novo', () => {
  const inflight = createInflight();
  const first = inflight.start('k', [1]);
  inflight.cancel('k');
  const second = inflight.start('k', [1, 2]);
  inflight.finish('k', first);
  assert.equal(inflight.has('k'), true);
  inflight.finish('k', second);
  assert.equal(inflight.has('k'), false);
});

test('lock: lote travado não cancela mais; a chave continua ocupada até finish', () => {
  const inflight = createInflight();
  const run = inflight.start('k', ['a']);
  inflight.lock(run);
  assert.equal(inflight.isLocked('k'), true);
  assert.equal(inflight.cancel('k'), null);
  assert.equal(run.signal.aborted, false);
  assert.equal(inflight.has('k'), true);
  inflight.finish('k', run);
  assert.equal(inflight.has('k'), false);
  assert.equal(inflight.isLocked('k'), false);
});

test('lock: um lote novo na mesma chave não herda a trava do anterior', () => {
  const inflight = createInflight();
  const first = inflight.start('k', ['a']);
  inflight.lock(first);
  const second = inflight.start('k', ['b']);
  assert.equal(inflight.isLocked('k'), false);
  assert.deepEqual(inflight.cancel('k'), ['b']);
  assert.equal(first.signal.aborted, false);
});
