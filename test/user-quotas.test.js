import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUserQuotaStore, estimateCostUsd, readQuotaSettings } from '../src/user-quotas.js';

const november = new Date('2026-12-01T02:59:59Z');
const december = new Date('2026-12-01T03:00:00Z');
const { limits, rates } = readQuotaSettings({});

test('cadastra como free e soma o consumo por usuário até atingir a cota', (t) => {
  const store = createUserQuotaStore(':memory:', limits);
  t.after(() => store.close());
  assert.deepEqual(store.get('123', november), { tier: 'free', month: '2026-11', spentUsd: 0, limitUsd: 1 });
  store.addUsage('123', '2026-11', 0.1);
  store.addUsage('123', '2026-11', 0.9);
  assert.equal(store.get('123', november).spentUsd, 1);
  assert.equal(store.get('456', november).spentUsd, 0);
});

test('virada do mês em São Paulo zera o consumo e preserva a categoria', (t) => {
  const store = createUserQuotaStore(':memory:', limits);
  t.after(() => store.close());
  store.setTier('123', 'vip');
  store.addUsage('123', '2026-11', 4);
  store.setTier('123', 'premium');
  assert.deepEqual(store.get('123', november), { tier: 'premium', month: '2026-11', spentUsd: 4, limitUsd: 15 });
  assert.deepEqual(store.get('123', december), { tier: 'premium', month: '2026-12', spentUsd: 0, limitUsd: 15 });
  store.addUsage('123', '2026-12', 0.25);
  assert.equal(store.get('123', december).spentUsd, 0.25);
  assert.throws(() => store.setTier('123', 'admin'), /CHECK constraint/);
});

test('prioriza custo do CLI e soma tokens de todas as rodadas na estimativa', () => {
  const tokenUsage = [{ inputTokens: 1000, outputTokens: 100 }, { inputTokens: 4000, outputTokens: 900 }];
  assert.equal(estimateCostUsd({ costUsd: 0.04, tokenUsage }, rates), 0.04);
  assert.equal(estimateCostUsd({ tokenUsage }, rates), 0.03);
  assert.equal(estimateCostUsd({ tokenUsage: [] }, rates), 0.01);
});

test('lista até 20 usuários pelo consumo do mês, sem trazer o gasto do mês anterior', (t) => {
  const store = createUserQuotaStore(':memory:', limits);
  t.after(() => store.close());
  for (let id = 100; id <= 120; id++) {
    store.get(String(id), december);
    store.addUsage(String(id), '2026-12', id / 100);
  }
  store.setTier('999', 'premium');
  store.addUsage('999', '2026-11', 10);
  const rows = store.list(december);
  assert.equal(rows.length, 20);
  assert.deepEqual(rows.slice(0, 2).map(({ userId, spentUsd }) => [userId, spentUsd]), [['120', 1.2], ['119', 1.19]]);
  assert.equal(rows.at(-1).userId, '101');
});

test('consulta sem cadastro e lista de cota renovam na virada do mês', (t) => {
  const store = createUserQuotaStore(':memory:', limits);
  t.after(() => store.close());
  assert.equal(store.inspect('123', december).tier, 'free');
  assert.deepEqual(store.list(december), []);
  store.setTier('123', 'vip');
  store.addUsage('123', '2026-11', 2);
  assert.deepEqual(store.list(december), [{ userId: '123', tier: 'vip', month: '2026-12', spentUsd: 0, limitUsd: 5 }]);
});
