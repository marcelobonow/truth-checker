import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUsage, formatUsage, fetchUsage } from '../src/usage.js';

test('parseUsage pega a utilização das janelas de 5 h e 7 dias', () => {
  const data = { five_hour: { utilization: 49 }, seven_day: { utilization: 32 } };
  assert.deepEqual(parseUsage(data), { fiveHour: 49, sevenDay: 32 });
  assert.deepEqual(parseUsage({}), { fiveHour: null, sevenDay: null });
});

test('formatUsage mostra o usado, arredondado, "?" quando falta o dado', () => {
  assert.equal(formatUsage({ fiveHour: 49, sevenDay: 32 }), '49/32%');
  assert.equal(formatUsage({ fiveHour: 100, sevenDay: 0 }), '100/0%');
  assert.equal(formatUsage({ fiveHour: 49.6, sevenDay: null }), '50/?%');
});

test('fetchUsage manda o bearer e o header beta; erro HTTP vira exceção', async () => {
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, json: async () => ({ five_hour: { utilization: 10 }, seven_day: { utilization: 20 } }) };
  };
  assert.deepEqual(await fetchUsage({ token: 'tok', fetchFn }), { fiveHour: 10, sevenDay: 20 });
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer tok');
  assert.equal(calls[0].opts.headers['anthropic-beta'], 'oauth-2025-04-20');

  const failing = async () => ({ ok: false, status: 401 });
  await assert.rejects(fetchUsage({ token: 'tok', fetchFn: failing }), /401/);
});
