# Ponte Discord → assistentes CLI

Bot do Discord que atende uma whitelist de usuários e encaminha as mensagens
deles a um CLI de IA em modo headless. Escolha Claude Code, Command Code ou
Codex em `src/settings.js`. Design original em
[docs/superpowers/specs/2026-09-17-discord-claude-bridge-design.md](docs/superpowers/specs/2026-09-17-discord-claude-bridge-design.md).

## Comportamento

- Só mensagens dos usuários em `TARGET_USER_IDS` ([src/users.js](src/users.example.js), ignorado pelo git) ou com um cargo de `TARGET_ROLE_IDS` (`src/settings.js`; sempre modo web), em servidores (DMs e bots ignorados). O cargo vale na hora: dá para liberar alguém sem reiniciar o bot.
- Servidores em `FULL_ACCESS_GUILD_IDS` (`src/settings.js`): backend ativo com
  acesso completo no `WORK_DIR`. Qualquer outro servidor fica no modo web, sem
  ferramentas locais.
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
- `/id usuario:<usuário>` ou `/id cargo:<cargo>` mostra o ID selecionado em uma
  resposta privada. É restrito à mesma whitelist de usuários e cargos.
- Modelo por usuário: `/model modelo:<nome>` escolhe o modelo usado nas
  respostas para você, entre os de `MODEL_CHOICES`
  (`src/settings.<backend>.js`; lista vazia desliga os comandos). A escolha fica
  salva em `models.db` (SQLite, sobrevive a reinícios) e vale para os dois
  modos; `modelo:padrão` volta ao modelo padrão global. `/model-list` lista quem
  saiu do padrão. Só a whitelist/cargos podem usar (design em
  [docs/model-selector.md](docs/model-selector.md)).
- Padrão global: `/model-default modelo:<nome>` altera o modelo e esforço usados
  por quem está no padrão, nos modos web e full, em todos os servidores. Só a
  conta definida em `ADMIN_USER_ID` pode usar, mesmo fora da whitelist. A lista
  é a mesma do `/model`. A escolha fica em `models.db`, separada por backend,
  e é carregada em memória ao iniciar; sobrevive a reinícios e ao
  `RESET_ON_START`. A alteração vale para as próximas gerações e preserva as
  preferências individuais. Se o padrão sair da lista, o bot salva uma opção
  disponível ao iniciar e registra um aviso no log.
- Prompt por usuário: `/prompt` abre um editor com o texto atual preenchido.
  Salve até 2000 caracteres para orientar as respostas a você nos modos web e
  full; apague o texto e envie para remover o prompt. Os prompts ficam
  em `user-prompts.db` (SQLite); os comandos usam a mesma whitelist/cargos de
  `/model`. `/prompt-list` mostra os prompts completos em uma resposta privada
  no canal; se a lista ultrapassar 2000 caracteres, envia no privado de quem
  executou o comando. Ao mudar ou remover o prompt, a próxima resposta inicia
  uma nova sessão no servidor para deixar a preferência anterior fora do histórico.

## Análise diária de conversas

`/analise-conversas` prepara um arquivo JSONL com o dia selecionado e o
contexto dos dias vizinhos. A IA recebe o caminho absoluto, a quantidade de
eventos e o tamanho da fonte. Ela consulta o arquivo conforme necessário e
entrega uma única análise, sem chamadas por bloco nem consolidação de
checkpoints. Claude usa `Read`; Command Code usa `read_file`; Codex usa
comandos de leitura em sandbox somente leitura.
As análises usam uma fila própria: uma análise em andamento não impede o bot
de responder às menções e replies no Discord.

As citações são verificadas contra a fonte antes de gerar a memória. Quando
a resposta precisa de correção, ela é disponibilizada em um segundo arquivo
para até dois reparos, sem pedir uma nova análise inteira. O agendador mantém
um orçamento total de chamadas e o timeout do backend; leituras feitas pela
IA dentro de uma execução não são blocos do agendador. Claude e Command Code
permitem até 80 turnos por execução para leitura e consultas.

Após alterar a implementação, reinicie o processo do bot para carregar o
fluxo novo. Uma análise que terminou com erro pode ser solicitada novamente
com `/analise-conversas` para o mesmo canal e dia.

## Requisitos

- Node 22.9+ (testado com 24) e o CLI escolhido instalado e autenticado:
  Claude Code (`claude`), Command Code ou Codex (`codex`) no PATH.
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
notepad src\settings.js          # FULL_ACCESS_GUILD_IDS, BACKEND, JUDGE
notepad src\settings.codex.js   # MODEL, EFFORT se usar Codex
notepad prompt.web.md            # persona/premissas do modo web; prompt.full.md para full
                                 # prompt.web.codex.md vale para o backend Codex
npm start
```

O processo precisa ficar aberto (terminal, ou o terminal integrado do VSCode).
O uso e os limites dependem da conta e do backend selecionado.
Também é possível iniciar com `node src/index.js`: o bot carrega o `.env`
da raiz do projeto antes de ler as configurações.

## Velocidade e custo

- Use `/model-default` para escolher o modelo e esforço padrão de respostas;
  as opções disponíveis ficam em `MODEL_CHOICES` de `src/settings.<backend>.js`.
  Os modelos auxiliares de visão e análise continuam configurados nas settings.
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
automático funcionam igual. `/status` mostra uso atual das janelas de 5 horas,
semana e mês; os mesmos valores seguem no contexto de cada resposta. A consulta
usa a sessão autenticada do Command Code em `~/.commandcode/auth.json` e as
rotas internas que o CLI usa para exibir `/usage`; elas não são uma API pública
documentada e podem mudar. Se a consulta falhar, o bot continua respondendo e
marca o uso como indisponível. O log fica sem custo estimado.

## Usar o Codex

1. Instale o Codex CLI e autentique com `codex login`; o comando `codex` precisa
   estar no PATH (ou configure `CODEX_BIN` no `.env`).
2. Selecione `BACKEND = 'codex'` em [src/settings.js](src/settings.js). O
   a lista `/model` fica em [src/settings.codex.js](src/settings.codex.js)
   e o padrão global é alterado por `/model-default`;
   GPT-6 Luna é a única opção.
3. O bot lê `CODEX_BIN` do `.env` (padrão `codex`) e usa
   [prompt.web.codex.md](prompt.web.codex.md), baseado no prompt do Command Code.

O modo web usa `codex exec --json`, busca web e sandbox somente de leitura, sem
shell local. O prompt específico é uma cópia inicial do
[prompt do Command Code](prompt.web.commandcode.md), para manter a mesma persona
e as mesmas posições do DeepSeek. O modo full, disponível apenas nos servidores em
`FULL_ACCESS_GUILD_IDS`, executa sem sandbox no `WORK_DIR`. Imagens são anexadas
diretamente à chamada de visão. Sessões podem ser retomadas entre mensagens e
as métricas registram tokens e buscas web.

## Logs

Console legível e arquivos `logs/bot.AAAA-MM-DD.N.log` (JSON por linha, via
pino-roll), com rotação diária. Cada lote registra: mensagem recebida → espera do lote → modelo usado no lote →
atividade do backend ("pesquisando na web: …", "executando comando: …")
→ envio ao Discord, com tempo, turnos e custo estimado. `LOG_LEVEL` no `.env`.

## Testes

```
npm test
```

## Segurança

Em servidores com acesso total, quem controlar a conta Discord de qualquer
usuário de `TARGET_USER_IDS` controla esta máquina. Mantenha `FULL_ACCESS_GUILD_IDS` só
com servidores privados.
