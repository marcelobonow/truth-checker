# Design: presença online/offline + comando de status

## Situação atual

- `src/index.js` não define `presence` no `Client`; o Discord já mostra o bot como offline quando o processo cai, mas sem handler de shutdown isso demora (timeout do gateway) em vez de ser imediato.
- Não existe handler de `SIGINT`/`SIGTERM`: hoje o processo só termina abruptamente (ex: Ctrl+C), sem `client.destroy()`.
- Comando existente hoje: `!reset` (`src/index.js:114`), restrito a `isTarget` (whitelist).

## Propostas para confirmar

**1. Presença ao ligar**
Ao conectar (`ClientReady`), setar `client.user.setPresence({ status: 'online' })`. Quer só "online" puro, ou também uma atividade tipo "ouvindo" / "jogando" com texto (ex: "Watching #canal" ou algo customizado)? Se sim, qual texto?

**2. Offline ao desligar**
Adicionar handlers `SIGINT`/`SIGTERM` que chamam `client.destroy()` (isso já derruba a conexão e o Discord marca offline na hora) e então `process.exit(0)`. Confirma esse comportamento (desligar limpo ao Ctrl+C / kill)?

**3. Comando de status**
Nome do comando: `!status` (mesmo padrão do `!reset`)?

**4. Quem pode usar o comando**
Igual ao `!reset` (só `isTarget`, a whitelist), ou qualquer pessoa pode perguntar o status?

**5. Conteúdo da resposta**
O bot já está rodando quando alguém consegue mandar a mensagem (senão não haveria quem respondesse), então a resposta serve mais como confirmação + informação extra. Proposta: `"Online. Rodando há Xh Ym."` (uptime desde o `ClientReady`). Quer incluir mais alguma coisa (ex: quantas sessões ativas, versão)?
