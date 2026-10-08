import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as claude from '../src/claude.js';
import * as commandcode from '../src/commandcode.js';
import * as codex from '../src/codex.js';
import { createConversationBackendCaller } from '../src/conversation-backend.js';

const flagValue = (args, flag) => args[args.indexOf(flag) + 1];
const modOption = (args, name) => args.flatMap((value, index) => value === '--mod-option' && args[index + 1]?.startsWith(`${name}=`) ? [args[index + 1].slice(name.length + 1)] : [])[0];

test('modo analysis do Claude é sem ferramentas e sem sessão retomada', () => {
  const request = claude.buildRequest({ mode: 'analysis', prompt: 'dados', sessionId: 'conversation-session' });
  assert.equal(flagValue(request.args, '--tools'), '');
  assert.equal(flagValue(request.args, '--allowedTools'), '');
  assert.ok(request.args.includes('--strict-mcp-config') && request.args.includes('--disable-slash-commands'));
  assert.ok(!request.args.includes('--resume') && !request.args.includes('--dangerously-skip-permissions'));
});

test('modo analysis do Command Code bloqueia ferramentas e não retoma sessão', () => {
  const request = commandcode.buildRequest({ mode: 'analysis', prompt: 'dados', sessionId: 'conversation-session' });
  assert.equal(modOption(request.args, 'tools'), '');
  assert.ok(request.args.includes('--no-skills'));
  assert.ok(!request.args.includes('--resume') && !request.args.includes('--yolo'));
});

test('modo analysis do Codex desliga web/shell/apps e não retoma sessão', () => {
  const request = codex.buildRequest({ mode: 'analysis', prompt: 'dados', sessionId: 'conversation-session' });
  assert.equal(flagValue(request.args, '--config'), 'web_search="disabled"');
  assert.ok(request.args.includes('shell_tool') && request.args.includes('apps') && request.args.includes('multi_agent'));
  assert.ok(request.args.some((arg) => arg.startsWith('sandbox_mode=')));
  assert.ok(!request.args.includes('resume') && !request.args.includes('--dangerously-bypass-approvals-and-sandbox'));
});

test('caller executa análise no backend escolhido, com modelo próprio e prioridade baixa', async () => {
  const observed = {};
  const backend = {
    name: 'commandcode',
    buildRequest: (options) => { observed.options = options; return { args: ['-p'], prompt: options.prompt }; },
    run: async (request) => { observed.request = request; return { text: '{"summary":"ok"}', isError: false }; },
  };
  const queue = { add: (task, options) => { observed.priority = options.priority; return task(); } };
  const caller = createConversationBackendCaller({
    backend, queue,
    config: { model: { analysis: 'analysis-model' }, effort: { analysis: 'low' }, workDir: 'C:\\work', bin: 'mock', timeoutMs: 5_000 },
  });
  assert.equal(await caller('payload'), '{"summary":"ok"}');
  assert.equal(observed.options.mode, 'analysis');
  assert.equal(observed.options.model, 'analysis-model');
  assert.equal(observed.options.effort, 'low');
  assert.equal(observed.priority, 'low');
  assert.equal(observed.request.cwd, 'C:\\work');
  assert.equal(observed.request.bin, 'mock');
});
