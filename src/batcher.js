// Agrupa itens por chave (canal + autor): cada item reinicia o temporizador;
// passado `delayMs` sem item novo, o lote acumulado é entregue a `onFlush`.
// `touch` reinicia o temporizador sem adicionar item (autor está digitando),
// opcionalmente com outro prazo.
export function createBatcher({ delayMs, onFlush, onError = console.error }) {
  const pending = new Map();

  const arm = (key, entry, ms = delayMs) => {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      pending.delete(key);
      Promise.resolve()
        .then(() => onFlush(key, entry.items))
        .catch(onError);
    }, ms);
  };

  return {
    add(key, item) {
      const entry = pending.get(key) ?? { items: [], timer: null };
      pending.set(key, entry);
      entry.items.push(item);
      arm(key, entry);
      return entry.items.length;
    },
    // Devolve false se não há lote esperando nessa chave.
    touch(key, ms) {
      const entry = pending.get(key);
      if (!entry) return false;
      arm(key, entry, ms);
      return true;
    },
    // Lotes ainda esperando o prazo fechar.
    size: () => pending.size,
  };
}
