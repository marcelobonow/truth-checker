import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemPrompt, NO_REPLY } from '../src/prompts.js';

test('systemPrompt: prompt do modo + extraPrompt no final', () => {
  const web = systemPrompt({ mode: 'web', extraPrompt: '  Premissa: X.  ' });
  assert.match(web, /Discord/);
  assert.match(web, /NO_REPLY/);
  assert.ok(web.endsWith('Premissa: X.'));
  const full = systemPrompt({ mode: 'full', workDir: 'C:/app' });
  assert.match(full, /C:\/app/);
  assert.ok(!full.includes('undefined'));
});

test('systemPrompt: modo desconhecido lança erro', () => {
  assert.throws(() => systemPrompt({ mode: 'x' }), /modo/i);
  assert.equal(NO_REPLY, 'NO_REPLY');
});
