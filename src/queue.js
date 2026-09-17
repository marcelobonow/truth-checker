// Fila serial: garante um único processo `claude` rodando por vez.
export function createQueue() {
  let tail = Promise.resolve();

  return {
    add(task) {
      const run = tail.then(task);
      tail = run.catch(() => {}); // uma falha não trava as próximas
      return run;
    },
  };
}
