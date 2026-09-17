// Agrupa itens por chave (canal + autor): cada item reinicia o temporizador;
// passado `delayMs` sem item novo, o lote acumulado é entregue a `onFlush`.
export function createBatcher({ delayMs, onFlush, onError = console.error }) {
  const pending = new Map();

  return {
    add(key, item) {
      const entry = pending.get(key) ?? { items: [], timer: null };
      pending.set(key, entry);
      entry.items.push(item);
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        pending.delete(key);
        Promise.resolve()
          .then(() => onFlush(key, entry.items))
          .catch(onError);
      }, delayMs);
      return entry.items.length;
    },
  };
}
