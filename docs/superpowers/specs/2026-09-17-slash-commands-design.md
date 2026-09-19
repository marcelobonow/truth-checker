# Design: `!reset` e `!status` viram slash commands (`/`)

## Situação atual

- `!reset` e `!status` são texto puro (`message.content.trim() === '!reset'`), restritos a `isTarget` (whitelist em `TARGET_USER_IDS`).
- Slash commands são um mecanismo separado do Discord: precisam ser **registrados** (`client.application.commands.set([...])`, ou por servidor com `guild.commands.set([...])`) e **respondidos** via evento `InteractionCreate` (`interaction.reply(...)`), não `message.reply`.
- Registro **global** demora até ~1h pra propagar depois de mudar; registro **por servidor** aparece na hora, mas exige listar os servidores onde o bot está.
- O Discord não tem um jeito nativo de restringir um slash command a uma lista fixa de IDs de usuário (só a cargos/permissões). Pra manter a mesma whitelist de hoje, o handler do comando teria que checar `interaction.user.id` e responder "sem permissão" pra quem não estiver na lista — igual à lógica atual, só que dentro do handler de interação.

## Propostas para confirmar

**1. Escopo do registro**
Global (funciona em qualquer servidor onde o bot está, mas demora até 1h pra aparecer depois de criar/mudar) ou por servidor (aparece na hora, registrado em cada guild que o bot conhece ao conectar)? Como o bot já opera em um conjunto fixo e pequeno de servidores, por servidor parece mais prático para testar — confirma?

**2. Quem pode usar**
Mantém a mesma whitelist (`TARGET_USER_IDS`)? Quem não estiver nela recebe algo como "Sem permissão." (não aparece pra eles no autocomplete de qualquer forma? na real o Discord lista o comando pra todo mundo a menos que se configure "default member permissions" — então a checagem dentro do handler continua necessária).

**3. Nomes**
`/reset` e `/status`, mantendo os nomes atuais?

**4. Visibilidade da resposta**
`ephemeral: true` (só quem executou o comando vê a resposta) ou pública no canal (todo mundo vê, como hoje)?

**5. Comandos de texto antigos (`!reset`, `!status`)**
Removo depois que os slash commands estiverem funcionando, ou mantenho os dois formatos funcionando em paralelo?
