# Falhas preexistentes — linha de base de 2026-10-08

Executado `npm test` antes de alterar código na branch `feature/memoria-diaria-conversas`: 205 testes, 198 passaram e 7 falharam. Conforme pedido, ficam fora do escopo desta feature e devem ser resolvidos em uma branch futura.

- `test/claude.test.js` — `askClaude: full usa workDir e bypass; web usa webDir e --tools; prompt extra e bin/timeout chegam ao runner`
- `test/claude.test.js` — `askClaude: repassa onEvent ao runner`
- `test/claude.test.js` — `askClaude com backend commandcode: usa buildRequest (mod com system prompt) e o runner do backend`
- `test/claude.test.js` — `extraPrompt é anexado ao final do system prompt`
- `test/commandcode.test.js` — `buildRequest: --mod aponta para commandcode/mod.ts e o system prompt é o do modo + extra`
- `test/images.test.js` — `analyzeImages: um resultado por imagem, em sequência; falha de uma não derruba as outras`
- `test/prompts.test.js` — `systemPrompt: prompt do modo + extraPrompt no final`

Na linha de base, quatro testes falharam por divergência entre as expectativas de `extraPrompt`/argumentos e a saída atual dos adapters/prompts; o teste de imagens recebeu `undefined` onde esperava `description`; dois testes do fluxo `askClaude` falharam nas verificações de parâmetros/repasse. Não incluir correções dessas falhas no PR da memória diária.
