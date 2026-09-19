# Backend alternativo: Command Code no lugar do Claude Code

> Nota (2026-09-17, depois): o juiz por modelo descrito abaixo (`kind: 'judge'`, `buildJudgeArgs`, `JUDGE` por backend) foi substituído pelo juiz heurístico local (ver `2026-09-17-juiz-heuristico-design.md`); `buildRequest` não tem mais `kind`.

## Objetivo

Escolher, ao iniciar o bot, qual CLI gera as respostas: `claude` (Claude Code, como hoje) ou `command-code` (Command Code, já instalado e logado na máquina: `command-code@1.55.0`, `command-code status` → autenticado). O resto do bot (Discord, lotes, fila, sessões, juiz, contexto) não muda.

## O que apurei do Command Code (v1.55.0, testado em 2026-09-17)

Fonte: `command-code --help`, [docs/headless](https://commandcode.ai/docs/headless), [docs/mods](https://commandcode.ai/docs/mods), [docs/settings](https://commandcode.ai/docs/settings), [docs/reference/tools](https://commandcode.ai/docs/reference/tools), [docs/core-concepts/custom-agents](https://commandcode.ai/docs/core-concepts/custom-agents) e execuções reais com `-m deepseek/deepseek-v4.1-flash`.

- Headless: `command-code -p --output-format json`; prompt por stdin funciona.
- Saída NDJSON: linhas `{"type":"event","event":{...}}` e uma última `{"type":"result","subtype":"success"|"error"|"max_turns","sessionId","stopReason","usage":{"inputTokens","outputTokens","cacheReadTokens","cacheWriteTokens"},"durationMs","finalText","error"?}`. Sem custo em dólar.
- Eventos úteis: `tool_queued` (`toolName`, `input`), `tool_running`, `tool_completed`, `tool_denied`, `message_end` (`content` com blocos `text`/`thinking`/`tool_use`), `model_request_end` (`usage` da chamada; `inputTokens` já inclui o cache — sessão retomada cresceu ~300 tokens, não 7 k), `run_end` (`result.turnCount`).
- Sessão: persiste em disco por padrão; `--resume <id>` com `-p` funciona (o modelo lembrou um valor da rodada anterior). `--no-session` desliga a persistência. Id inexistente: exit 1, stderr `Error: No session "<id>" found to resume.` e result `subtype: "error"`.
- `--max-turns N` estourado: exit 8, stderr `Warning: Reached maximum conversation turns`, result `subtype: "max_turns"` com `finalText` parcial.
- Modelo e esforço: `-m <id>` (`--list-models` lista 70) e `--effort` (valores dependem do modelo: deepseek-v4.1-flash aceita `low|high|max`; `medium` dá exit 1 "Unknown effort").
- **System prompt e ferramentas: via mod.** Não há `--append-system-prompt`, `--tools`, `--allowedTools`, `--strict-mcp-config` nem `--config permissions.deny` ("Unknown config setting"). `AGENTS.md` é um arquivo só por pasta (não varia por modo) e custom agents só funcionam como subagentes. Mas mods (`--mod <arquivo.ts>`, compilado pelo jiti na hora, carregado também no headless) têm:
  - `appendSystemPrompt()` → texto anexado ao system prompt de verdade, em toda chamada (byte-estável = cache de prompt). Testado: modelo obedeceu.
  - `setActiveTools([...])` → ferramentas fora da lista somem do schema e do `search_tools`. Testado: `read_file`/`glob` sumiram.
  - `beforeToolCall()` → `{ block: true }` bloqueia qualquer chamada, inclusive ferramentas carregadas por `search_tools` e MCP. Testado.
  - `--mod-option nome=valor` passa valores ao mod; aceita multilinha, `=` e aspas dentro do valor (testado via `spawn` sem shell). Lista vazia de ferramentas funciona (juiz respondeu `SIM` em 2,8 s).
- Sem `--yolo`, o headless já bloqueia escrita e shell (`tool_denied`); o mod é a camada que garante o resto.
- Web: `web_search` e `web_fetch` funcionam no headless. O modelo primeiro chama `search_tools` (carrega ferramentas sob demanda) e só depois `web_search`: cada busca custa ~2 turnos, então `search_tools` precisa estar na allowlist.
- Executável: no Windows `command-code` é shim npm (`.cmd`), que `spawn` sem shell não executa (ENOENT). Funciona `node <npm root -g>/command-code/dist/index.mjs …` (aqui: `C:\nvm4w\nodejs\node_modules\command-code\dist\index.mjs`). `claude` é `.exe` (winget), por isso o problema não aparece hoje.
- Outras flags: `--skip-onboarding`, `--trust`, `--no-auto-update`, `--no-skills`, `--yolo`.

## Comportamento desejado

`BACKEND = 'commandcode'` no `settings.js` → todas as gerações (resposta e juiz) passam pelo `command-code`:

| Hoje (claude) | Com command-code |
|---|---|
| system prompt via `--append-system-prompt` | `--mod commandcode/mod.ts --mod-option systemPrompt=<texto>`; o mod anexa ao system prompt em toda chamada (mesma coisa que o Claude faz hoje; cache de prompt cobre o custo) |
| web: `--tools WebSearch,WebFetch --strict-mcp-config` | `--mod-option tools=web_search,web_fetch,search_tools` (allowlist do mod) + `--no-skills`; sem `--yolo` |
| full: `--dangerously-skip-permissions` | `--yolo`, `tools=*` (`web_fetch`/`web_search` incluídos) |
| juiz: `--tools '' --max-turns 1` | `--mod-option tools=` (nenhuma) `--max-turns 1 --no-session` |
| cwd web/juiz: pasta do bot | `commandcode/web/` (pasta vazia da repo: o Command Code põe git status/commits do cwd no system prompt e leria um `AGENTS.md` da raiz) |
| juiz em modo full: cwd `WORK_DIR` | juiz sempre em `webDir` (nos dois backends; não usa ferramentas) |
| `--resume <id>` | `--resume <id>`; sessão sumida detectada por `No session "…" found to resume` |
| `--model sonnet`, `--effort low` | `-m deepseek/deepseek-v4.1-flash`, `--effort low` |
| `contextTokens` do último `usage` | `inputTokens` do último `model_request_end` |
| `costUsd` | indisponível (log fica sem custo) |
| `/status` mostra uso do plano claude.ai | `/status` mostra só a sessão ("uso do plano: só com o Claude Code") |

## Mudanças

### `commandcode/mod.ts` (novo)

Mod de ~20 linhas: flags `systemPrompt` (string) e `tools` (string; `*` = todas, vazio = nenhuma, senão lista separada por vírgula). Hooks: `appendSystemPrompt` devolve `systemPrompt`; `onSessionStart` chama `setActiveTools` quando `tools !== '*'`; `beforeToolCall` bloqueia `toolName` fora da lista. Sem dependências.

### `commandcode/web/` (novo)

Pasta vazia com `README.md` de duas linhas: cwd do modo web e do juiz quando o backend é commandcode.

### `src/prompts.js` (novo)

`COMMON_PROMPT`, `MODE_PROMPTS`, `JUDGE_PROMPT`, `NO_REPLY` saem de `claude.js` para cá, sem alteração de texto (`WEB_TOOLS` fica no `claude.js`). Os dois backends importam daqui. `claude.js` reexporta `NO_REPLY`.

### `src/runner.js` (novo)

`runClaude` vira `runCli({ bin, args, prompt, cwd, timeoutMs, onEvent, signal, parseResult, parseLine, label, resultOnFailure })`: o mesmo spawn + stdin + stream de linhas + timeout + abort + `killTree`. Diferenças: `label` entra nas mensagens de erro (`${label} excedeu o tempo limite…`, `${label} saiu com código…`); com `resultOnFailure`, saída com código ≠ 0 primeiro tenta `parseResult(stdout)` e, se houver resultado, resolve com ele (é o caso do exit 8 = `max_turns`, que vira resultado com `isError`, como o `error_max_turns` do Claude). Se `bin` termina em `.mjs`/`.js`, spawna `process.execPath` com `[bin, ...args]`. `claude.js` mantém `runClaude` como wrapper (`label: 'claude'`), então `test/claude.test.js` não muda.

### `src/claude.js`

Vira o backend Claude Code com a interface comum:

```js
export const name = 'claude';
export function buildRequest({ kind, mode, sessionId, workDir, extraPrompt, model, effort, maxTurns, prompt })
  // kind 'reply' → { args: buildArgs(...), prompt }; kind 'judge' → { args: buildJudgeArgs(...), prompt }
export const run = runClaude;
export function describeEvent(event)   // como hoje
export function isSessionMissing(err)  // RESUME_FAILURE sai do bridge.js para cá
export function webDir(root)           // root (como hoje)
export function resolveBin(env)        // env.CLAUDE_BIN || 'claude'
export const supportsUsage = true;     // /status consulta o uso do plano
```

`buildArgs`, `buildJudgeArgs`, `parseResult` continuam exportados (testes existentes).

### `src/commandcode.js` (novo)

Mesma interface:

- `buildRequest`: flags fixas `-p --output-format json --skip-onboarding --trust --no-auto-update --mod <ROOT>/commandcode/mod.ts --mod-option systemPrompt=<prompt do modo ou do juiz + extraPrompt>`; `-m`/`--effort` se definidos; `--resume` se houver sessão. Por tipo/modo:
  - reply web: `--mod-option tools=web_search,web_fetch,search_tools --no-skills --max-turns <maxTurns>`.
  - reply full: `--mod-option tools=* --yolo`.
  - judge: `--mod-option tools= --no-skills --no-session --max-turns 1`.
  - `prompt` (stdin) = mensagem do usuário, sem alteração. Campos dos inputs de ferramenta: `file_path` (read/write/edit), `command`, `query`, `url`.
- `parseResult(stdout)`: último `result`. `subtype: "error"` → lança erro com `result.error` na mensagem (assim a sessão sumida cai no caminho de erro do bridge). Senão → `{ text: finalText, sessionId, isError: subtype !== 'success', subtype, numTurns: run_end.result.turnCount, costUsd: undefined, contextTokens: inputTokens do último model_request_end }`. Sem `result` → erro como hoje.
- `describeEvent`: `tool_queued` → `procurando na web: "…"` / `lendo página: …` / `executando comando: …` / `lendo arquivo: …` / `editando arquivo: …` / `usando ferramenta X` (`search_tools` → null); `tool_denied` → `ferramenta negada: X`; `message_end` com bloco `text` não vazio → `gerando resposta`. Demais eventos → null.
- `isSessionMissing(err)`: `/No session ".*" found to resume/i` em `err.stderr + err.message`.
- `webDir(root)` → `path.join(root, 'commandcode', 'web')`.
- `resolveBin(env)`: `env.COMMANDCODE_BIN` se definido; senão procura `command-code` (ou `command-code.cmd`) nas pastas do `PATH` e devolve `<pasta>/node_modules/command-code/dist/index.mjs` (layout do npm global no Windows) ou o `realpath` do link (Linux/mac). Se nada existir, erro na inicialização com instrução para preencher `COMMANDCODE_BIN`.
- `supportsUsage = false`.
- `run` = `runCli` com `parseResult` daqui, `label: 'command-code'`, `resultOnFailure: true`.

### `src/backend.js` (novo)

`selectBackend(name)`: `'claude'` → `claude.js`, `'commandcode'` → `commandcode.js`; outro → erro listando os válidos. Também devolve o módulo de settings correspondente.

### `src/settings.js`, `src/settings.claude.js` (novo), `src/settings.commandcode.js` (novo)

- `settings.js` ganha `export const BACKEND = 'claude'; // 'claude' | 'commandcode'` e perde `MODEL`, `EFFORT`, `JUDGE`, `WEB_MAX_TURNS`.
- `settings.claude.js`: `MODEL`, `EFFORT`, `JUDGE`, `WEB_MAX_TURNS` exatamente como estão hoje (comentários incluídos).
- `settings.commandcode.js`: mesmos quatro exports, com `deepseek/deepseek-v4.1-flash` nos três modelos, `EFFORT = { web: 'low', full: 'high' }`, `JUDGE = { model: 'deepseek/deepseek-v4.1-flash', effort: 'low' }`, `WEB_MAX_TURNS = 8` (cada busca gasta ~2 turnos). Comentário: ids em `command-code --list-models`; trocar o juiz por um modelo mais barato depois.

### `src/bridge.js`

- `askClaude` e `shouldReply` recebem `backend` (padrão: `claude.js`) e usam `backend.buildRequest`, `runner = backend.run`, `backend.isSessionMissing(err)`. O runner continua recebendo `prompt` (texto do stdin); `buildRequest` devolve `{ args, prompt }`.
- `shouldReply` roda sempre em `config.webDir`.
- Nome `askClaude` fica.

### `src/index.js`

- `{ backend, settings } = selectBackend(BACKEND)`; `config.bin = backend.resolveBin(env)`; `config.webDir = backend.webDir(ROOT)`; `model`/`effort`/`judge`/`maxTurns` vêm de `settings` (o módulo do backend).
- `describeEvent` do backend. Logs `gerando com claude` / `claude: …` usam `backend.name`.
- `/status`: pula `fetchUsage` quando `!backend.supportsUsage`.
- Log de configuração ganha `backend` e `bin`.

### `.env.example`, `README.md`

`.env.example`: `COMMANDCODE_BIN=` (comentário: só se a detecção automática falhar; caminho do `dist/index.mjs`). README: seção curta "Usar o Command Code" (instalar, `command-code login`, `BACKEND` no settings, modelos em `settings.commandcode.js`).

## Testes

- `test/commandcode.test.js`: `buildRequest` (web: `tools=web_search,web_fetch,search_tools`, `--no-skills`, sem `--yolo`, `--max-turns`; full: `--yolo`, `tools=*`; judge: `tools=`, `--max-turns 1`, `--no-session`; `--mod` aponta para `commandcode/mod.ts`; `systemPrompt=` contém o prompt do modo e o `extraPrompt`; `-m`/`--effort`/`--resume` quando definidos; `stdin` = prompt); `parseResult` (sucesso, `max_turns` → `isError`, `subtype: error` → lança com `error`, `contextTokens` do último `model_request_end`, `numTurns` do `run_end`, sem result → erro); `describeEvent`; `isSessionMissing`; `resolveBin` (env definido; PATH com shim no Windows).
- `test/fake-commandcode.js`: substituto do CLI emitindo o NDJSON acima (ecoa stdin e args no `finalText`, `--resume` vira `sessionId`, `FAKE_FAIL`, `FAKE_MAX_TURNS` → exit 8 com result `max_turns`). `test/commandcode.test.js` roda `run` contra ele: resultado parseado, eventos em `onEvent`, exit 8 vira resultado com `isError`, falha sem result rejeita.
- `test/runner.test.js`: `.mjs` spawna `process.execPath` com o arquivo na frente dos args; `label` nas mensagens.
- `test/backend.test.js`: `selectBackend` para os dois nomes e nome inválido.
- `test/bridge.test.js`: `askClaude` com backend stub estilo commandcode: usa `buildRequest`, fallback de sessão quando `isSessionMissing` responde true, sem fallback quando false; `shouldReply` usa `webDir` em modo full.
- `test/claude.test.js`: sem mudança.
- Verificação manual no fim (script descartável no scratchpad, CLI real, `deepseek/deepseek-v4.1-flash`): `shouldReply` SIM/NAO, `askClaude` web com busca, retomada de sessão, leitura de arquivo bloqueada no modo web, `askClaude` full lendo um arquivo do `WORK_DIR`.

## Verificação (2026-09-17, CLI real, deepseek-v4.1-flash)

Juiz SIM (5,5 s) e NAO (3,5 s); web com duas buscas (17 s, 4 turnos, contexto 10 k tokens); retomada de sessão lembrou o código; pedido de leitura de arquivo no web recusado sem chamar ferramenta; full leu o arquivo do WORK_DIR (glob + read_file, 7 s); sessão salva inexistente caiu no fallback e abriu sessão nova. Suíte: 136 testes.

## Decisões confirmadas (2026-09-17)

1. Backend escolhido no `settings.js` (`BACKEND`).
2. System prompt de verdade via mod, em toda chamada (substitui a ideia de mandar no stdin na primeira rodada e relembrar a cada N).
3. Dois módulos de configuração de modelos: `settings.claude.js` e `settings.commandcode.js`.
4. Juiz sempre no `webDir`, mesmo em modo full.
5. `web_fetch` liberado no web e no full.
6. `deepseek/deepseek-v4.1-flash` nos três por enquanto; juiz mais barato depois.
