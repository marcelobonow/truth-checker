// Divide um texto em blocos que cabem no limite de mensagem do Discord (2000),
// preferindo cortar em quebra de linha, depois espaço, e por último no limite.
// Quando o corte cai dentro de um bloco de código (```), fecha a cerca no fim
// do bloco e reabre no início do próximo com a mesma linguagem.

// Linha de cerca: só crases de abertura + info sem crase (```js x``` numa linha é trecho inline, não cerca)
const FENCE_RE = /^\s{0,3}`{3,}([^`]*)$/;
const CLOSE = '\n```';
const SEPARATORS = ['\n', ' '];

export function splitMessage(text, limit = 2000) {
  const chunks = [];
  let rest = text.trim();
  let openFence = null; // info da cerca aberta no bloco anterior ('' ou 'js'), ou null

  while (rest.length > 0) {
    const prefix = openFence === null ? '' : '```' + openFence + '\n';
    const budget = Math.max(limit - prefix.length, 1);

    if (rest.length <= budget) {
      chunks.push(prefix + rest);
      break;
    }

    let cut = findCut(rest, budget);
    let piece = rest.slice(0, cut);
    let fence = fenceStateAfter(prefix + piece);
    if (fence !== null) {
      // precisa de espaço para fechar a cerca
      cut = findCut(rest, budget - CLOSE.length);
      piece = rest.slice(0, cut);
      fence = fenceStateAfter(prefix + piece);
    }

    chunks.push(prefix + piece + (fence !== null ? CLOSE : ''));
    openFence = fence;
    // descarta só o separador usado no corte (quebra de linha ou espaço)
    rest = rest.slice(SEPARATORS.includes(rest[cut]) ? cut + 1 : cut);
  }

  return chunks;
}

function findCut(s, budget) {
  for (const sep of SEPARATORS) {
    const idx = s.lastIndexOf(sep, budget);
    if (idx > 0) return idx;
  }
  return budget;
}

function fenceStateAfter(text) {
  let open = null;
  for (const line of text.split('\n')) {
    const m = FENCE_RE.exec(line);
    if (!m) continue;
    open = open === null ? m[1].trim() : null;
  }
  return open;
}
