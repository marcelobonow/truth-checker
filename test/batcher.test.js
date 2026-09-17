import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBatcher } from '../src/batcher.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('mensagens dentro da janela de silêncio saem juntas num único lote', async () => {
  const flushes = [];
  const batcher = createBatcher({ delayMs: 40, onFlush: (key, items) => flushes.push({ key, items }) });
  batcher.add('c1', 'a');
  await sleep(20);
  batcher.add('c1', 'b');
  await sleep(20);
  assert.equal(flushes.length, 0, 'ainda não passaram 40 ms sem mensagem');
  await sleep(40);
  assert.deepEqual(flushes, [{ key: 'c1', items: ['a', 'b'] }]);
});

test('chaves diferentes formam lotes independentes', async () => {
  const flushes = [];
  const batcher = createBatcher({ delayMs: 20, onFlush: (key, items) => flushes.push({ key, items }) });
  batcher.add('c1', 'a');
  batcher.add('c2', 'b');
  await sleep(50);
  assert.deepEqual(flushes, [{ key: 'c1', items: ['a'] }, { key: 'c2', items: ['b'] }]);
});

test('mensagem depois do lote enviado inicia um lote novo', async () => {
  const flushes = [];
  const batcher = createBatcher({ delayMs: 20, onFlush: (key, items) => flushes.push(items) });
  batcher.add('c1', 'a');
  await sleep(50);
  batcher.add('c1', 'b');
  await sleep(50);
  assert.deepEqual(flushes, [['a'], ['b']]);
});

test('erro no onFlush não impede lotes seguintes', async () => {
  const flushes = [];
  const batcher = createBatcher({
    delayMs: 20,
    onFlush: async (key, items) => {
      if (items[0] === 'boom') throw new Error('boom');
      flushes.push(items);
    },
    onError: () => {},
  });
  batcher.add('c1', 'boom');
  await sleep(50);
  batcher.add('c1', 'ok');
  await sleep(50);
  assert.deepEqual(flushes, [['ok']]);
});

test('add devolve quantas mensagens o lote daquela chave acumulou', () => {
  const batcher = createBatcher({ delayMs: 1000, onFlush: () => {} });
  assert.equal(batcher.add('c1', 'a'), 1);
  assert.equal(batcher.add('c1', 'b'), 2);
  assert.equal(batcher.add('c2', 'x'), 1);
});
