import { runCli } from './runner.js';
import { systemPrompt, NO_REPLY } from './prompts.js';

export { NO_REPLY };

const WEB_TOOLS = 'WebSearch,WebFetch';

export function buildArgs({ mode, sessionId, workDir, extraPrompt, model, effort, maxTurns }) {
  const prompt = systemPrompt({ mode, workDir, extraPrompt });
  // stream-json (exige --verbose): um evento JSON por linha, o último é o resultado
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--append-system-prompt', prompt];
  if (mode === 'web') {
    // Enxuto: só ferramentas web, sem skills nem servidores MCP da config global
    // (menos tokens no system prompt e nada exposto a quem só menciona o bot).
    args.push('--tools', WEB_TOOLS, '--allowedTools', WEB_TOOLS, '--strict-mcp-config', '--disable-slash-commands');
    // teto de idas à web por resposta: cada resultado de busca entra no contexto
    if (maxTurns) args.push('--max-turns', String(maxTurns));
  }
  if (mode === 'full') args.push('--dangerously-skip-permissions');
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  if (sessionId) args.push('--resume', sessionId);
  return args;
}

// Saída de `--output-format stream-json`: uma linha JSON por evento; o
// resultado é o evento `type: "result"` (normalmente o último). Também aceita
// a saída de `--output-format json` (um único objeto).
export function parseResult(stdout) {
  const events = parseEvents(stdout);
  const result = events.findLast((e) => e.type === 'result');
  if (!result) throw new Error(`saída do claude sem resultado: ${stdout.slice(0, 500)}`);
  return {
    text: result.result ?? result.subtype ?? '',
    sessionId: result.session_id,
    isError: Boolean(result.is_error) || result.subtype !== 'success',
    subtype: result.subtype,
    numTurns: result.num_turns,
    costUsd: result.total_cost_usd,
    contextTokens: contextTokensOf(result.usage),
  };
}

// Tamanho do contexto na última chamada à API (input + cache), que é o que
// cada rodada seguinte vai reenviar. `iterations` separa as chamadas quando
// houve ferramentas; sem ele, o total serve.
function contextTokensOf(usage) {
  if (!usage) return 0;
  const last = usage.iterations?.at(-1) ?? usage;
  return (last.input_tokens ?? 0) + (last.cache_read_input_tokens ?? 0) + (last.cache_creation_input_tokens ?? 0);
}

function parseEvents(text) {
  const events = [];
  for (const line of text.split('\n')) {
    const event = parseLine(line);
    if (event) events.push(event);
  }
  return events;
}

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

// Traduz um evento do stream em uma linha de atividade legível (ou null).
const TOOL_ACTIVITY = {
  WebSearch: (i) => `procurando na web: "${i.query}"`,
  WebFetch: (i) => `lendo página: ${i.url}`,
  Bash: (i) => `executando comando: ${String(i.command ?? '').slice(0, 120)}`,
  Read: (i) => `lendo arquivo: ${i.file_path}`,
  Edit: (i) => `editando arquivo: ${i.file_path}`,
  Write: (i) => `editando arquivo: ${i.file_path}`,
};

export function describeEvent(event) {
  if (event.type === 'rate_limit_event') {
    const info = event.rate_limit_info ?? {};
    return info.status === 'allowed' ? null : `limite de uso: ${info.status} (${info.rateLimitType})`;
  }
  if (event.type !== 'assistant') return null;
  for (const block of event.message?.content ?? []) {
    if (block.type === 'tool_use') {
      const describe = TOOL_ACTIVITY[block.name];
      return describe ? describe(block.input ?? {}) : `usando ferramenta ${block.name}`;
    }
    if (block.type === 'text' && block.text?.trim()) return 'gerando resposta';
  }
  return null;
}

// Roda `claude` uma vez (ver runner.js).
export function runClaude({ prompt, args, cwd, bin = 'claude', timeoutMs = 600_000, onEvent, signal }, spawnImpl) {
  return runCli({ prompt, args, cwd, bin, timeoutMs, onEvent, signal, parseResult, parseLine, label: 'claude' }, spawnImpl);
}

// ---- interface de backend (ver backend.js) ----

export const name = 'claude';
export const supportsUsage = true; // /status consulta o uso do plano claude.ai
export const run = runClaude;

export function buildRequest({ mode, sessionId, workDir, extraPrompt, model, effort, maxTurns, prompt }) {
  return { args: buildArgs({ mode, sessionId, workDir, extraPrompt, model, effort, maxTurns }), prompt };
}

// Mensagem exata do CLI ao retomar sessão inexistente (verificada em 2026-09-17).
const RESUME_FAILURE = /No conversation found with session ID/i;

export function isSessionMissing(err) {
  return RESUME_FAILURE.test(`${err.stderr ?? ''}\n${err.message}`);
}

// cwd do modo web: a pasta do bot (o CLI só tem ferramentas web lá)
export function webDir(root) {
  return root;
}

export function resolveBin(env = process.env) {
  return env.CLAUDE_BIN || 'claude';
}
