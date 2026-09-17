import { spawn } from 'node:child_process';

// Roda um CLI headless uma vez. O prompt vai por stdin (evita limite e escape
// de argumentos no Windows); stdout é um stream NDJSON, entregue linha a linha
// a `onEvent` conforme chega (via `parseLine`), e o resultado final vem de
// `parseResult(stdout)`. `label` é o nome usado nas mensagens de erro.
// `bin` terminado em .mjs/.js roda pelo node (shims npm no Windows são .cmd,
// que o spawn sem shell não executa).
// Com `resultOnFailure`, saída com código ≠ 0 que ainda assim traz resultado
// resolve com ele (ex.: teto de turnos), em vez de rejeitar.
export function runCli({ prompt, args, cwd, bin, timeoutMs = 600_000, onEvent = () => { }, signal, parseResult, parseLine, label, resultOnFailure = false }, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const [file, fileArgs] = /\.m?js$/i.test(bin) ? [process.execPath, [bin, ...args]] : [bin, args];
    const child = spawnImpl(file, fileArgs, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;

    // Rejeita na hora: não espera o 'close', que pode nunca vir se um
    // processo-neto (ex.: comando do Bash) continuar segurando o stdout.
    const timer = setTimeout(() => {
      settled = true;
      killTree(child);
      reject(new Error(`${label} excedeu o tempo limite de ${timeoutMs} ms`));
    }, timeoutMs);
    // Cancelamento externo (ex.: autor mandou mensagem nova): mesmo tratamento do timeout
    const onAbort = () => {
      settled = true;
      clearTimeout(timer);
      killTree(child);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    let pending = ''; // pedaço de linha ainda incompleto
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      stdout += d;
      pending += d;
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) {
        const event = parseLine(line);
        if (event) onEvent(event);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => (stderr += d));

    child.on('error', (err) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (!settled) reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (settled) return;
      if (code !== 0) {
        const partial = resultOnFailure ? tryParse(parseResult, stdout) : null;
        if (partial) return resolve(partial);
        const err = new Error(`${label} saiu com código ${code}: ${(stderr || stdout).trim().slice(0, 500)}`);
        Object.assign(err, { code, stderr, stdout }); // saída completa para quem precisar inspecionar
        return reject(err);
      }
      try {
        resolve(parseResult(stdout));
      } catch (err) {
        reject(err);
      }
    });

    child.stdin.on('error', () => { }); // EPIPE se o processo morrer antes de ler
    child.stdin.end(prompt);
  });
}

function tryParse(parseResult, stdout) {
  try {
    return parseResult(stdout);
  } catch {
    return null;
  }
}

function abortError() {
  const err = new Error('geração cancelada');
  err.name = 'AbortError';
  return err;
}

// Mata o processo e os descendentes (no Windows, kill() só atinge o pai).
function killTree(child) {
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => { });
  } else {
    child.kill('SIGKILL');
  }
}
