import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemPrompt, NO_REPLY } from '../src/prompts.js';

test('systemPrompt reply: prompt do modo + extraPrompt no final', () => {
  const web = systemPrompt({ kind: 'reply', mode: 'web', extraPrompt: '  Premissa: X.  ' });
  assert.match(web, /Discord/);
  assert.match(web, /NO_REPLY/);
  assert.ok(web.endsWith('Premissa: X.'));
  const full = systemPrompt({ kind: 'reply', mode: 'full', workDir: 'C:/app' });
  assert.match(full, /C:\/app/);
  assert.ok(!full.includes('undefined'));
});

test('systemPrompt judge: prompt do juiz + extraPrompt, sem o prompt do modo', () => {
  const judge = systemPrompt({ kind: 'judge', mode: 'web', extraPrompt: 'Premissa: X.' });
  assert.match(judge, /SIM ou NAO/);
  assert.ok(!judge.includes('Discord, em português'));
  assert.ok(judge.endsWith('Premissa: X.'));
});

test('systemPrompt: modo ou tipo desconhecido lança erro', () => {
  assert.throws(() => systemPrompt({ kind: 'reply', mode: 'x' }), /modo/i);
  assert.throws(() => systemPrompt({ kind: 'x', mode: 'web' }), /tipo/i);
  assert.equal(NO_REPLY, 'NO_REPLY');
});
