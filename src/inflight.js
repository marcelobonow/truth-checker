// Lotes em andamento (na fila ou rodando no `claude`), por chave canal:autor.
// Cancelar aborta a execução e devolve os itens para voltarem ao lote.
export function createInflight() {
  const running = new Map();

  return {
    start(key, items) {
      const entry = { items, controller: new AbortController() };
      running.set(key, entry);
      return { entry, signal: entry.controller.signal };
    },
    has: (key) => running.has(key),
    // Itens do lote cancelado (ordem original), ou null se não havia nada.
    cancel(key) {
      const entry = running.get(key);
      if (!entry) return null;
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
