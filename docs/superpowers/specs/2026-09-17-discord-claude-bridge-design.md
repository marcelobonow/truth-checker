# Ponte Discord → Claude Code (plano de assinatura) — Design

Data: 2026-09-17 · Status: aprovado (v9 — prompts por modo)

## 1. Objetivo

Bot do Discord (conta de bot tradicional) que fica em um ou mais servidores,
lê as mensagens e atende **uma whitelist de usuários** (`TARGET_USER_IDS` em
`src/settings.js`, junto com `FULL_ACCESS_GUILD_IDS`, `MODEL` e `EFFORT`). As mensagens
desses usuários são enviadas ao Claude Code em modo headless (`claude -p`), que
usa o login do plano claude.ai já feito na máquina — sem API key.

## 2. Quando o bot responde

Mensagens de bots e DMs são ignoradas. Só canais em `WATCH_CHANNEL_IDS`
(vazio = todos). Dentro disso:

| Quem | Situação | Comportamento |
|---|---|---|
| Usuário da whitelist | reply a uma mensagem do bot, ou menciona `@bot` | Responde **sempre** |
| Usuário da whitelist | texto `!reset` | Apaga a sessão do servidor e responde "Sessão reiniciada" (imediato, fora do lote) |
| Usuário da whitelist | qualquer outra mensagem (inclusive reply a outra pessoa, que entra como citação) | **Claude julga**: responde se for pergunta ou afirmação que contradiz as premissas; senão silêncio |
| Qualquer outra pessoa | menciona `@bot` (só com `MENTION_ANYONE = true` em `settings.js`; padrão `false`) | Responde sempre, **sempre em modo `web`**, numa sessão pública por servidor separada da dos usuários da whitelist |
| Qualquer outra pessoa | resto | Ignorado |

**Lote (debounce).** Mensagens não são processadas uma a uma: cada mensagem
(re)inicia um temporizador por `canal + autor`; quando passam
`BATCH_DELAY_MS` (padrão 7000) sem nova mensagem, todas as acumuladas vão
juntas ao Claude numa única execução e recebem uma única resposta (reply à
última mensagem do lote). Se qualquer mensagem do lote for reply ao bot ou
menção, o lote inteiro é "responde sempre". Mensagens que chegam enquanto um
lote está rodando formam o lote seguinte.

**Julgamento.** O lote vai ao Claude na sessão do servidor (ele mantém o
contexto de tudo que foi dito, mesmo do que não respondeu). O system prompt
instrui: "se não couber resposta, responda exatamente `NO_REPLY`, sem usar
ferramentas". O bot detecta o sentinela e não posta nada (só registra no log).
Uma execução do `claude` por lote, sem chamada extra de classificação.

Indicador "digitando…" só enquanto o lote está sendo executado pelo Claude
(não durante a espera do lote).

Cada lote consome um turno do plano.

## 3. Modos por servidor

| Servidor (guild) | Modo | Flags do `claude -p` | cwd |
|---|---|---|---|
| ID em `FULL_ACCESS_GUILD_IDS` | `full` — acesso à máquina (programar remotamente) | `--dangerously-skip-permissions` (todas as ferramentas) | `WORK_DIR` |
| Qualquer outro | `web` — só conversa + busca na web | `--tools WebSearch,WebFetch --allowedTools WebSearch,WebFetch --strict-mcp-config --disable-slash-commands` | diretório do bot |

Quem não está na whitelist usa sempre `web`. Ambos usam
`--output-format stream-json --verbose` e `--append-system-prompt` com o texto do modo, mais
`--model`/`--effort` por modo quando configurados (`MODEL`/`EFFORT` em
`src/settings.js`; web usa esforço `low` por padrão). O modo web não carrega
skills nem servidores MCP da configuração global (menos tokens por chamada e
nada da máquina exposto a quem só menciona o bot).
Sessões (`--resume`) persistidas em `sessions.json`: chave `<guildId>`,
compartilhada pelos usuários da whitelist (o cabeçalho identifica o autor), e
`<guildId>:public` para as demais pessoas. Cada entrada guarda `{ id,
messages, lastUsed }`; `messages` acumula tudo que já foi enviado ao Claude
naquela sessão (mensagens do lote + do contexto).

**Reinício automático** (`SESSION` em `src/settings.js`): antes de cada lote,
se `messages >= maxMessages` (400) ou a sessão estiver há mais de
`idleMinutes` (60) sem uso, o bot descarta a sessão e começa outra (log
"sessão reiniciada automaticamente (mensagens|inatividade)"). Como o lote leva
o contexto recente do canal, a perda é pequena. O auto-compact do próprio
Claude Code continua valendo dentro de uma sessão. `RESET_ON_START` (padrão
`true`) apaga todas as sessões salvas ao iniciar o bot.

## 4. O que o Claude recebe

System prompt (`--append-system-prompt`), fixo por modo:

- contexto: "você responde via Discord", pt-BR, Markdown do Discord,
  respostas curtas (< 2000 chars), o usuário não vê o terminal;
- capacidades do modo (`web`: só WebSearch/WebFetch, sem arquivos/comandos;
  `full`: acesso total em `WORK_DIR`, o usuário está programando remotamente);
- formato do cabeçalho de metadados (abaixo) e regra de julgamento:
  `responder: sempre` → responde; `responder: se couber` → só pergunta ou
  afirmação que contradiz as premissas, senão `NO_REPLY` sem usar ferramentas;
- conteúdo de `prompt.web.md` / `prompt.full.md` (fallback `prompt.md`),
  anexado ao final: persona, tom, tamanho, temas e premissas do modo. O
  `COMMON_PROMPT` do código fica só com a estrutura (cabeçalho, contexto,
  regra `NO_REPLY`); tom e formatação vêm do arquivo do modo.

Mensagem (stdin): cabeçalho + contexto recente do canal + as mensagens do
lote (uma por linha quando há mais de uma; citação entre parênteses quando
for reply a outra pessoa):

```
[discord] servidor: Meu Server | canal: #geral | autor: marcelo | responder: se couber
contexto recente do canal (mais antigo primeiro):
- joao: alguém viu se saiu o node 24 LTS?
- marcelo: ainda não olhei
mensagens novas:
1. alguém sabe se o node 24 já é LTS?
2. (em resposta a joao: "acho que é") não, ainda não é
```

Contexto recente (`CONTEXT` em `src/settings.js`): busca as últimas
`fetch` (50) mensagens do canal antes do lote; inclui as últimas `channel`
(10) e, dentro das mesmas 50, as últimas `author` (5) de quem escreveu (se
tiver menos, entra o que houver). União sem duplicar, ordem cronológica,
cada mensagem truncada em 200 chars, mensagens do próprio lote e vazias fora.
Se a leitura do histórico falhar, segue sem contexto.

Menções aparecem como `@nome` (`cleanContent` do discord.js).

## 5. Fluxo

1. `messageCreate` → filtro (§2). `!reset` do usuário-alvo entra na fila
   serial (assim uma execução em andamento não salva o `session_id` antigo por
   cima do reset).
2. Resolve: é reply ao bot? (busca a mensagem referenciada e compara o autor
   com o bot) menciona o bot? citação (reply a outra pessoa)?
3. `batcher.add(chave = canal + autor, item)` → (re)inicia o temporizador.
4. Temporizador dispara → `queue.add(lote)` (fila serial global: um `claude`
   por vez).
5. Lote começa a rodar: liga "digitando…" (renovado a cada 8 s e a cada
   atividade do Claude).
6. Monta o texto (§4). `runClaude`: `spawn` sem shell; prompt por stdin;
   `--resume <id>` se houver sessão salva para a chave. O stdout é NDJSON
   (`stream-json`): cada evento é entregue a `onEvent` conforme chega;
   `describeEvent` traduz `tool_use` em atividade ("procurando na web: …",
   "lendo página: …", "executando comando: …", "lendo/editando arquivo: …",
   "usando ferramenta X"), texto em "gerando resposta" e `rate_limit_event`
   fora de `allowed` em "limite de uso: …". Cada atividade vira log e renova o
   "digitando" na hora.
7. Evento `result`: `result`, `session_id`, `is_error`, `subtype`,
   `num_turns`, `total_cost_usd`. Salva o `session_id`.
8. Retomada falhou (stderr `No conversation found with session ID`)? Apaga a
   sessão salva e repete uma vez sem `--resume`.
9. `NO_REPLY` → não posta (log). Senão, reply à última mensagem do lote
   (se ela foi apagada, envia no canal), dividido em blocos ≤ 2000 chars
   (cercas de código fechadas/reabertas; ```` ```x``` ```` numa linha só é
   inline, não cerca), sem permitir menção a @everyone/cargos no texto gerado.
10. Timeout (`CLAUDE_TIMEOUT_MS`, padrão 10 min) rejeita na hora e mata a
    árvore de processos (`taskkill /T /F` no Windows) → responde com erro
    curto. Exit ≠ 0 / `is_error` → idem.

## 6. Configuração

Em `src/settings.js` (editado à mão): `TARGET_USER_IDS` (usuários atendidos),
`FULL_ACCESS_GUILD_IDS` (servidores com acesso total), `MENTION_ANYONE`
(padrão `false`), `MODEL` e `EFFORT`
(por modo; `null` = padrão do CLI). O restante no `.env`:

| Variável | Uso |
|---|---|
| `DISCORD_TOKEN` | token do bot |
| `WATCH_CHANNEL_IDS` | opcional; canais analisados (vazio = todos) |
| `BATCH_DELAY_MS` | espera sem novas mensagens antes de processar o lote (padrão `7000`) |
| `WORK_DIR` | cwd do modo `full` (padrão: pasta do bot) |
| `CLAUDE_BIN` | executável (padrão `claude`) |
| `CLAUDE_TIMEOUT_MS` | padrão `600000` |

Discord: intents `Guilds`, `GuildMessages`, `MessageContent` (privilegiada,
ligar no portal); permissões do convite: View Channels, Send Messages, Read
Message History.

## 7. Arquivos e estado

| Arquivo | Papel | Estado |
|---|---|---|
| `src/split.js` | `splitMessage(text, limit)` | feito, 9 testes |
| `src/sessions.js` | store `{ id, messages, lastUsed }` por chave em `sessions.json` (lê o formato antigo) | feito, 8 testes |
| `src/queue.js` | fila serial | feito, 3 testes |
| `src/claude.js` | `buildArgs`, `parseResult` (NDJSON), `describeEvent`, `runClaude` (eventos por linha) | feito, 22 testes |
| `src/batcher.js` | `createBatcher({ delayMs, onFlush })` — debounce por chave; `add` devolve o tamanho do lote | feito, 5 testes |
| `src/bridge.js` | `resolveMode`, `shouldHandle`, `sessionKey`, `selectContext`, `buildUserMessage` (§4), `isNoReply`, `sessionResetReason`, `askClaude` (sessão + fallback + `onEvent` + contagem) | feito, 27 testes |
| `src/settings.js` | `TARGET_USER_IDS`, `FULL_ACCESS_GUILD_IDS`, `MODEL`, `EFFORT`, `CONTEXT`, `SESSION` (editado pelo usuário) | feito |
| `src/logger.js` | pino → console (pretty) + `logs/bot.log` | feito |
| `src/index.js` | cliente Discord, reply/menção/citação, `!reset`, lote → fila, typing, envio; encerra se o login falhar | feito (sem teste automatizado) |
| `README.md`, `.env.example`, `prompt.web.md`, `prompt.full.md` | setup, `.env`, prompts por modo | feito |

Verificação ponta a ponta feita em 2026-09-17 com o `claude` real (modo web):
afirmação → `NO_REPLY`; reply ao bot na mesma sessão → resposta usando o
contexto anterior, mesmo `session_id`. A parte do Discord só foi validada
até o login (config lida, token inválido encerra o processo).

Logs (`src/logger.js`, pino): console legível via `pino-pretty` e
`logs/bot.log` em JSON por linha; `LOG_LEVEL` no `.env` (padrão `info`).
Linhas por lote: mensagem recebida → "esperando Ns … (k na espera)" →
"gerando com claude" (modo, mensagens, contexto, sessão) → "claude: <atividade>"
→ "enviando para o discord" / "claude decidiu não responder" / erro, com
segundos, turnos e custo estimado.

Testes: `npm test` (`node --test "test/*.test.js"`, sem framework). `runClaude` é testado com um `claude`
falso (`test/fake-claude.js`); a parte do Discord não tem teste automatizado.

## 8. Segurança e custo

- Em servidores whitelisted o Claude roda sem verificação de permissões: quem
  controlar a conta Discord de qualquer usuário de `TARGET_USER_IDS` controla a
  máquina.
- No modo `full`, o julgamento "não use ferramentas antes de decidir" é uma
  instrução de prompt, não um bloqueio técnico.
- Cada mensagem analisada gasta cota do plano claude.ai.

## 9. Decisões tomadas

1. Menção `@bot` força resposta; vale para qualquer pessoa (`MENTION_ANYONE`),
   e quem não é o usuário-alvo fica sempre em modo `web` com sessão pública.
2. `prompt.md`: texto curto com premissas, anexado ao system prompt.
3. "Digitando…" só durante a execução do lote. Lote por `canal + autor` com
   `BATCH_DELAY_MS` de silêncio (padrão 7 s).
4. Reply do usuário-alvo a outra pessoa: vira citação e segue o julgamento.
   Reply ao bot: responde sempre.

## 10. Revisão de código (2026-09-17)

Achados do `/code-review` corrigidos: regex de sessão inválida amplo demais
(casava `session_id` no JSON de erro e apagava a sessão); `!reset` fora da
fila (desfeito por execução em andamento); linha ```` ```x``` ```` tratada
como cerca; timeout que esperava `close` (pipe seguro por processo-neto
travava a fila); `reply` a mensagem apagada perdia a resposta; servidores MCP
globais acessíveis no modo web.

Segunda passada (mesmo dia), também corrigida: `fetchReference` antes de
entrar no lote podia inverter a ordem das mensagens (agora entra no lote na
hora e a referência é aguardada no processamento); detecção de sessão
inválida olhava só a mensagem truncada do erro (agora usa o stderr completo,
anexado ao erro por `runClaude`); falha ao gravar `sessions.json` derrubava a
resposta pronta (o store mantém em memória e só registra a falha).

## 11. Fora de escopo (v1)

Anexos/imagens, DMs, vários usuários, troca de diretório via Discord, limite
de turnos, execução como serviço/inicialização automática.
