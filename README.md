# Ponte Discord → Claude Code

Bot do Discord que atende uma whitelist de usuários e encaminha as mensagens deles ao
Claude Code em modo headless (`claude -p`), usando o login do plano claude.ai
já feito nesta máquina (sem API key). Design completo em
[docs/superpowers/specs/2026-09-17-discord-claude-bridge-design.md](docs/superpowers/specs/2026-09-17-discord-claude-bridge-design.md).

## Comportamento

- Só mensagens dos usuários em `TARGET_USER_IDS` ([src/settings.js](src/settings.js)), em servidores (DMs e bots ignorados).
- Servidores em `FULL_ACCESS_GUILD_IDS` (mesmo arquivo): Claude com **todas as ferramentas e
  sem pedir permissão** (programação remota no `WORK_DIR`). Qualquer outro
  servidor: só conversa + WebSearch/WebFetch.
- Reply a uma mensagem do bot ou menção `@bot` → responde sempre. Outras
  mensagens → o Claude decide se cabe resposta (pergunta ou afirmação que
  contradiz as premissas); senão fica em silêncio.
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
  `!reset` reinicia a sessão daquele servidor. Reinício automático quando a
  sessão passa de 400 mensagens enviadas ao Claude ou fica 1 h sem uso
  (`SESSION` em `src/settings.js`). Com `RESET_ON_START = true` (padrão), reiniciar
  o bot também limpa todas as sessões.

## Requisitos

- Node 22.9+ (testado com 24) e Claude Code instalado e logado (`claude` no PATH).
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
notepad src\settings.js     # TARGET_USER_IDS, FULL_ACCESS_GUILD_IDS, MODEL, EFFORT
notepad prompt.web.md       # persona/premissas do modo web; prompt.full.md para o modo full
npm start
```

O processo precisa ficar aberto (terminal, ou o terminal integrado do VSCode).
Cada lote processado consome um turno do plano claude.ai.

## Velocidade e custo

- Em [src/settings.js](src/settings.js): `MODEL.web = 'sonnet'` e
  `EFFORT.web = 'low'` (padrão) deixam o modo web mais rápido e barato;
  `MODEL.full`/`EFFORT.full` fazem o mesmo para o modo full (`null` = padrão
  do CLI).
- O modo web roda sem skills e sem servidores MCP (`--disable-slash-commands`,
  `--strict-mcp-config`): system prompt menor a cada chamada.
- Sessões longas custam mais a cada mensagem (todo o histórico volta ao
  modelo); o reinício automático (`SESSION`) e o `!reset` limitam isso.

## Logs

Console legível e arquivo `logs/bot.log` (JSON por linha, via pino). Cada
lote registra: mensagem recebida → espera do lote → "gerando com claude" →
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
