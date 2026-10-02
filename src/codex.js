import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { runCli } from './runner.js';
import { systemPrompt } from './prompts.js';

export const name = 'codex';
export const supportsUsage = false; // /status não consulta uso da conta Codex

export function webDir(root) {
  return path.join(root, 'codex', 'web');
}

export function buildArgs({ mode, sessionId, workDir, model, effort, imageFile }) {
  if (!['web', 'full', 'vision'].includes(mode)) throw new Error(`modo desconhecido: ${mode}`);

  const args = ['exec'];
  if (sessionId && mode !== 'vision') args.push('resume', sessionId);
  args.push('--json', '--skip-git-repo-check', '--ignore-user-config');
  if (workDir && !sessionId) args.push('--cd', workDir);
  if (model) args.push('--model', model);
  if (effort) args.push('--config', `model_reasoning_effort=${JSON.stringify(effort)}`);
  args.push('--config', `web_search=${JSON.stringify(mode === 'vision' ? 'disabled' : 'live')}`);
  args.push('--disable', 'apps', '--disable', 'multi_agent');

  if (mode === 'full') {
    // O modo full só é liberado pelo bot nos servidores configurados.
    args.push('--dangerously-bypass-approvals-and-sandbox');
  } else {
    // Sem shell/ferramentas locais no web e na visão: web usa apenas web_search;
    // visão recebe a imagem diretamente pela flag --image.
    args.push('--config', `sandbox_mode=${JSON.stringify('read-only')}`, '--disable', 'shell_tool');
  }

  if (mode === 'vision' && imageFile) args.push('--image', imageFile);
  args.push('-'); // o prompt da mensagem vai por stdin

  return args;
}

function codexInstructions({ mode, workDir, extraPrompt }) {
  const prompt = systemPrompt({ mode, workDir, extraPrompt });
  if (mode !== 'vision') return prompt;
  return prompt.replace('Leia o arquivo indicado com a ferramenta de leitura', 'Analise a imagem anexada ao pedido');
}

export function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function parseResult(stdout) {
  const events = stdout.split('\n').map(parseLine).filter(Boolean);
  const lastTurnIndex = events.findLastIndex((event) => event.type === 'turn.completed');
  const lastFailure = events.findLast((event) => event.type === 'turn.failed' || event.type === 'error');
  if (lastFailure && events.lastIndexOf(lastFailure) > lastTurnIndex) {
    throw new Error(lastFailure.error?.message ?? lastFailure.message ?? 'Codex retornou erro');
  }
  if (lastTurnIndex < 0) throw new Error(`saída do codex sem turn.completed: ${stdout.slice(0, 500)}`);

  const finalMessage = events.findLast((event) => event.type === 'item.completed' && event.item?.type === 'agent_message')?.item?.text ?? '';
  const usage = events[lastTurnIndex].usage ?? {};
  const inputTokens = tokenNumber(usage.input_tokens);
  const cachedInputTokens = tokenNumber(usage.cached_input_tokens);
  const outputTokens = tokenNumber(usage.output_tokens);
  const hasUsage = inputTokens != null || cachedInputTokens != null || outputTokens != null;

  return {
    text: finalMessage,
    sessionId: events.find((event) => event.type === 'thread.started')?.thread_id,
    isError: false,
    subtype: 'success',
    numTurns: events.filter((event) => event.type === 'turn.started').length,
    costUsd: undefined,
    contextTokens: inputTokens ?? 0,
    tokenUsage: hasUsage ? [{
      model: null,
      inputTokens: inputTokens,
      outputTokens,
      cacheReadInputTokens: cachedInputTokens,
      cacheCreationInputTokens: tokenNumber(usage.cache_write_input_tokens),
    }] : [],
  };
}

function tokenNumber(value) {
  return value == null || !Number.isFinite(Number(value)) ? null : Number(value);
}

const TOOL_ACTIVITY = {
  web_search: (item) => `pesquisando na web${item.query ? `: "${item.query}"` : ''}`,
  command_execution: (item) => `executando comando: ${String(item.command ?? '').slice(0, 120)}`,
};

export function describeEvent(event) {
  if (event.type === 'item.started' || event.type === 'item.updated') {
    const item = event.item ?? {};
    if (item.type === 'agent_message') return 'gerando resposta';
    const describe = TOOL_ACTIVITY[item.type];
    return describe ? describe(item) : null;
  }
  return null;
}

export function isSessionMissing(err) {
  return /(?:thread|session|conversation)[^\n]{0,120}(?:not found|does not exist|no rollout)|(?:not found|does not exist)[^\n]{0,120}(?:thread|session|conversation)|no saved (?:thread|session)|rollout file.*not found/i.test(`${err.stderr ?? ''}\n${err.message}`);
}

export function resolveBin(env = process.env) {
  return env.CODEX_BIN || 'codex';
}

export async function run({ prompt, args, instructions, sessionId, cwd, bin, timeoutMs = 600_000, onEvent, signal }, spawnImpl) {
  const instructionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-codex-'));
  const instructionFile = path.join(instructionDir, 'instructions.md');
  try {
    fs.writeFileSync(instructionFile, instructions, { encoding: 'utf8', mode: 0o600 });
    const codexArgs = args.slice();
    const promptIndex = codexArgs.lastIndexOf('-');
    codexArgs.splice(promptIndex, 0, '--config', `model_instructions_file=${JSON.stringify(instructionFile)}`);
    return await runCli({
      prompt,
      args: codexArgs,
      cwd,
      bin,
      timeoutMs,
      onEvent,
      signal,
      parseLine,
      parseResult: (stdout) => {
        const result = parseResult(stdout);
        return { ...result, sessionId: result.sessionId ?? sessionId };
      },
      label: 'codex',
    }, spawnImpl);
  } finally {
    try { fs.unlinkSync(instructionFile); } catch { /* arquivo não chegou a ser criado */ }
    try { fs.rmdirSync(instructionDir); } catch { /* já removido ou não vazio */ }
  }
}

export function buildRequest({ mode, sessionId, workDir, extraPrompt, model, effort, maxTurns, prompt, imageFile }) {
  const adjustedPrompt = mode === 'vision'
    ? prompt.replace(/Descreva a imagem em .* com detalhe e sem repetição, seguindo as instruções do seu prompt\./, 'Descreva a imagem anexada com detalhe e sem repetição, seguindo as instruções do seu prompt.')
    : prompt;
  return {
    args: buildArgs({ mode, sessionId, workDir, model, effort, imageFile }),
    prompt: adjustedPrompt,
    instructions: codexInstructions({ mode, workDir, extraPrompt }),
    sessionId,
  };
}
