import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueue } from '../src/queue.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('executa uma tarefa por vez, na ordem de chegada', async () => {
  const queue = createQueue();
  const log = [];
  const a = queue.add(async () => { log.push('a:start'); await sleep(20); log.push('a:end'); });
  const b = queue.add(async () => { log.push('b:start'); log.push('b:end'); });
  await Promise.all([a, b]);
  assert.deepEqual(log, ['a:start', 'a:end', 'b:start', 'b:end']);
});

test('add devolve o resultado da tarefa', async () => {
  const queue = createQueue();
  assert.equal(await queue.add(async () => 42), 42);
});

test('tarefa que falha rejeita a própria promise sem travar a fila', async () => {
  const queue = createQueue();
  const failing = queue.add(async () => { throw new Error('boom'); });
  const next = queue.add(async () => 'ok');
  await assert.rejects(failing, /boom/);
  assert.equal(await next, 'ok');
});
