import fs from 'node:fs';
import path from 'node:path';
import { runCli } from './runner.js';
import { systemPrompt } from './prompts.js';

// Backend Command Code (`command-code -p --output-format json`, v1.55.0).
// O CLI não tem flags de system prompt nem de ferramentas: as duas coisas
// passam pelo mod em commandcode/mod.ts (`--mod`), que recebe
// `--mod-option systemPrompt=...` e `--mod-option tools=...` (allowlist;
// `*` = todas). Ver docs/superpowers/specs/2026-09-17-backend-commandcode-design.md.

export const name = 'commandcode';
export const supportsUsage = false; // /status não tem uso do plano para mostrar

const ROOT = path.resolve(import.meta.dirname, '..');
const MOD = path.join(ROOT, 'commandcode', 'mod.ts');
// O modelo carrega ferramentas sob demanda via `search_tools`: precisa estar liberada.
const WEB_TOOLS = 'web_search,web_fetch,search_tools';

// cwd do modo web: pasta vazia (o CLI põe git status/commits do cwd
// no system prompt e leria um AGENTS.md da raiz do bot).
export function webDir(root) {
  return path.join(root, 'commandcode', 'web');
}

export function buildRequest({ mode, sessionId, workDir, extraPrompt, model, effort, maxTurns, prompt }) {
  const args = ['-p', '--output-format', 'json', '--skip-onboarding', '--trust', '--no-auto-update',
    '--mod', MOD, '--mod-option', `systemPrompt=${systemPrompt({ mode, workDir, extraPrompt })}`];
  if (mode === 'web') {
    args.push('--mod-option', `tools=${WEB_TOOLS}`, '--no-skills');
    if (maxTurns) args.push('--max-turns', String(maxTurns));
  } else if (mode === 'vision') {
    // Descrição de imagem: só read_file (limitado ao workspace = pasta da imagem), sem sessão
    args.push('--mod-option', 'tools=read_file,search_tools', '--no-skills', '--max-turns', '4');
  } else {
    args.push('--mod-option', 'tools=*', '--yolo');
  }
  if (model) args.push('-m', model);
  if (effort) args.push('--effort', effort);
  if (sessionId && mode !== 'vision') args.push('--resume', sessionId);
  return { args, prompt };
}

// Última linha `type: "result"`. `subtype: "error"` (ex.: sessão inexistente)
// vira exceção com a mensagem do CLI; `max_turns` é resultado com isError.
export function parseResult(stdout) {
  const events = stdout.split('\n').map(parseLine).filter(Boolean);
  const result = events.findLast((e) => e.type === 'result');
  if (!result) throw new Error(`saída do command-code sem resultado: ${stdout.slice(0, 500)}`);
  if (result.subtype === 'error') throw new Error(result.error || 'command-code retornou erro');
  const lastRequest = events.findLast((e) => e.type === 'event' && e.event?.type === 'model_request_end');
  const runEnd = events.findLast((e) => e.type === 'event' && e.event?.type === 'run_end');
  return {
    text: result.finalText ?? '',
    sessionId: result.sessionId,
    isError: result.subtype !== 'success',
    subtype: result.subtype,
    numTurns: runEnd?.event.result?.turnCount,
    costUsd: undefined,
    // inputTokens já inclui o que veio do cache: é o contexto que a próxima rodada reenvia
    contextTokens: lastRequest?.event.usage?.inputTokens ?? 0,
  };
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
  web_search: (i) => `procurando na web: "${i.query}"`,
  web_fetch: (i) => `lendo página: ${i.url}`,
  shell_command: (i) => `executando comando: ${String(i.command ?? '').slice(0, 120)}`,
  powershell: (i) => `executando comando: ${String(i.command ?? '').slice(0, 120)}`,
  read_file: (i) => `lendo arquivo: ${i.file_path}`,
  edit_file: (i) => `editando arquivo: ${i.file_path}`,
  write_file: (i) => `editando arquivo: ${i.file_path}`,
  search_tools: () => null, // interno: carga de ferramentas sob demanda
};

export function describeEvent({ type, event }) {
  if (type !== 'event' || !event) return null;
  if (event.type === 'tool_queued') {
    const describe = TOOL_ACTIVITY[event.toolName];
    return describe ? describe(event.input ?? {}) : `usando ferramenta ${event.toolName}`;
  }
  if (event.type === 'tool_denied') return `ferramenta negada: ${event.toolName}`;
  if (event.type === 'message_end' && event.content?.some((b) => b.type === 'text' && b.text?.trim())) return 'gerando resposta';
  return null;
}

// Mensagem exata do CLI ao retomar sessão inexistente (verificada em 2026-09-17).
const RESUME_FAILURE = /No session ".*" found to resume/i;

export function isSessionMissing(err) {
  return RESUME_FAILURE.test(`${err.stderr ?? ''}\n${err.message}`);
}

// Caminho do CLI: no Windows o `command-code` do PATH é um shim .cmd, que o
// spawn sem shell não roda; usamos o dist/index.mjs do pacote (pelo node).
export function resolveBin(env = process.env) {
  if (env.COMMANDCODE_BIN) return env.COMMANDCODE_BIN;
  for (const dir of (env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const shim = ['command-code.cmd', 'command-code'].map((n) => path.join(dir, n)).find((f) => fs.existsSync(f));
    if (!shim) continue;
    const entry = path.join(dir, 'node_modules', 'command-code', 'dist', 'index.mjs'); // layout do npm global no Windows
    if (fs.existsSync(entry)) return entry;
    const real = fs.realpathSync(shim); // Linux/mac: o shim é link para o pacote
    if (/\.m?js$/i.test(real)) return real;
  }
  throw new Error('command-code não encontrado no PATH; instale com `npm i -g command-code` ou informe COMMANDCODE_BIN no .env (caminho do dist/index.mjs)');
}

export function run({ prompt, args, cwd, bin, timeoutMs = 600_000, onEvent, signal }, spawnImpl) {
  return runCli({ prompt, args, cwd, bin, timeoutMs, onEvent, signal, parseResult, parseLine, label: 'command-code', resultOnFailure: true }, spawnImpl);
}
