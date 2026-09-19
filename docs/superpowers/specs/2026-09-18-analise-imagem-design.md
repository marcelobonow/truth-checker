# Design: análise de imagem quando o bot é marcado

> Implementado em 2026-09-18: `src/images.js` (+ `test/images.test.js`), modo `vision` em `prompts.js`, `claude.js` e `commandcode.js`, blocos de imagem em `buildUserMessage`, `IMAGES` em `settings.js`, `MODEL.vision`/`EFFORT.vision` nos settings dos backends, ligação em `index.js` (`attachImages`). Smoke test com o Command Code (`deepseek-v4.1-flash`, `read_file` em `-p`): descrição correta em ~8 s.

## Objetivo

Quando alguém marca o bot explicitamente (`@bot` real ou "@Nome" escrito) e a mensagem traz uma imagem, ou é reply a uma mensagem que traz uma imagem, o bot analisa a imagem e coloca a descrição no contexto que vai para o modelo, junto com o texto. Em qualquer outro caso (mensagem solta com imagem, reply ao bot sem menção, reply a alguém sem menção) a imagem é ignorada, como hoje.

Não é um slash command: o gatilho é a própria mensagem com menção (slash command não carrega anexo nem reply do jeito descrito).

## Situação atual (confirmado no código)

- `src/index.js` (`MessageCreate`): `hasText(message.content)` descarta mensagem sem texto, inclusive "@bot" + imagem ([bridge.js](../../../src/bridge.js) `hasText`, comentário "o bot não lê imagens").
- `resolveReference` busca a mensagem citada (`fetchReference`) e guarda só `author` + 300 chars de texto em `item.quoted`; anexos da citada são ignorados.
- `buildUserMessage` monta cada mensagem nova como `(em resposta a X: "...") texto`; não há lugar para imagem.
- Os dois backends leem imagem do disco pela ferramenta de arquivo, restrita ao cwd:
  - Claude Code: `Read` lê PNG/JPG/GIF/WEBP e mostra ao modelo; fora do cwd pede permissão, e em `-p` isso vira negação.
  - Command Code 1.56: `read_file` lê imagem por caminho absoluto ("must be inside the workspace"), redimensiona, e mostra ao modelo; `deepseek/deepseek-v4.1-flash` (o `MODEL` atual) é listado "with vision". Modelos sem visão dependem de um consentimento interativo que não existe em `-p`.
- Nenhum dos dois CLIs aceita imagem pelo stdin do jeito que o `runner.js` manda o prompt.

## Duas formas de fazer

**A. Chamada de visão separada → descrição em texto no prompt (recomendada)**
Ao receber a mensagem, o bot baixa a imagem para uma pasta própria e roda o CLI uma vez, sem sessão, num "modo vision" (só a ferramenta de leitura, cwd = a pasta da imagem), com um system prompt de descrição. O texto que volta entra na mensagem nova como `[imagem anexada: ...]`. A geração principal segue como hoje, só texto.
- Sempre analisa (não depende de o modelo resolver ler o arquivo).
- A sessão guarda só a descrição (texto); a imagem não volta ao modelo a cada rodada.
- O modo web da conversa principal continua sem ferramenta de arquivo.
- Custo: uma chamada extra do CLI por imagem (~10 a 20 s), que roda em paralelo com a espera do lote (`BATCH_DELAY_MS`) e com a busca de contexto.

**B. Caminho da imagem no prompt, o modelo lê na própria geração**
Baixa a imagem e escreve `[imagem anexada em C:\...\x.png]` no prompt; libera `Read`/`read_file` no modo web, com cwd numa pasta vazia para restringir a leitura.
- Uma chamada só.
- A imagem fica na sessão (tokens reenviados a cada rodada até o reset); o modelo pode não ler; o modo web da conversa ganha ferramenta de arquivo (cwd do modo web muda para uma pasta vazia, hoje é a raiz do bot no Claude Code, que tem `.env`).

Sigo com **A**, salvo objeção.

## Arquitetura (opção A)

### `src/images.js` (novo)

- `pickImages(attachments, { max, maxBytes })` (pura): filtra `contentType` em `image/png|jpeg|gif|webp` e `size <= maxBytes`, devolve até `max` itens `{ id, url, name, contentType, size }`, na ordem do Discord. Anexos rejeitados por tipo/tamanho aparecem no log com o motivo.
- `imageLinks(rawContent)` (pura): URLs `http(s)` no texto cujo caminho termina em `.png|.jpg|.jpeg|.gif|.webp` (query string ignorada). Sem depender do embed do Discord, que chega depois da mensagem (em `MessageUpdate`).
- `collectImages({ message, reference, mentionsBot, isTarget, limits })` (pura): `[]` se `!mentionsBot || !isTarget`; senão, nesta ordem: anexos da mensagem (`source: 'anexo'`), links da mensagem (`source: 'link'`), anexos da citada (`source: 'citada'`), links da citada (`source: 'link citado'`); cortado em `max` no total.
- `download(image, dir)`: `fetch` (global do Node 22) → grava `<dir>/<message.id>-<n>.<ext>`; devolve o caminho. Recusa resposta cujo `Content-Type` não seja `image/png|jpeg|gif|webp` (link que não é imagem de verdade) ou cujo corpo passe de `maxBytes` (para de ler e apaga). Para anexo o tipo e o tamanho já vêm do Discord; para link só se sabe ao baixar.
- `describeImage({ file, hint, backend, config, signal })`: roda `backend.run({ ...backend.buildRequest({ mode: 'vision', workDir: dir, model, effort, prompt }), cwd: dir, bin, timeoutMs })`; devolve o texto cortado em `maxChars`. Apaga o arquivo no `finally`. `hint` é o texto da mensagem do autor (sem as menções), para a descrição focar no que ele perguntou.
- `analyzeImages(item, deps)`: baixa e descreve uma a uma (sequencial, fora da fila de gerações); preenche `item.images = [{ source, name, description }]` ou `{ source, name, error: 'motivo' }` quando falha (o modelo fica sabendo que havia uma imagem que não deu para ler).

### Modo `vision` nos backends

- `prompts.js`: `MODE_PROMPTS.vision`: "Você descreve imagens para outro assistente que não as vê. Leia o arquivo indicado com a ferramenta de leitura e responda só com a descrição, em português: o que aparece, texto legível transcrito integralmente (mensagens, código, tabelas, valores de gráficos), layout, o que está em destaque. Sem preâmbulo, sem opinião. Se não conseguir ler, responda `ERRO: motivo`." Sem o `COMMON_PROMPT` (não é conversa de Discord) e sem `extraPrompt`.
- Prompt do usuário: `Descreva a imagem em <caminho>.` + `O autor escreveu junto: "<texto>"; descreva tudo, com atenção especial ao que for relevante para isso.` (só quando há texto além da menção).
- `claude.js`: `mode === 'vision'` → `--tools Read --strict-mcp-config --disable-slash-commands --max-turns 3`; sem `--resume`.
- `commandcode.js`: `mode === 'vision'` → `--mod-option tools=read_file,search_tools --no-skills --max-turns 4`; sem `--resume`.
- `settings.claude.js` / `settings.commandcode.js`: `MODEL.vision` e `EFFORT.vision` (`null` = mesmo do web).
- Pasta das imagens: `<raiz do bot>/imagens/` (entra no `.gitignore`), criada no start. É o cwd da chamada de visão, então a ferramenta de leitura só alcança ela.

### Fluxo em `index.js`

1. `MessageCreate`: a condição de "sem texto" passa a ser `!hasText(content) && !(mentionsBot && isTarget && (temAnexoDeImagem || message.reference))`: "@bot" + imagem, ou "@bot" como reply, seguem em frente (só da whitelist; para os demais nada muda). Mensagem só com link de imagem já passa em `hasText` (o link é texto).
2. `resolveReference` passa a devolver a mensagem citada; `item.ready = resolveReference(...).then((ref) => analyzeImages(item, ref))`. A análise começa na hora (em paralelo com a espera do lote) e manda um `sendTyping` para o canal.
3. `processBatch`, depois de `await ready`: itens sem texto e sem imagem (ex.: "@bot" em reply a uma mensagem só de texto... que já tem `quoted`; ou anexo rejeitado) seguem como hoje (o modelo recebe a citação/menção e responde ao que dá).
4. `buildUserMessage`: cada imagem vira um bloco antes do texto da mensagem, na linha do item:
   - `[imagem anexada "print.png": <descrição>]`
   - `[imagem do link https://...: <descrição>]`
   - `[imagem na mensagem citada "foto.jpg": <descrição>]` / `[imagem do link na mensagem citada https://...: <descrição>]`
   - `[imagem anexada "x.png": não foi possível analisar (<motivo>)]`
   O lembrete final (`>> responda a ...`) não muda.
5. `COMMON_PROMPT` ganha um parágrafo: "Um bloco `[imagem anexada: ...]`, `[imagem do link ...: ...]` ou `[imagem na mensagem citada: ...]` numa mensagem nova é a descrição de uma imagem que o autor mandou, linkou ou citou, feita por você antes: trate como se tivesse visto a imagem, sem dizer que recebeu uma descrição."
6. Juiz local: não muda (menção → `responder: sempre`, o juiz não roda).
7. Cancelamento: `inflight.cancel` não interrompe `item.ready`; a análise termina e o resultado é reaproveitado quando o lote fecha de novo.
8. Só a whitelist: `collectImages` recebe `isTarget`; quem não está em `TARGET_USER_IDS` (com `MENTION_ANYONE = true`) tem a imagem ignorada e o texto tratado como hoje.

### Configuração (`settings.js`)

```js
export const IMAGES = {
  max: 2,             // imagens por mensagem (anexos + links + citada); as demais são ignoradas com log
  maxBytes: 8_000_000,
  maxChars: 8000,     // corte da descrição (~5k tokens); o prompt de visão pede descrição longa e completa
  timeoutMs: 90_000,  // por imagem
};
```
`max: 0` desliga o recurso.

### Log

- `imagem recebida: print.png (1.2 MB, anexo) → analisando` / `imagem recebida: https://... (link) → baixando`
- `imagem descrita em 12.3s: <80 chars>`
- `imagem ignorada: tipo image/svg+xml` / `acima de 8 MB` / `passou de IMAGES.max` / `link não é imagem (text/html)`
- `falha ao analisar imagem: <erro>` (warn; o lote segue)

### Testes

- `test/images.test.js`: `pickImages` (tipo, tamanho, limite, ordem), `imageLinks` (extensões, query string, URL de página ignorada), `collectImages` (sem menção ou fora da whitelist → `[]`; ordem anexo → link → citada; corte total em `max`), `download` com `fetch` falso (Content-Type errado, corpo acima do limite).
- `test/bridge.test.js`: `buildUserMessage` com imagem anexada, citada, com erro, e combinada com `quoted`.
- `test/claude.test.js` / `test/commandcode.test.js`: `buildRequest({ mode: 'vision' })` (ferramentas, sem resume, max-turns).
- `test/prompts.test.js`: `systemPrompt({ mode: 'vision' })` sem o texto do Discord.
- Manual: "@bot" + png; "@bot" + link direto de imagem; reply a mensagem com imagem + "@bot o que é isso?"; imagem sem menção (ignorada); reply ao bot com imagem sem menção (ignorada); menção de quem não está na whitelist com imagem (texto só).

## Decisões (confirmadas em 2026-09-18)

1. Mecanismo A: chamada de visão separada, descrição em texto no prompt. (Sem resposta; assumido pela recomendação.)
2. Só a whitelist (`TARGET_USER_IDS`) tem imagem analisada.
3. Descrição até 8000 chars (~5k tokens), para o modelo "ver" melhor a imagem; 2 imagens por mensagem e 8 MB mantidos.
4. O texto do autor vai junto como dica para a descrição.
5. `MODEL.vision = null` (mesmo modelo do web). (Sem resposta; assumido.)
6. Links diretos de imagem no texto (URL terminando em extensão de imagem, `Content-Type image/*` ao baixar) são baixados e analisados igual aos anexos, na mensagem e na citada. Links de páginas (tweet, notícia) ficam de fora: o WebFetch dos CLIs converte HTML em texto e não passa a imagem ao modelo.
7. Pasta `<raiz>/imagens/`, gitignored, arquivo apagado após a análise. (Sem resposta; assumido.)
