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

test('systemPrompt: modo vision descreve imagens, sem o texto do Discord e sem extraPrompt', () => {
  const vision = systemPrompt({ mode: 'vision', extraPrompt: 'Premissa: X.' });
  assert.match(vision, /descreve imagens/i);
  assert.match(vision, /ERRO:/);
  assert.ok(!vision.includes('Discord'));
  assert.ok(!vision.includes(NO_REPLY));
  assert.ok(!vision.includes('Premissa'));
});

test('systemPrompt: modos de conversa explicam o bloco de imagem', () => {
  assert.match(systemPrompt({ mode: 'web' }), /\[imagem anexada/);
  assert.match(systemPrompt({ mode: 'full', workDir: 'x' }), /\[imagem na mensagem citada/);
});

test('systemPrompt: modos de conversa informam os formatos de documento aceitos', () => {
  const prompt = systemPrompt({ mode: 'web' });
  assert.match(prompt, /Word \.doc e \.docx/);
  assert.match(prompt, /PDF \.pdf/);
  assert.match(prompt, /OpenDocument Text \.odt/);
  assert.match(prompt, /Não lê vídeos, áudios/i);
});
