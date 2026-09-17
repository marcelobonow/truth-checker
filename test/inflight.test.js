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
