// Configuração editada à mão. Segredos (token) ficam no .env.
// IDs do Discord são strings numéricas: ligue o "Modo desenvolvedor"
// (Configurações → Avançado), botão direito no usuário/servidor → Copiar ID.

// Usuários atendidos pelo bot (qualquer um deles pode usar /reset e /status).
export const TARGET_USER_IDS = [
  "***REMOVED***", //Fantasminha
  "***REMOVED***", //Eu
  "***REMOVED***", //Vintra
  "***REMOVED***", //Miyuki
  "***REMOVED***", //Cap
  "***REMOVED***", //Alvorada
  "***REMOVED***", //Marcus
  "***REMOVED***", //Bravo
  "***REMOVED***", //Dodecagono
  "***REMOVED***", //Rada
  "***REMOVED***", //Caligula


  // '123456789012345678',
];

// Servidores onde os usuários acima têm acesso total à máquina (modo full).
// Qualquer outro servidor fica só com conversa + busca na web.
export const FULL_ACCESS_GUILD_IDS = [
  // '123456789012345678',
];

// Qual CLI gera as respostas: 'claude' (Claude Code) ou 'commandcode' (Command
// Code, https://commandcode.ai). Modelos por backend: settings.claude.js e
// settings.commandcode.js. Executáveis: CLAUDE_BIN / COMMANDCODE_BIN no .env.
export const BACKEND = 'commandcode';

// false: só os usuários acima são atendidos (menções de outras pessoas são ignoradas).
// true: qualquer pessoa que mencionar @bot recebe resposta, sempre em modo web.
export const MENTION_ANYONE = false;

// Contexto enviado junto com cada lote: busca as últimas `fetch` mensagens do
// canal, inclui as últimas `channel` delas e, dentro das mesmas `fetch`, as
// últimas `author` de quem escreveu (se tiver menos, entra o que houver).
// Unidas sem duplicar, em ordem cronológica. channel = 0 e author = 0 desliga.
export const CONTEXT = {
  fetch: 50,
  channel: 10,
  author: 5,
};

// Reinício automático da sessão do Claude (o contexto não cresce sem limite):
// começa uma sessão nova quando o total de mensagens já enviadas a ela (lote +
// contexto) passar de `maxMessages`, quando o contexto da última rodada passar
// de `maxContextTokens`, ou quando ficar `idleMinutes` sem uso.
// 0 desliga o critério. `/reset` continua funcionando a qualquer momento.
export const SESSION = {
  maxMessages: 400,
  maxContextTokens: 150_000,
  idleMinutes: 60,
};

// true: ao iniciar o bot, apaga todas as sessões salvas (contexto limpo a cada reinício).
export const RESET_ON_START = true;
