import { spawn } from 'node:child_process';

const WEB_TOOLS = 'WebSearch,WebFetch';

export const NO_REPLY = 'NO_REPLY';

const COMMON_PROMPT = `Você está respondendo mensagens do Discord, em português do Brasil. Tom, tamanho e formatação das respostas: siga as instruções específicas do modo/servidor no final deste prompt.
Cada mensagem que você recebe começa com um cabeçalho "[discord] servidor: ... | canal: ... | autor: ... | responder: ...". Pode vir uma seção "contexto recente do canal" com mensagens anteriores de várias pessoas, incluindo suas próprias respostas (só para você entender o assunto; não responda a elas). Uma mensagem do contexto com um horário no início ("- [14:32] Nome: texto") ficou parada por mais de 10 minutos antes da mensagem atual: use isso para perceber que o assunto pode ter mudado e não é mais a mesma conversa. Depois vêm as "mensagens novas" do autor: uma ou mais (numeradas quando há mais de uma; "(em resposta a X: \"...\")" indica que a pessoa respondeu a uma mensagem de X). Responda ao conjunto das mensagens novas de uma vez só.

Marcar ou responder outra pessoa: se vier a linha "pessoas citadas: Nome → <@id>, ...", o autor mencionou essas pessoas e o contexto vem numerado ("- #n Nome: texto"). Quando ele pedir para responder ou marcar alguém: se houver no contexto uma mensagem dessa pessoa ligada ao assunto, comece sua resposta com a linha "[responder: #n]" (o bot responde diretamente àquela mensagem, e a pessoa é marcada); senão, marque a pessoa escrevendo <@id> no texto. Só marque quem estiver em "pessoas citadas". Sem pedido do autor, não use nem um nem outro.

Regra de resposta:
- "responder: sempre" → responda.
- "responder: se couber" → responda apenas se houver uma pergunta ou uma afirmação que contradiz as premissas/instruções abaixo ou o contexto da conversa. Caso contrário, responda exatamente ${NO_REPLY}, sem nenhum outro texto e sem usar nenhuma ferramenta.

Evite os tipos de respostas que "dão na cara" que é IA, como o uso de emdash (—). NUNCA use emdash
`;

const MODE_PROMPTS = {
  web: () =>
    COMMON_PROMPT +
    `

Neste servidor você só tem acesso às ferramentas de busca na web (WebSearch e WebFetch).` +
    ' Você NÃO tem acesso a arquivos nem a comandos; se pedirem isso, diga que neste servidor só há acesso à web.',
  full: (workDir) =>
    COMMON_PROMPT +
    `

Neste servidor você opera com acesso total à máquina do usuário, no diretório ${workDir}.` +
    ' Ele está programando remotamente: leia, edite e execute o que for pedido e reporte o resultado.',
};

// Filtro barato antes da resposta de verdade (modo "responder: se couber"):
// decide só SIM/NAO, sem ferramentas e sem sessão. As premissas do servidor
// (extraPrompt) entram para ele saber o que conta como "contradiz".
const JUDGE_PROMPT = `Você é um filtro. Vai receber uma mensagem do Discord com cabeçalho "[discord] ...", talvez um "contexto recente do canal" e as "mensagens novas" do autor. Um assistente responderá em nome do dono do bot só se valer a pena.
Responda SIM se nas mensagens novas houver uma pergunta, um pedido, ou uma afirmação que contradiz as premissas e posições descritas abaixo. Responda NAO se for conversa entre outras pessoas, comentário sem pergunta, assunto fora das premissas, ou cumprimento/bênção solto no canal ("bom dia", "fica com Deus" etc. sem ser dirigido ao bot).
Na dúvida, SIM. Responda exatamente SIM ou NAO, sem mais nada.`;

export function buildJudgeArgs({ extraPrompt, model, effort }) {
  const systemPrompt = extraPrompt ? `${JUDGE_PROMPT}

${extraPrompt.trim()}` : JUDGE_PROMPT;
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--append-system-prompt', systemPrompt,
    '--tools', '', '--max-turns', '1', '--strict-mcp-config', '--disable-slash-commands'];
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  return args;
}

export function buildArgs({ mode, sessionId, workDir, extraPrompt, model, effort, maxTurns }) {
  const promptFor = MODE_PROMPTS[mode];
  if (!promptFor) throw new Error(`modo desconhecido: ${mode}`);

  const systemPrompt = extraPrompt ? `${promptFor(workDir)}

${extraPrompt.trim()}` : promptFor(workDir);
  // stream-json (exige --verbose): um evento JSON por linha, o último é o resultado
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--append-system-prompt', systemPrompt];
  if (mode === 'web') {
    // Enxuto: só ferramentas web, sem skills nem servidores MCP da config global
    // (menos tokens no system prompt e nada exposto a quem só menciona o bot).
    args.push('--tools', WEB_TOOLS, '--allowedTools', WEB_TOOLS, '--strict-mcp-config', '--disable-slash-commands');
    // teto de idas à web por resposta: cada resultado de busca entra no contexto
    if (maxTurns) args.push('--max-turns', String(maxTurns));
  }
  if (mode === 'full') args.push('--dangerously-skip-permissions');
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  if (sessionId) args.push('--resume', sessionId);
  return args;
}

// Saída de `--output-format stream-json`: uma linha JSON por evento; o
// resultado é o evento `type: "result"` (normalmente o último). Também aceita
// a saída de `--output-format json` (um único objeto).
export function parseResult(stdout) {
  const events = parseEvents(stdout);
  const result = events.findLast((e) => e.type === 'result');
  if (!result) throw new Error(`saída do claude sem resultado: ${stdout.slice(0, 500)}`);
  return {
    text: result.result ?? result.subtype ?? '',
    sessionId: result.session_id,
    isError: Boolean(result.is_error) || result.subtype !== 'success',
    subtype: result.subtype,
    numTurns: result.num_turns,
    costUsd: result.total_cost_usd,
    contextTokens: contextTokensOf(result.usage),
  };
}

// Tamanho do contexto na última chamada à API (input + cache), que é o que
// cada rodada seguinte vai reenviar. `iterations` separa as chamadas quando
// houve ferramentas; sem ele, o total serve.
function contextTokensOf(usage) {
  if (!usage) return 0;
  const last = usage.iterations?.at(-1) ?? usage;
  return (last.input_tokens ?? 0) + (last.cache_read_input_tokens ?? 0) + (last.cache_creation_input_tokens ?? 0);
}

function parseEvents(text) {
  const events = [];
  for (const line of text.split('\n')) {
    const event = parseLine(line);
    if (event) events.push(event);
  }
  return events;
}

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

// Traduz um evento do stream em uma linha de atividade legível (ou null).
const TOOL_ACTIVITY = {
  WebSearch: (i) => `procurando na web: "${i.query}"`,
  WebFetch: (i) => `lendo página: ${i.url}`,
  Bash: (i) => `executando comando: ${String(i.command ?? '').slice(0, 120)}`,
  Read: (i) => `lendo arquivo: ${i.file_path}`,
  Edit: (i) => `editando arquivo: ${i.file_path}`,
  Write: (i) => `editando arquivo: ${i.file_path}`,
};

export function describeEvent(event) {
  if (event.type === 'rate_limit_event') {
    const info = event.rate_limit_info ?? {};
    return info.status === 'allowed' ? null : `limite de uso: ${info.status} (${info.rateLimitType})`;
  }
  if (event.type !== 'assistant') return null;
  for (const block of event.message?.content ?? []) {
    if (block.type === 'tool_use') {
      const describe = TOOL_ACTIVITY[block.name];
      return describe ? describe(block.input ?? {}) : `usando ferramenta ${block.name}`;
    }
    if (block.type === 'text' && block.text?.trim()) return 'gerando resposta';
  }
  return null;
}

// Roda `claude` uma vez. O prompt vai por stdin (evita limite e escape de
// argumentos no Windows); stdout é o stream de eventos, entregue linha a
// linha a `onEvent` conforme chega, e o resultado final é devolvido.
export function runClaude({ prompt, args, cwd, bin = 'claude', timeoutMs = 600_000, onEvent = () => { }, signal }, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const child = spawnImpl(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;

    // Rejeita na hora: não espera o 'close', que pode nunca vir se um
    // processo-neto (ex.: comando do Bash) continuar segurando o stdout.
    const timer = setTimeout(() => {
      settled = true;
      killTree(child);
      reject(new Error(`claude excedeu o tempo limite de ${timeoutMs} ms`));
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
        const err = new Error(`claude saiu com código ${code}: ${(stderr || stdout).trim().slice(0, 500)}`);
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
