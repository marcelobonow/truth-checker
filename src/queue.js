// Fila serial: garante um único processo `claude` rodando por vez.
export function createQueue() {
  let size = 0; // em andamento + esperando
  let running = false;
  const pending = [];

  function drain() {
    if (running || pending.length === 0) return;
    running = true;
    const index = pending.findIndex((entry) => entry.priority !== 'low');
    const [entry] = pending.splice(index < 0 ? 0 : index, 1);
    Promise.resolve().then(entry.task).then(entry.resolve, entry.reject).finally(() => {
      running = false;
      size--;
      drain();
    });
  }

  return {
    add(task, { priority = 'normal' } = {}) {
      size++;
      const result = new Promise((resolve, reject) => pending.push({ task, priority, resolve, reject }));
      drain();
      return result;
    },
    size: () => size,
  };
}
