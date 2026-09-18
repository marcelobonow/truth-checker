import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSessionStore } from '../src/sessions.js';

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sessions-test-'));
  return path.join(dir, 'sessions.json');
}

test('guild desconhecida retorna undefined', () => {
  const store = createSessionStore(tmpFile());
  assert.equal(store.get('111'), undefined);
});

test('set grava e get devolve; persiste entre instâncias', () => {
  const file = tmpFile();
  createSessionStore(file).set('111', 'sess-a');
  assert.equal(createSessionStore(file).get('111'), 'sess-a');
});

test('clear remove a sessão e persiste', () => {
  const file = tmpFile();
  const store = createSessionStore(file);
  store.set('111', 'sess-a');
  store.clear('111');
  assert.equal(store.get('111'), undefined);
  assert.equal(createSessionStore(file).get('111'), undefined);
});

test('arquivo corrompido é tratado como store vazio', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{ not json');
  assert.equal(createSessionStore(file).get('111'), undefined);
});

test('falha ao gravar o arquivo não derruba o set: valor fica em memória', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sessions-test-'));
  const store = createSessionStore(dir, { onError: () => {} }); // caminho é um diretório: writeFileSync falha
  assert.doesNotThrow(() => store.set('111', 'sess-a'));
  assert.equal(store.get('111'), 'sess-a');
});

test('touch acumula mensagens e atualiza lastUsed; info devolve tudo', () => {
  const store = createSessionStore(tmpFile());
  store.set('111', 'sess-a');
  store.touch('111', 12, 1000);
  store.touch('111', 5, 2000, 42_000);
  assert.deepEqual(store.info('111'), { id: 'sess-a', messages: 17, lastUsed: 2000, contextTokens: 42_000 });
  assert.equal(store.get('111'), 'sess-a');
});

test('set com id diferente zera a contagem; info persiste entre instâncias', () => {
  const file = tmpFile();
  const store = createSessionStore(file);
  store.set('111', 'sess-a');
  store.touch('111', 10, 1000);
  store.set('111', 'sess-b');
  assert.equal(createSessionStore(file).info('111').messages, 0);
  assert.equal(createSessionStore(file).info('111').id, 'sess-b');
});

test('arquivo no formato antigo (string) é lido como sessão sem contagem', () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ 111: 'sess-a' }));
  const store = createSessionStore(file);
  assert.equal(store.get('111'), 'sess-a');
  assert.equal(store.info('111').messages, 0);
});

test('clearAll apaga todas as sessões e persiste', () => {
  const file = tmpFile();
  const store = createSessionStore(file);
  store.set('111', 'a');
  store.set('222', 'b');
  assert.equal(store.clearAll(), 2);
  assert.equal(store.get('111'), undefined);
  assert.equal(createSessionStore(file).get('222'), undefined);
});
