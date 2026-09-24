import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectBackend } from '../src/backend.js';
import * as claude from '../src/claude.js';
import * as commandcode from '../src/commandcode.js';

test('selectBackend devolve o módulo do backend e o settings de modelos correspondente', async () => {
  const c = await selectBackend('claude');
  assert.equal(c.backend, claude);
  assert.equal(typeof c.settings.MODEL.web, 'string');
  const cc = await selectBackend('commandcode');
  assert.equal(cc.backend, commandcode);
  assert.match(cc.settings.MODEL.web, /mimo|deepseek/);
  assert.ok(cc.settings.WEB_MAX_TURNS >= 4);
});

test('selectBackend: nome inválido lista os válidos', async () => {
  await assert.rejects(selectBackend('codex'), /claude.*commandcode/);
});

test('os dois settings de backend exportam a mesma forma', async () => {
  for (const name of ['claude', 'commandcode']) {
    const { settings } = await selectBackend(name);
    assert.deepEqual(Object.keys(settings).sort(), ['EFFORT', 'MODEL', 'MODEL_CHOICES', 'WEB_MAX_TURNS']);
    assert.ok('web' in settings.MODEL && 'full' in settings.MODEL);
    assert.ok('web' in settings.EFFORT && 'full' in settings.EFFORT);
    assert.ok(Array.isArray(settings.MODEL_CHOICES) && settings.MODEL_CHOICES.length > 0);
    for (const entry of settings.MODEL_CHOICES) {
      assert.ok(typeof entry === 'string' || (entry && typeof entry.model === 'string'));
    }
  }
});
