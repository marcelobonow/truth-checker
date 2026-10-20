import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as claude from '../src/claude.js';
import * as commandcode from '../src/commandcode.js';
import * as codex from '../src/codex.js';
import { askClaude } from '../src/bridge.js';
import { WEB_MAX_TURNS } from '../src/settings.commandcode.js';

for (const backend of [claude, commandcode, codex]) {
  for (const mode of ['web', 'full', 'vision', 'analysis']) test(`${backend.name}/${mode}: metadados precedem o pedido e respeitam as flags`, () => {
    const request = backend.buildRequest({ mode, prompt: 'pedido original', model: 'modelo escolhido', effort: 'high', maxTurns: 10 });
    assert.ok(request.prompt.startsWith('[ambiente de execução'));
    assert.ok(request.prompt.endsWith('\n\npedido original'));
    assert.ok(request.prompt.includes(`Backend: ${backend.name}; modo: ${mode}`));
    assert.ok(request.prompt.includes('Modelo solicitado: modelo escolhido'));
    assert.ok(request.prompt.includes('Reasoning solicitado: high'));
    const index = request.args.indexOf('--max-turns');
    const expected = index < 0 ? 'sem teto configurado pelo bot' : request.args[index + 1];
    assert.ok(request.prompt.includes(`Máximo de turnos nesta execução: ${expected}`));
    assert.ok(request.prompt.includes('Janela máxima de contexto do modelo: desconhecida'));
  });
}

test('sessão retomada usa medição anterior; fallback limpa contagens e mantém escolha do usuário', async () => {
  let saved = 'antiga';
  const requests = [];
  await askClaude({ key: 'g', mode: 'web', prompt: 'oi', messageCount: 3,
    model: 'gpt-6-luna', effort: null, backend: { ...commandcode, isSessionMissing: () => true },
    config: { maxTurns: { web: WEB_MAX_TURNS }, model: { web: 'deepseek/deepseek-v4.1-flash' }, effort: { web: 'high' }, session: { maxMessages: 400, maxContextTokens: 150000 } },
    store: { get: () => saved, info: () => saved ? { messages: 12, contextTokens: 25000 } : undefined, clear: () => { saved = undefined; } },
    runner: async (request) => { requests.push(request); if (requests.length === 1) throw new Error('test missing'); return {}; },
  });
  assert.equal(WEB_MAX_TURNS, 15);
  assert.ok(requests[0].prompt.includes('25000 tokens na última chamada medida'));
  assert.ok(requests[0].prompt.includes('sessão: 12; mensagens incluídas neste pedido: 3'));
  assert.ok(requests[1].prompt.includes('sessão: 0;'));
  assert.ok(requests[1].prompt.includes('Contexto atual: desconhecido'));
  for (const request of requests) {
    assert.ok(request.prompt.includes('Modelo solicitado: gpt-6-luna'));
    assert.ok(request.prompt.includes('Reasoning solicitado: padrão do CLI'));
    assert.ok(request.prompt.includes('reinício da sessão pelo bot: 150000'));
    assert.ok(request.prompt.includes('reinício da sessão: 400'));
    assert.ok(!request.args.includes('--effort'));
  }
});

test('Command Code explica teto de turnos e estimativa de buscas web sem inventar cota por conversa', () => {
  const { prompt } = commandcode.buildRequest({ mode: 'web', prompt: 'quantas buscas?', maxTurns: WEB_MAX_TURNS });
  assert.match(prompt, /Não existe uma cota separada de pesquisas por conversa/);
  assert.match(prompt, /cerca de 2 turnos/);
  assert.match(prompt, /aproximadamente 7 buscas simples/);
  assert.match(prompt, /até aproximadamente 5 por resposta/);
  assert.match(prompt, /Isso é uma estimativa, não um contador separado/);
  assert.match(prompt, /não diga que desconhece um valor presente aqui/);
});
