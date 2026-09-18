import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitMessage } from '../src/split.js';

test('texto curto vira um único bloco sem alteração', () => {
  assert.deepEqual(splitMessage('oi, tudo bem?', 2000), ['oi, tudo bem?']);
});

test('texto vazio ou só espaços não gera bloco', () => {
  assert.deepEqual(splitMessage('', 2000), []);
  assert.deepEqual(splitMessage('  \n ', 2000), []);
});

test('texto longo é cortado na última quebra de linha antes do limite', () => {
  const text = 'linha um\nlinha dois\nlinha três';
  const chunks = splitMessage(text, 20);
  assert.deepEqual(chunks, ['linha um\nlinha dois', 'linha três']);
});

test('sem quebra de linha, corta no último espaço; sem espaço, corta no limite', () => {
  assert.deepEqual(splitMessage('aaa bbb ccc', 7), ['aaa bbb', 'ccc']);
  assert.deepEqual(splitMessage('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
});

test('todos os blocos respeitam o limite', () => {
  const text = Array.from({ length: 50 }, (_, i) => `linha ${i} com algum texto`).join('\n');
  for (const chunk of splitMessage(text, 100)) {
    assert.ok(chunk.length <= 100, `bloco com ${chunk.length} chars`);
  }
});

test('corte dentro de bloco de código fecha a cerca e reabre com a mesma linguagem', () => {
  const text = 'antes\n```js\nconst a = 1;\nconst b = 2;\nconst c = 3;\n```\ndepois';
  const chunks = splitMessage(text, 30);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks[0].endsWith('\n```'), `primeiro bloco: ${JSON.stringify(chunks[0])}`);
  assert.ok(chunks[1].startsWith('```js\n'), `segundo bloco: ${JSON.stringify(chunks[1])}`);
  for (const chunk of chunks) assert.ok(chunk.length <= 30);
});

test('cerca de código já fechada no bloco não é reaberta no próximo', () => {
  const text = '```\nx\n```\nlinha depois do código que é longa';
  const chunks = splitMessage(text, 12);
  assert.equal(chunks[0], '```\nx\n```');
  assert.ok(!chunks[1].startsWith('```'));
});

test('indentação da linha seguinte ao corte é preservada', () => {
  const text = 'function f() {\n    return 1;\n}';
  const chunks = splitMessage(text, 16);
  assert.deepEqual(chunks, ['function f() {', '    return 1;\n}']);
});

test('trecho inline com três crases numa linha só não é tratado como cerca', () => {
  const text = '```js x``` é inline\nsegunda linha bem longa para forçar o corte aqui';
  const chunks = splitMessage(text, 30);
  assert.equal(chunks[0], '```js x``` é inline');
  assert.ok(!chunks[1].startsWith('```'), `segundo bloco: ${JSON.stringify(chunks[1])}`);
});
