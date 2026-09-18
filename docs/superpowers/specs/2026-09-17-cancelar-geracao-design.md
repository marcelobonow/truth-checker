# Cancelar geração quando o autor manda mensagem nova

## Situação hoje

1. Mensagem chega → entra no lote `canal:autor` (`batcher.js`), que espera `BATCH_DELAY_MS` (7 s) sem mensagem nova.
2. Lote fecha → entra na fila serial (`queue.js`) → `processBatch` roda o `claude`.
3. Se o autor manda outra mensagem enquanto o `claude` roda, ela abre um lote novo, que só é processado depois que o atual termina. Resultado: duas respostas, a primeira sem saber da mensagem nova.

## Comportamento desejado

Se o mesmo autor, no mesmo canal, manda mensagem enquanto o lote dele está em geração (ou ainda esperando na fila), a geração é cancelada e as mensagens do lote cancelado voltam para o lote junto com a nova. O temporizador de 7 s recomeça; quando fechar, o Claude recebe tudo de uma vez (mensagens antigas + nova) e responde uma vez só.

## Mudanças

### `claude.js` – `runClaude` cancelável

- `runClaude` recebe `signal` (AbortSignal). Ao abortar: `killTree(child)`, `settled = true`, rejeita com erro `name: 'AbortError'`.
- Mesmo mecanismo do timeout, só muda a origem.

### `bridge.js` – `askClaude`

- Repassa `signal` ao runner. Se o erro é `AbortError`, relança sem tentar o fallback de sessão.

### `index.js` – controle por chave

- Mapa `running: Map<key, { items, controller }>` com a mesma chave do lote (`canal:autor`). Entrada criada quando o lote sai do batcher (`onFlush`), antes de entrar na fila; removida quando `processBatch` termina (sucesso, erro ou cancelamento).
- Em `MessageCreate`, antes de `batcher.add`: se `running.has(key)`, chama `controller.abort()`, remove a entrada e faz `batcher.add` de cada item antigo (na ordem original) e depois do novo. Log: `geração cancelada: autor mandou mensagem nova (N mensagens voltam ao lote)`.
- `processBatch` checa `signal.aborted` ao começar (lote cancelado enquanto esperava na fila): retorna sem fazer nada. Se o abort acontece durante `askClaude`, o `AbortError` é capturado e só logado (não manda `⚠️` no Discord).
- O "digitando" para no `finally`, como hoje.

### Testes

- `claude.test.js`: abortar mata o processo e rejeita com `AbortError`.
- `bridge.test.js`: `AbortError` não dispara fallback de sessão.
- `inflight.test.js`: `start/cancel/finish` (cancelar aborta e devolve os itens; finish limpa; cancel sem entrada retorna null).

## Propostas para confirmar

1. **Cancelar também lote que ainda está na fila** (não começou a rodar porque outro `claude` está em execução). Proposta: sim, mesmo tratamento.
2. **Só o próprio autor cancela.** Mensagem de outra pessoa no mesmo canal não interfere. Proposta: sim (chave `canal:autor`, igual ao lote).
3. **Depois que a resposta começou a ser enviada ao Discord** (já saiu do `claude`), não cancela mais. Proposta: sim; a mensagem nova vira lote normal.
4. **Sem aviso no Discord** ao cancelar, só log. Proposta: sim.
5. **Resposta parcial já gerada é descartada.** Proposta: sim.

Decidido: lógica em módulo novo `src/inflight.js` (mapa chave → {items, controller}, com `start/finish/cancel`) com teste.
