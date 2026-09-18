// Lotes em andamento (na fila ou rodando no `claude`), por chave canal:autor.
// Cancelar aborta a execução e devolve os itens para voltarem ao lote; um
// lote travado (`lock`, geração de verdade já começou) não cancela mais: a
// mensagem nova vira um lote novo, que a fila roda depois deste.
export function createInflight() {
  const running = new Map();

  return {
    start(key, items) {
      const entry = { items, controller: new AbortController(), locked: false };
      running.set(key, entry);
      return { entry, signal: entry.controller.signal };
    },
    has: (key) => running.has(key),
    isLocked: (key) => running.get(key)?.locked === true,
    lock({ entry }) {
      entry.locked = true;
    },
    // Itens do lote cancelado (ordem original), ou null se não havia nada
    // cancelável (sem lote, ou lote travado).
    cancel(key) {
      const entry = running.get(key);
      if (!entry || entry.locked) return null;
      running.delete(key);
      entry.controller.abort();
      return entry.items;
    },
    // Só remove se ainda for a mesma entrada (um lote novo pode ter tomado a chave).
    finish(key, { entry }) {
      if (running.get(key) === entry) running.delete(key);
    },
  };
}
