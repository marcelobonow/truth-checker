// Substituto do executável `command-code` para testes: emite o mesmo NDJSON de
// `-p --output-format json` (eventos + linha final `result`), ecoando o prompt
// (stdin) e os argumentos no finalText. Formato observado na v1.55.0.
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', async () => {
  const args = process.argv.slice(2);
  if (process.env.FAKE_SLEEP_MS) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_SLEEP_MS)));
  if (process.env.FAKE_FAIL) {
    process.stderr.write('falha simulada\n');
    process.exit(1);
  }
  const i = args.indexOf('--resume');
  const sessionId = i === -1 ? 'new-session' : args[i + 1];
  const line = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
  const usage = { inputTokens: 16000, outputTokens: 20, cacheReadTokens: 7000, cacheWriteTokens: 0 };
  if (process.env.FAKE_NO_SESSION) {
    process.stderr.write(`Error: No session "${sessionId}" found to resume.\n`);
    line({ type: 'result', subtype: 'error', usage: { inputTokens: 0, outputTokens: 0 }, durationMs: 11, finalText: '', error: `Error: No session "${sessionId}" found to resume.` });
    process.exit(1);
  }
  const ev = (event) => line({ type: 'event', event });
  ev({ type: 'run_start', sessionId });
  ev({ type: 'turn_start', turnNumber: 1 });
  ev({ type: 'tool_queued', toolCallId: 't1', toolName: 'web_search', input: { query: 'node 24 lts' } });
  ev({ type: 'tool_running', toolCallId: 't1', toolName: 'web_search', description: null });
  ev({ type: 'model_request_end', model: 'fake', usage, stopReason: 'stop' });
  const finalText = `echo: ${input} | args: ${args.join(' ')}`;
  if (process.env.FAKE_MAX_TURNS) {
    process.stderr.write('Warning: Reached maximum conversation turns (1).\n');
    line({ type: 'result', subtype: 'max_turns', sessionId, stopReason: 'max_turns', usage, durationMs: 5, finalText });
    process.exit(8);
  }
  ev({ type: 'run_end', result: { finalText, stopReason: 'end_turn', turnCount: 2, usage } });
  line({ type: 'result', subtype: 'success', sessionId, stopReason: 'end_turn', usage, durationMs: 5, finalText });
});
