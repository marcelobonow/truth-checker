// Fila serial: garante um único processo `claude` rodando por vez.
export function createQueue() {
  let tail = Promise.resolve();
  let size = 0; // em andamento + esperando

  return {
    add(task) {
      size++;
      const run = tail.then(task).finally(() => size--);
      tail = run.catch(() => {}); // uma falha não trava as próximas
      return run;
    },
    size: () => size,
  };
}
