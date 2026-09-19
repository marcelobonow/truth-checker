# Design: juiz heurístico local (substitui o haiku)

> Implementado em 2026-09-17: `src/heuristic.js` + `src/dicionario.js`, ligado em `index.js` (`JUDGE` em `settings.js`, independente do backend). O juiz por modelo (`shouldReply`, `buildJudgeArgs`, `JUDGE_PROMPT`, `kind: 'judge'` nos backends) foi removido. Bug corrigido na implementação: `compileTerm` normalizava o termo antes de separar `*`/`%`, e os marcadores sumiam.

## Objetivo

Decidir na CPU, sem chamada a modelo, se uma mensagem que não é reply nem menção ao bot merece resposta. Entrada: as mensagens novas do lote + o contexto completo (10 do canal + 5 do autor + 5 do bot + citados), com timestamps. Saída: pontuação e a lista do que pontuou (para o log e para calibrar o limiar).

## O que a pesquisa mostrou

- Detecção de pergunta sem ML é feita com regras: `?`, palavras interrogativas no início ou no corpo (quem/o que/como/por que/qual/quando/onde/quanto), e fórmulas de pedido ("alguém sabe", "me explica"). Falsos positivos conhecidos: interrogativa usada como ênfase ("olha como ele fala") e `?` retórico.
- Classificadores locais em JS (Naive Bayes: `nbayes`, `bayes`, `wink-naive-bayes-text-classifier`) exigem corpus rotulado de treino; sem isso, o que funciona é dicionário ponderado + regras. `natural` tem `PorterStemmerPt`, mas a vantagem sobre prefixo (`econom*`) é pequena para o nosso vocabulário e traz uma dependência grande.
- Conclusão: dicionário ponderado + regras de pergunta + peso por recência, sem dependência nova.

## Arquitetura proposta

`src/heuristic.js` (puro, testável): `judge({ items, context, now, botId, dictionary, config }) → { reply, own, contextBonus, total, hits: [...] }`.

**Normalização**: minúsculas, remove acentos (NFD + strip de diacríticos), colapsa espaços, remove pontuação exceto `?` (detectado antes).

**Dicionário** (`src/dicionario.js`, para você ir enchendo): lista de `{ termo, peso }`. Sintaxe do termo:
- palavra simples: `rothbard` (casa como palavra inteira);
- prefixo: `econom*` (economia, econômico, economista);
- `%` = qualquer coisa no meio, até N palavras: `problema%calculo` (problema do cálculo, problema de cálculo econômico);
- termos com peso negativo também valem (ex.: `kkk`, `rs`, `bom dia` para puxar para baixo).

**Sinais por mensagem nova** (cada um soma):
| Sinal | Peso inicial |
|---|---|
| tem `?` | +3 |
| palavra interrogativa (`como`, `por que`/`pq`, `o que`/`oq`, `qual`, `quando`, `onde`, `quem`, `quanto`, `de que modo`, `sera que`, `cade`) | +2 |
| fórmula de pedido (`alguem sabe`, `me explica`, `explica ai`, `alguem tem`, `o que acham`, `e se`) | +2 |
| dirigido ao grupo (`alguem`, `voces`, `galera`, `pessoal`) | +1 |
| termos do dicionário | peso de cada termo (típico +1 a +3), com teto por mensagem |
| afirmação forte (`e obvio`, `todo mundo sabe`, `mentira`, `errado`, `na verdade`, `nunca`, `sempre`) | +1 |
| mensagem curta (< 4 palavras) sem `?` | -2 |
| só link / só emoji / só risada | -3 |
| **reply a outra pessoa** (não ao bot) | **-10**, e os sinais acima não contam: só o dicionário, **sem teto** (ver abaixo) |

**Reply a outra pessoa** (adicionado em 2026-09-18): se qualquer mensagem nova do lote é reply a alguém que não é o bot (`item.quoted` em `index.js`), o lote é tratado como conversa entre eles. `?`, interrogativas, pedidos, "dirigido ao grupo" e afirmação forte são ignorados (a pergunta é para a outra pessoa); pontua só o quanto o texto tem a ver com o assunto (soma do dicionário, sem o teto de 3) contra o peso -10. Com `thresholdOwn = 3`, precisa de 13 pontos de dicionário para passar — na prática só um texto longo e denso no assunto. O contexto continua somando ao total, mas não substitui o limiar próprio.

**Contexto** (mensagens anteriores): cada uma recebe fator de recência `f = 0.5^(idade_min / meia_vida)` (meia-vida proposta: 10 min, medida em relação à mensagem que disparou o lote) multiplicado por um fator de posição (última = 1, cada anterior ×0.8). Somam com esse fator:
- termos do dicionário no contexto (assunto está no ar) → até +2 no total;
- resposta do bot recente no contexto (conversa em andamento com ele) → +2 × f;
- mensagem nova do mesmo autor que o bot respondeu por último → +1.

**Decisão**: `reply = score >= threshold` (proposta: 4). Log: `juiz local: 5.5 (tem ?, dicionario: estado, imposto; bot recente x0.7)`.

## Decisões (confirmadas em 2026-09-17)

1. Caminho do haiku apagado nesta branch (`buildJudgeArgs`, `shouldReply`, `JUDGE.model`).
2. Sem dependência nova; `*` = prefixo, `%` = qualquer coisa no meio (até 3 palavras).
3. Termos do dicionário com peso praticamente uniforme (1; poucos com 2). O que pesa mais é a mensagem em si (`?`, interrogativas) e a recência do contexto.
4. Dicionário grande (~2000 termos): economia geral, política, libertarianismo, catolicismo, moralidade, religião. Em `src/dicionario.js`, por categoria, para edição manual.
5. Dois limiares: a última mensagem nova precisa passar `thresholdOwn` sozinha **e** `own + contexto` precisa passar `thresholdTotal`.

## Decisões (confirmadas em 2026-09-18)

6. Reply a outra pessoa: peso -10 (`WEIGHTS.replyToOther`), sem o teto do dicionário nesse modo (com o teto de 3 nunca passaria).
7. Menção real a outra pessoa (`@fulano`) **não** conta como dirigida a ela: muitas vezes é citação, não conversa. Só o reply do Discord.
8. Um reply a outra pessoa no lote marca o lote inteiro (as mensagens seguintes do autor no mesmo lote são continuação da conversa com ela).
