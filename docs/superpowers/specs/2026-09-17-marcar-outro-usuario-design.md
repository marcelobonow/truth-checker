# Marcar / responder outro usuário a pedido

## Objetivo

O usuário pede algo como "Responda ao @fulano onde Marx fala da cristalização do valor na mercadoria pelo trabalho". O bot:

- se o @fulano tem mensagem recente no canal ligada ao assunto, responde (reply do Discord) a essa mensagem;
- senão, manda a resposta como hoje (reply a quem pediu) com `@fulano` marcado no texto.

Quem decide entre os dois é o Claude, com base no contexto que recebe.

## Situação hoje

- `item.content` usa `cleanContent`: a menção `<@123>` vira `@Nome`; o Claude vê o nome mas não tem o id, e não consegue marcar ninguém.
- O contexto do canal vai como `- Nome: texto`, sem id de mensagem; o Claude não tem como apontar "essa mensagem aqui".
- `send()` sempre responde à última mensagem do lote. `allowedMentions.parse: ['users']` já deixa `<@id>` no texto gerado virar marcação.

## Mudanças

### 1. Pessoas citadas no lote (`index.js` → `bridge.js`)

- Em `MessageCreate`, o item guarda `mentions: [{ id, name }]` com `message.mentions.users` (menos o próprio bot).
- `buildUserMessage` recebe `mentions` (união dos itens, sem repetir) e, quando houver, adiciona uma linha depois do cabeçalho:

  ```
  pessoas citadas: Fulano → <@111>, Beltrana → <@222>
  ```

### 2. Contexto com identificador de mensagem (`bridge.js`)

- Cada linha do contexto ganha índice curto: `- #3 Fulano: texto`. O bot guarda o mapa `#n → message.id`; o Claude só vê `#n`.
- Quando o lote cita alguém, o contexto garante as últimas `CONTEXT.author` mensagens dessa pessoa (mesma janela de `CONTEXT.fetch`), além da seleção atual. `selectContext` recebe `authorIds` (autor do lote + citados) em vez de `authorId`.

### 3. Diretiva de resposta na saída do Claude (`claude.js` / `bridge.js`)

- Se o Claude quer responder a uma mensagem do contexto, começa a resposta com uma linha `[responder: #3]`. O bot tira essa linha e faz reply na mensagem `#3` (o reply do Discord já marca o autor dela; o Claude não repete `<@id>` no texto).
- Se quer só marcar, escreve `<@111>` no texto, sem diretiva. Reply continua indo para quem pediu.
- `parseDirective(text) → { replyTo: '#3' | null, text }`, função pura com teste.

### 4. System prompt (`claude.js`, `COMMON_PROMPT`)

Acrescentar:

- explicação de `pessoas citadas` e de `#n` no contexto;
- regra: pedido para responder/marcar alguém → se há mensagem `#n` dessa pessoa no contexto relacionada ao assunto, use `[responder: #n]` na primeira linha; senão, marque com `<@id>` no texto;
- nunca marcar quem não estiver em `pessoas citadas`.

### 5. Envio (`index.js` → `send`)

- `send(message, text, { replyTo })`: se `replyTo` resolve para um id, `channel.messages.fetch(id)` e `.reply(...)` nela; se falhar (apagada/inacessível), cai no comportamento atual (reply a quem pediu) e loga.
- Blocos seguintes (`splitMessage`) continuam indo por `channel.send`.

### 6. Quem pode usar

- Só lotes de usuários da whitelist (`TARGET_USER_IDS`) recebem `pessoas citadas`, índices `#n` e têm `[responder: #n]` interpretado. Lotes de terceiros (`MENTION_ANYONE`) seguem como hoje, sem nada disso.

### Testes

- `bridge.test.js`: `buildUserMessage` com citados; `selectContext` com vários `authorIds`; `parseDirective`.
- `split.test.js`: sem mudança.
- `index.js` continua sem teste (só cola).

## Decisões (2026-09-17)

1. Só menção real (`<@id>`) identifica o outro usuário.
2. O Claude decide: responder a uma mensagem `#n`, só marcar, ou nenhum dos dois.
3. Só a whitelist dispara esse comportamento; lotes de terceiros não recebem citados nem índices.
4. Sem aviso no Discord ao falhar; só log.
5. Reply na mensagem do outro já marca ele; se o Claude também escrever `<@id>`, tudo bem (duplicar é aceitável).
6. `#n` apagada ou inválida: reply normal a quem pediu.
