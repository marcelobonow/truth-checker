import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createModelStore, formatModelList, normalizeChoices, choiceValue, choiceName, DEFAULT_MODEL_CHOICE } from '../src/models.js';

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'models-test-'));
  return path.join(dir, 'models.db');
}

test('DEFAULT_MODEL_CHOICE é o valor que volta ao padrão', () => {
  assert.equal(DEFAULT_MODEL_CHOICE, 'padrão');
});

test('normalizeChoices: string vira { model }; vazias e o "padrão" saem', () => {
  assert.deepEqual(normalizeChoices(['sonnet', { model: 'gpt-6-luna', effort: 'low' }, '', null, 'padrão']), [
    { model: 'sonnet' },
    { model: 'gpt-6-luna', effort: 'low' },
  ]);
});

test('choiceValue: model:effort com esforço; id com ":" sem esforço fica intacto', () => {
  assert.equal(choiceValue({ model: 'gpt-6-luna', effort: 'low' }), 'gpt-6-luna:low');
  assert.equal(choiceValue({ model: 'gpt-6-luna', effort: null }), 'gpt-6-luna');
  assert.equal(choiceValue({ model: 'inclusionai/ling-3.0-flash-sante:free' }), 'inclusionai/ling-3.0-flash-sante:free');
});

test('choiceName: nome vence; sem ele, model (effort) ou só o model', () => {
  assert.equal(choiceName({ model: 'gpt-6-luna', effort: 'low', nome: 'GPT-6 Luna (low)' }), 'GPT-6 Luna (low)');
  assert.equal(choiceName({ model: 'meta/muse-spark-1.3-contributor', effort: 'high' }), 'meta/muse-spark-1.3-contributor (high)');
  assert.equal(choiceName({ model: 'xiaomi/mimo-v2.6-flash' }), 'xiaomi/mimo-v2.6-flash');
});

test('get de usuário sem escolha retorna undefined', () => {
  const store = createModelStore(tmpFile());
  assert.equal(store.get('111'), undefined);
});

test('set grava e get devolve; persiste entre instâncias', () => {
  const file = tmpFile();
  createModelStore(file).set('111', 'sonnet');
  assert.equal(createModelStore(file).get('111'), 'sonnet');
});

test('set de novo troca o modelo; continua uma linha só por usuário', () => {
  const file = tmpFile();
  const store = createModelStore(file);
  store.set('111', 'sonnet', 1000);
  store.set('111', 'haiku', 2000);
  assert.equal(store.get('111'), 'haiku');
  assert.deepEqual(store.list(), [{ userId: '111', model: 'haiku', updatedAt: 2000 }]);
});

test('clear apaga a escolha e persiste', () => {
  const file = tmpFile();
  const store = createModelStore(file);
  store.set('111', 'sonnet');
  assert.equal(store.clear('111'), true);
  assert.equal(createModelStore(file).get('111'), undefined);
  assert.deepEqual(createModelStore(file).list(), []);
});

test('clear de usuário sem escolha não faz nada', () => {
  const store = createModelStore(tmpFile());
  assert.equal(store.clear('111'), true);
  assert.deepEqual(store.list(), []);
});

test('list devolve só quem escolheu, mais recente primeiro', () => {
  const file = tmpFile();
  const store = createModelStore(file);
  store.set('111', 'sonnet', 1000);
  store.set('222', 'haiku', 3000);
  store.set('333', 'opus', 2000);
  assert.deepEqual(createModelStore(file).list(), [
    { userId: '222', model: 'haiku', updatedAt: 3000 },
    { userId: '333', model: 'opus', updatedAt: 2000 },
    { userId: '111', model: 'sonnet', updatedAt: 1000 },
  ]);
});

test('falha de gravação não derruba o set: devolve false e registra', () => {
  const errors = [];
  const store = createModelStore(tmpFile(), { onError: (msg) => errors.push(msg) });
  assert.equal(store.set('111', null), false); // NOT NULL estoura no INSERT
  assert.equal(errors.length, 1);
  assert.deepEqual(store.list(), []);
});

test('formatModelList: sem ninguém, avisa que todos usam o padrão', () => {
  assert.equal(formatModelList([]), 'Ninguém escolheu um modelo: todos usam o padrão.');
});

test('formatModelList: uma linha por pessoa, com menção', () => {
  assert.equal(formatModelList([
    { userId: '111', model: 'sonnet', updatedAt: 1000 },
    { userId: '222', model: 'deepseek/deepseek-v4.1-flash', updatedAt: 2000 },
  ]), [
    'Quem saiu do modelo padrão:',
    '- <@111> → sonnet',
    '- <@222> → deepseek/deepseek-v4.1-flash',
  ].join('\n'));
});
