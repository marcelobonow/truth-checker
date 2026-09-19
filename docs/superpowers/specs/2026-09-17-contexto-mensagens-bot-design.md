# Design: incluir mensagens do bot no contexto + timestamp

## Situação atual (confirmado no código)

- `src/index.js:240-262` `fetchContext` busca até `CONTEXT.fetch` (50) mensagens brutas do canal e chama `selectContext`.
- `src/bridge.js:31-39` `selectContext(history, { channel, author, authorId, authorIds, excludeIds })`:
  - pega as últimas `CONTEXT.channel` (10) mensagens do canal, sem filtro de autor;
  - pega as últimas `CONTEXT.author` (5) mensagens de cada id em `authorIds` (quem triggou + mencionados);
  - `authorIds` **nunca inclui o ID do próprio bot** (`src/index.js:174`).
- Resultado: as respostas do bot só aparecem se calharem de estar entre as últimas 10 do canal — não há garantia, e não há bucket dedicado tipo "últimas N respostas do bot".
- `src/bridge.js:45-60` `buildUserMessage` serializa cada linha como `- authorName: content` (ou `- #N authorName: content`). **Não existe timestamp na linha.**

## Propostas para confirmar

**1. Incluir garantidamente as últimas mensagens do próprio bot no contexto**
Opção A: adicionar o ID do bot em `authorIds` passado para `selectContext`, reaproveitando o bucket "últimas `CONTEXT.author` por autor" (hoje 5) — ou seja, o bot ganharia sua própria cota de últimas 5 mensagens, igual a um autor mencionado.
Opção B: criar uma constante separada tipo `CONTEXT.bot` (pode ter valor diferente de `author`, ex: 5) e um bucket dedicado só para o bot.

Qual prefere: A (reusa `author`) ou B (config própria)?

**2. Quantas mensagens do bot manter**
Se opção B, qual valor (ex: 5, igual ao author)?

**3. Adicionar timestamp na linha do contexto**
Formato proposto: `- [HH:mm] authorName: content` (hora local, sem data, já que é "contexto recente"). Confirma esse formato ou prefere outro (ex: incluir data também, ou timestamp relativo tipo "há 3 min")?

**4. Timestamp só no contexto ou também no corpo da mensagem nova (`body`)?**
Entendo que só as linhas de `contexto recente` precisam de timestamp (para diferenciar do que é "conversa atual"). O `body` (mensagens novas que disparam o bot) fica sem timestamp, correto?
