// Substituto do executável `claude` para testes: emite o mesmo NDJSON de
// `--output-format stream-json --verbose` (init, um tool_use, resultado),
// ecoando o prompt (stdin) e os argumentos no campo result.
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', async () => {
  const args = process.argv.slice(2);
  if (process.env.FAKE_SPAWN_HOLDER) {
    // processo-neto que herda o stdout e sobrevive ao pai por alguns segundos
    const { spawn } = await import('node:child_process');
    spawn(process.execPath, ['-e', 'setTimeout(() => {}, 4000)'], { stdio: 'inherit', detached: true }).unref();
  }
  if (process.env.FAKE_SLEEP_MS) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_SLEEP_MS)));
  if (process.env.FAKE_FAIL) {
    process.stderr.write('falha simulada\n');
    process.exit(1);
  }
  const i = args.indexOf('--resume');
  const sessionId = i === -1 ? 'new-session' : args[i + 1];
  const line = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
  line({ type: 'system', subtype: 'init', session_id: sessionId, tools: [] });
  line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'WebSearch', input: { query: 'node 24 lts' } }] }, session_id: sessionId });
  line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] }, session_id: sessionId });
  line({
    type: 'result',
    subtype: 'success',
    is_error: false,
    num_turns: 2,
    total_cost_usd: 0.01,
    result: `echo: ${input} | args: ${args.join(' ')}`,
    session_id: sessionId,
  });
});
