# Auditoria (2026-09-18)

Escopo: os commits `02a0dc1`, `86598c6`, `677ef3b` e as mudanças ainda não commitadas (`src/bridge.js`, `src/index.js`, `src/inflight.js`, `src/prompts.js`, testes), mais os arquivos de prompt (`prompt.web.md`, `prompt.web.commandcode.md`, fora do git). Suíte: 148 testes passando.

Já corrigido durante a auditoria: `src/index.js` tinha sido gravado com LF (o repositório usa CRLF nesse arquivo), o que fazia o diff mostrar o arquivo inteiro; restaurado para CRLF. Diff real: 68 linhas inseridas, 16 removidas.

Legenda de prioridade: **A** = corrigir antes de continuar, **B** = vale corrigir, **C** = opcional.

## 1. Lógica de negócio

| # | Pri. | Onde | Achado |
|---|------|------|--------|
| 1.1 | B | `src/index.js:296`, `src/bridge.js:98` | `forced` (reply ao bot ou menção) é calculado duas vezes com a mesma expressão, uma em `processBatch` e outra em `buildUserMessage`. Se um dia mudar o critério num lugar só, o cabeçalho `responder: sempre` e a decisão de pular o juiz divergem. Exportar um `isForced(items)` de `bridge.js` e usar nos dois. |
| 1.2 | B | `src/index.js:225-233` | Depois da trava, o log "autor mandou mensagem nova durante a geração" só sai enquanto a entrada travada ainda é a dona da chave. Quando o lote novo (B) do mesmo autor sai do batcher, `inflight.start` substitui a entrada de A; uma terceira mensagem cancela B (comportamento correto), mas o log não menciona que A continua gerando. Só afeta o log. |
| 1.3 | C | `src/index.js:302-306` | Erro do juiz que não seja `AbortError` sobe para fora de `processBatch` (o `try` só cobre `shouldReply`), vira "rejeição não tratada" e o autor não recebe nada. `shouldReply` já engole falhas do CLI (retorna `reply: true`), então o caso é raro; se quiser cobrir, tratar como o `catch` do `askClaude` (log + `⚠️`). |
| 1.4 | C | `src/index.js:346-349` | Quando o modelo não está na whitelist (`isTarget` falso), a diretiva `[responder: #n]` não é interpretada e vai literal para o Discord se o modelo a escrever mesmo assim. O prompt só ensina a diretiva quando há "pessoas citadas" (só na whitelist), então hoje não acontece; fica como observação. |
| 1.5 | C | `src/prompts.js:25` | O texto do modo web diz "ferramentas de busca na web (WebSearch e WebFetch)", nomes do Claude Code. No Command Code as ferramentas são `web_search`/`web_fetch`. Não quebra nada, mas o DeepSeek recebe nomes que não existem para ele. Trocar por "busca e leitura de páginas na web" ou deixar o backend informar os nomes. |

## 2. Código duplicado ou sem uso

| # | Pri. | Onde | Achado |
|---|------|------|--------|
| 2.1 | B | `src/index.js:438-439`, `src/bridge.js:123` | Dois `preview` diferentes (o do `bridge` põe reticências, o do `index` não). Depois da mudança de log, o `preview` do `index.js` só é usado no erro do backend (`:341`). Exportar o do `bridge.js` e apagar o do `index.js`. |
| 2.2 | B | `src/claude.js:70`, `src/commandcode.js:64` | `parseLine` idêntico nos dois backends. Mover para `runner.js` (que já recebe `parseLine` por parâmetro) como padrão. |
| 2.3 | C | `src/inflight.js:14` | `has(key)` não é mais usado fora dos testes (`index.js` usa `cancel` e `isLocked`). Remover ou manter só se os testes precisarem. |
| 2.4 | C | `src/index.js:288` | `emphasizeQuote: backend.name === 'commandcode'` põe conhecimento de um backend específico no `index.js`. A interface de backend (`backend.js`) já concentra as diferenças; expor algo como `export const smallModel = true` no `commandcode.js` e ler `backend.smallModel` aqui. |
| 2.5 | C | `src/sessions.js:55-58` | Migração do formato antigo de `sessions.json` (valor era só o id). Com `RESET_ON_START = true` o arquivo é apagado a cada início; o código de migração pode sair. |
| 2.6 | C | `src/prompts.js:16`, `prompt.web.md:4`, `prompt.web.commandcode.md:4` | A instrução "evite emdash" aparece no `COMMON_PROMPT` e de novo em cada arquivo de prompt. Deixar só no `COMMON_PROMPT`. |

## 3. Segurança e privacidade

| # | Pri. | Onde | Achado |
|---|------|------|--------|
| 3.1 | A | `src/commandcode.js:28` | O system prompt inteiro vai como um argumento de linha de comando (`--mod-option systemPrompt=...`). Hoje são ~13,8k caracteres; o limite do `CreateProcess` no Windows é 32.767 para a linha inteira, e cada `"` do prompt ainda ganha escape. Com mais posições no `prompt.web.commandcode.md` o spawn passa a falhar sem aviso claro. Além disso, o prompt fica visível no Gerenciador de Tarefas / `wmic process` para qualquer usuário local. Alternativa: o mod ler o prompt de um arquivo (`--mod-option systemPromptFile=<caminho>`) ou de uma variável de ambiente passada no `spawn`. |
| 3.2 | B | `src/index.js:342`, `src/index.js:358` | Em caso de erro, o texto do CLI (`res.text` ou `err.message`, que inclui até 500 caracteres de stderr/stdout) é postado no canal público. Isso pode expor caminho local do projeto, id de sessão, mensagens de cota da conta, detalhes de rede. Postar uma mensagem genérica ("deu erro, tentando de novo mais tarde") e deixar o detalhe só no log. |
| 3.3 | B | `src/index.js:423` | `allowedMentions: { parse: ['users'] }` deixa o texto gerado marcar qualquer usuário do servidor via `<@id>`. O prompt manda marcar só "pessoas citadas", mas uma página lida por `web_fetch` com injeção, ou uma alucinação de id, vira ping em quem não tem nada a ver. Trocar por lista explícita: `users: [...mentions.map((m) => m.id)]` (as pessoas citadas do lote) e manter `repliedUser: true`. |
| 3.4 | B | `src/settings.js:6-21`, `src/settings.js:29` | A mesma lista `TARGET_USER_IDS` (15 pessoas) serve para três coisas: quem o bot atende, quem pode `/reset` e `/status`, e quem ganha modo full (`--dangerously-skip-permissions` / `--yolo`) em qualquer servidor que entrar em `FULL_ACCESS_GUILD_IDS`. Hoje a lista de servidores está vazia, então não há exposição; mas o dia em que um id de servidor for adicionado, 15 contas passam a executar comandos na máquina. Separar `OWNER_IDS` (você) de `TARGET_USER_IDS`, e usar `OWNER_IDS` para full e `/reset`. |
| 3.5 | B | `src/settings.js:6-21` | Ids do Discord com apelido de cada pessoa estão commitados num repositório com remote no GitHub (`marcelobonow/truth-checker`). Se o repositório for público, é uma lista nominal de quem participa do servidor. Mover para `.env` (`TARGET_USER_IDS=id,id,...`) ou para um `settings.local.js` ignorado pelo git, deixando no commit só o exemplo. |
| 3.6 | C | `src/index.js:205`, `src/index.js:208` | Com a mudança de hoje, o log guarda o texto integral de toda mensagem dos canais observados, inclusive de quem não está na whitelist e nunca é respondido (linha "não analisando", nível info). O `logs/` está no `.gitignore`, mas o arquivo cresce sem rotação e vira um histórico completo do canal em disco. Sugestão: manter o texto integral em "mensagem recebida" e nas linhas "decidiu não responder" (que foi o pedido), e voltar o "não analisando" para `preview` ou nível debug; e ligar rotação no `pino/file` ou apagar o log periodicamente. |
| 3.7 | C | `src/commandcode.js:18`, `commandcode/mod.ts` | O modo web do Command Code libera `search_tools`, que carrega ferramentas sob demanda; o mod bloqueia em `beforeToolCall` o que não está na allowlist, então não há brecha. Fica registrado que a segurança do modo web depende desse hook do mod, não do CLI. |

## 4. Performance e custo

| # | Pri. | Onde | Achado |
|---|------|------|--------|
| 4.1 | B | `src/settings.commandcode.js:21` | Com `JUDGE = null`, toda mensagem "se couber" de qualquer um dos 15 usuários vira uma geração completa do DeepSeek (sessão + ferramentas web + prompt de 13,8k) só para ele responder `NO_REPLY`. No log de hoje isso leva 4 a 7 s por mensagem e ocupa a fila serial (a próxima pessoa espera). Um juiz com o mesmo modelo mas `--no-session`, `tools=` e `--max-turns 1` é uma chamada menor e mais rápida que a geração cheia; ou a heurística sem IA que você está fazendo, rodando antes do juiz. |
| 4.2 | B | `src/index.js:40-49` | Os arquivos `prompt.*.md` são lidos uma vez no início. Cada ajuste de prompt exige reiniciar o bot, o que apaga as sessões (`RESET_ON_START`) e derruba gerações em andamento. Reler o arquivo a cada lote (é uma leitura de 11 KB) ou observar mudança com `fs.watch` resolve sem reinício. |
| 4.3 | C | `src/index.js:383-408` | `fetchContext` busca 50 mensagens do canal em toda rodada, inclusive quando o juiz vai dizer NAO. Uma chamada por lote é aceitável; se ligar o juiz, dá para buscar só depois do SIM quando `after` for maior que zero (o juiz precisa do contexto completo, então a economia só existe se o juiz também aceitar contexto reduzido). |
| 4.4 | C | `src/prompts.js`, `prompt.web.*.md` | O system prompt cresceu para ~3,9k tokens e é reenviado em toda chamada (o cache de prompt ajuda no Claude; no DeepSeek depende do provedor). As seções "Meu estilo" e "Exemplos" são as maiores. Não é problema agora; se continuar crescendo, mover as posições longas (evolução, MBL, Bitcoin) para um resumo de uma linha cada, com o texto completo só quando o assunto aparecer. |
| 4.5 | C | `src/index.js:180-185` | Cada `TypingStart` do autor estende a espera do lote em 12 s, sem teto. Uma pessoa que fica digitando adia a resposta indefinidamente. Um teto de, por exemplo, 60 s desde a primeira mensagem do lote evita isso. |

## 5. Prompts (`prompt.web.md`, `prompt.web.commandcode.md`)

| # | Pri. | Onde | Achado |
|---|------|------|--------|
| 5.1 | A | `prompt.web.commandcode.md:12` | A frase "SEMPRE a partir dessas bases: toda resposta sobre outro assunto precisa trazer pelo menos um gancho explícito com libertarianismo ou catolicismo, e a conversa deve caminhar nessa direção" contradiz as linhas 14 e 16 ("não dê muito assunto para isso", "responda de forma mais curta"). O DeepSeek recebe as duas ordens; o comportamento "briguento"/forçando gancho vem em parte daqui. Trocar pelo texto equivalente do prompt do Claude ("quando couber, traga a conversa para essas bases... se o tema não tiver ligação nenhuma, responda curto e siga"). |
| 5.2 | C | `prompt.web.md:7-8`, `src/prompts.js` (`JUDGE_PROMPT`) | O parágrafo "Debate ou conversa" manda responder `NO_REPLY` em comentário/zoeira quando "responder: se couber". No backend Claude o juiz (haiku) recebe o arquivo de prompt anexado, mas a instrução própria dele ("pergunta, pedido ou afirmação que contradiz"; "na dúvida, SIM") não tem essa classe. Pode liberar e o modelo principal dizer `NO_REPLY` (duas chamadas). Incluir no `JUDGE_PROMPT` a regra explícita (comentário sobre o bot, zoeira, elogio → NAO). |
| 5.3 | B | `prompt.web.commandcode.md:28` | O cabeçalho da seção diz "(uma linha por posição...)" e as posições agora são parágrafos de 400 a 900 caracteres. Só texto, mas sinaliza ao modelo um formato que não é o usado. Atualizar o parêntese ou apagar. |
| 5.4 | B | posição anti-MBL (`## Minhas posições`) | O parágrafo afirma fatos sobre pessoas nomeadas (tweets, fotos, declarações) que o bot vai repetir em canal público. Há a instrução final de buscar e linkar fonte; vale manter e, se possível, guardar os links que você já tem no próprio prompt, para o modelo não depender da busca (o DeepSeek achou fontes sem `https://` ontem). |
| 5.5 | B | seção "Meu estilo de escrita", `src/index.js:214`, `src/index.js:390` | O item de emoji diz para reusar `<:nome:id>` quando alguém no contexto usou. Isso não funciona: as mensagens vão ao modelo com `cleanContent`, e o `cleanContent` do discord.js converte `<:nome:id>` em `:nome:` (verificado em `node_modules/discord.js/src/util/Util.js:364-368`). O modelo nunca vê o id, e `:trollface_eanimface:` escrito por um bot não vira emoji no Discord. Correção pequena: em `send()`, trocar `:nome:` por `<:nome:id>` consultando `message.guild.emojis.cache.find((e) => e.name === nome)`; e no prompt tirar a frase sobre `<:nome:id>`. (Corrige também o que eu tinha dito ontem sobre o modelo receber o formato com id.) |
| 5.6 | C | `prompt.web.md`, `prompt.web.commandcode.md` | Os dois arquivos são idênticos de `## Minhas posições` até o fim (cerca de 8 KB duplicados) e já divergiram uma vez por salvamento manual. Alternativa: `index.js` concatenar `prompt.web.<backend>.md` (parte específica) com um `prompt.posicoes.md` compartilhado. |

## 6. Documentação

| # | Pri. | Onde | Achado |
|---|------|------|--------|
| 6.1 | B | `README.md:20-22` | Diz que uma mensagem nova do autor cancela a geração em andamento. Com a trava de hoje, isso só vale enquanto o lote está na fila ou no juiz; depois que o modelo começa a gerar, a mensagem nova vira um lote novo respondido em seguida. Atualizar o parágrafo. |
| 6.2 | C | `docs/superpowers/specs/2026-09-17-cancelar-geracao-design.md` | A spec descreve o comportamento antigo (cancela sempre). Adicionar uma nota sobre `lock` ou uma spec curta da mudança. |
| 6.3 | C | `README.md` | Não menciona que o log guarda o texto integral das mensagens (mudança de hoje) nem o comportamento de "não analisando". Uma linha em "Logs" basta. |

## 7. O que não encontrei problema

- `inflight.lock`: entrada travada não é cancelada, `finish` só remove se ainda for a mesma entrada, lote novo na mesma chave não herda a trava. Coberto por testes.
- `runner.js`: `AbortError` distingue cancelamento de erro; `killTree` no Windows usa `taskkill /T`; timeout rejeita sem esperar `close`.
- `send()`: `@everyone` e cargos nunca são resolvidos (`parse: ['users']`), chunks de 2000 com cerca de código fechada/reaberta.
- Modo web nos dois backends: sem acesso a arquivos ou shell; `cwd` do Command Code é uma pasta vazia para não vazar `git status` e `AGENTS.md`.
- `sessions.json`, `.env`, `logs/` e `prompt*.md` estão no `.gitignore`.
- `hasText` ignora mensagens só com menção/anexo; `mentionsByName` exige `@Nome` colado, com escape do nome.

## 8. Ordem sugerida

1. 3.1 (prompt por arquivo no mod) e 5.1 (frase "SEMPRE" no DeepSeek).
2. 3.2, 3.3, 3.4 (mensagens de erro, allowedMentions, separar OWNER_IDS).
3. 4.1 (juiz ou heurística antes da geração cheia) e 4.2 (reler prompt sem reiniciar).
4. 1.1, 2.1, 2.2 (duplicações) e 6.1 (README).
