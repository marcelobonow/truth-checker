# Ponte Discord → Claude Code

Bot do Discord que atende uma whitelist de usuários e encaminha as mensagens deles ao
Claude Code em modo headless (`claude -p`), usando o login do plano claude.ai
já feito nesta máquina (sem API key). Design completo em
[docs/superpowers/specs/2026-09-17-discord-claude-bridge-design.md](docs/superpowers/specs/2026-09-17-discord-claude-bridge-design.md).

## Comportamento

- Só mensagens dos usuários em `TARGET_USER_IDS` ([src/users.js](src/users.example.js), ignorado pelo git) ou com um cargo de `TARGET_ROLE_IDS` (`src/settings.js`; sempre modo web), em servidores (DMs e bots ignorados). O cargo vale na hora: dá para liberar alguém sem reiniciar o bot.
- Servidores em `FULL_ACCESS_GUILD_IDS` (`src/settings.js`): Claude com **todas as ferramentas e
  sem pedir permissão** (programação remota no `WORK_DIR`). Qualquer outro
  servidor: só conversa + WebSearch/WebFetch.
- Com `MENTIONS_AND_REPLIES_ONLY = true` em `src/settings.js`, o bot só
  encaminha menções `@bot` (real ou "@Nome" escrito) e replies a mensagens
  dele. Qualquer outra mensagem, inclusive perguntas soltas, é ignorada sem
  juiz, dicionário ou análise de contexto. Com a flag desligada, reply a uma
  mensagem do bot ou menção `@bot` responde sempre. As outras mensagens passam antes por um juiz local, sem
  modelo ([src/heuristic.js](src/heuristic.js)): pontua a mensagem ("?",
  interrogativas, pedidos, termos de [src/dicionario.js](src/dicionario.js))
  mais um bônus do contexto recente, e só chama o modelo se passar dos
  limiares (`JUDGE` em `src/settings.js`; `null` desliga). Reply a outra
  pessoa conta -10 e ignora o "?": só um texto denso no assunto passa. Mesmo
  chamado, o modelo ainda pode decidir ficar em silêncio (responde `NO_REPLY`).
- Imagens: quando alguém da whitelist marca o bot (`@bot`) com uma imagem
  anexada, um link direto de imagem, ou em reply a uma mensagem com imagem, a
  imagem é descrita numa chamada separada do CLI (só ferramenta de leitura, na
  pasta `imagens/`, apagada depois) e a descrição entra no prompt no lugar
  dela. Sem menção explícita, imagens são ignoradas (`IMAGES` em
  `src/settings.js`; modelo em `MODEL.vision` de `settings.<backend>.js`).
- Arquivos: numa menção ao bot ou reply a ele, quem está na whitelist pode
  anexar texto (`.txt`, `.csv`, `.json`, `.md` etc.), Word (`.doc`, `.docx`),
  PDF e OpenDocument Text (`.odt`). O conteúdo é extraído localmente e enviado
  junto ao pedido; limites ficam em `FILES` em `src/settings.js`. PDFs sem
  camada de texto (por exemplo, escaneados) não recebem OCR.
- Menções de quem não está na whitelist são ignoradas (`MENTION_ANYONE = true`
  em `src/settings.js` liga respostas a qualquer menção, em modo web).
- Mensagens em sequência são agrupadas: o bot espera `BATCH_DELAY_MS` (7 s)
  sem novas mensagens e responde ao lote de uma vez. Se o autor manda outra
  mensagem enquanto o lote dele ainda está gerando, a geração é cancelada e
  tudo volta para a espera, para sair uma resposta só.
- Junto com cada lote vão as últimas 10 mensagens do canal e as últimas 5 de
  quem escreveu (dentro das últimas 50), para o Claude entender o assunto
  (`CONTEXT` em `src/settings.js`).
- Quem está na whitelist pode pedir para o bot marcar ou responder outra
  pessoa ("responda ao @fulano sobre X"): a menção precisa ser real (`@` do
  Discord). As últimas 5 mensagens do citado também entram no contexto; o
  Claude escolhe entre responder a uma mensagem dele, só marcá-lo no texto, ou
  nenhum dos dois.
- Uma sessão do Claude por servidor (contexto mantido entre mensagens);
  `/reset` reinicia a sessão daquele servidor. Reinício automático quando a
  sessão passa de 400 mensagens enviadas ao Claude ou fica 1 h sem uso
  (`SESSION` em `src/settings.js`). Com `RESET_ON_START = true` (padrão), reiniciar
  o bot também limpa todas as sessões.
- Modelo por usuário: `/model modelo:<nome>` escolhe o modelo usado nas
  respostas para você, entre os de `MODEL_CHOICES`
  (`src/settings.<backend>.js`; lista vazia desliga os comandos). A escolha fica
  salva em `models.db` (SQLite, sobrevive a reinícios) e vale para os dois
  modos; `modelo:padrão` volta ao modelo das settings. `/model-list` lista quem
  saiu do padrão. Só a whitelist/cargos podem usar (design em
  [docs/model-selector.md](docs/model-selector.md)).

## Requisitos

- Node 22.9+ (testado com 24) e Claude Code instalado e logado (`claude` no PATH),
  ou Command Code (veja [Usar o Command Code](#usar-o-command-code)).
- Bot criado no [Discord Developer Portal](https://discord.com/developers/applications):
  1. **New Application** → aba **Bot** → **Reset Token** → copie o token.
  2. Em **Privileged Gateway Intents**, ligue **Message Content Intent**.
  3. **OAuth2 → URL Generator**: scope `bot`; permissões *View Channels*,
     *Send Messages*, *Read Message History*. Abra a URL gerada para convidar
     o bot a cada servidor.
- IDs: no Discord, *Configurações → Avançado → Modo desenvolvedor*; botão
  direito no usuário/servidor/canal → *Copiar ID*.

## Instalação

```
npm install
copy .env.example .env      # preencha DISCORD_TOKEN (e WORK_DIR)
copy src\users.example.js src\users.js   # TARGET_USER_IDS (fica fora do git)
notepad src\settings.js     # FULL_ACCESS_GUILD_IDS, BACKEND, JUDGE
notepad src\settings.claude.js   # MODEL, EFFORT (settings.commandcode.js para o Command Code)
notepad prompt.web.md       # persona/premissas do modo web; prompt.full.md para o modo full
                            # (prompt.web.commandcode.md vale só para o Command Code)
npm start
```

O processo precisa ficar aberto (terminal, ou o terminal integrado do VSCode).
Cada lote processado consome um turno do plano claude.ai.

## Velocidade e custo

- Em [src/settings.claude.js](src/settings.claude.js): `MODEL.web = 'sonnet'` e
  `EFFORT.web = 'low'` (padrão) deixam o modo web mais rápido e barato;
  `MODEL.full`/`EFFORT.full` fazem o mesmo para o modo full (`null` = padrão
  do CLI).
- O modo web roda sem skills e sem servidores MCP (`--disable-slash-commands`,
  `--strict-mcp-config`): system prompt menor a cada chamada.
- Sessões longas custam mais a cada mensagem (todo o histórico volta ao
  modelo); o reinício automático (`SESSION`) e o `/reset` limitam isso.

## Usar o Command Code

Alternativa ao Claude Code: o [Command Code](https://commandcode.ai) roda os
mesmos prompts com modelos abertos (DeepSeek, Kimi, GLM, Qwen...).

1. `npm i -g command-code` e `command-code login`.
2. `BACKEND = 'commandcode'` em [src/settings.js](src/settings.js); modelos e
   esforço em [src/settings.commandcode.js](src/settings.commandcode.js)
   (ids em `command-code --list-models`).
3. `npm start`. O bot acha o CLI pelo PATH (roda o `dist/index.mjs` do pacote
   pelo node, porque o shim `.cmd` do npm não funciona com `spawn`); se falhar,
   preencha `COMMANDCODE_BIN` no `.env`.

Como o CLI não tem flags de system prompt nem de ferramentas, o bot carrega o
mod [commandcode/mod.ts](commandcode/mod.ts) (`--mod`), que anexa o system
prompt e restringe as ferramentas: modo web roda na pasta vazia
[commandcode/web/](commandcode/web/) só com `web_search`/`web_fetch`; modo
full usa `--yolo` no `WORK_DIR`. Sessões (`--resume`) e reinício
automático funcionam igual. O `/status` não mostra uso do plano (é da API da
Anthropic) e o log fica sem custo estimado.

## Logs

Console legível e arquivo `logs/bot.log` (JSON por linha, via pino). Cada
lote registra: mensagem recebida → espera do lote → "gerando com
deepseek/deepseek-v4.1-flash" (o modelo usado no lote, escolhido ou padrão) →
o que o Claude está fazendo ("procurando na web: …", "executando comando: …")
→ envio ao Discord, com tempo, turnos e custo estimado. `LOG_LEVEL` no `.env`.

## Testes

```
npm test
```

## Segurança

Em servidores com acesso total, quem controlar a conta Discord de qualquer
usuário de `TARGET_USER_IDS` controla esta máquina. Mantenha `FULL_ACCESS_GUILD_IDS` só
com servidores privados.
