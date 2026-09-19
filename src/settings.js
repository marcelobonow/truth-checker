// Configuração editada à mão. Segredos (token) ficam no .env.
// IDs do Discord são strings numéricas: ligue o "Modo desenvolvedor"
// (Configurações → Avançado), botão direito no usuário/servidor → Copiar ID.

// Usuários atendidos pelo bot ficam em src/users.js (ignorado pelo git, para
// não expor os ids de quem participa). Modelo: src/users.example.js.
export { TARGET_USER_IDS } from './users.js';

// Cargos que valem como whitelist: quem tem um deles é atendido como se
// estivesse em TARGET_USER_IDS (sem menção, /reset, /status), mas sempre em
// modo web: o full é só para os ids acima. Dá para liberar alguém só dando o
// cargo, sem reiniciar o bot.
export const TARGET_ROLE_IDS = [
  "1550716105775910932"
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

// Juiz local (só quando "responder: se couber", isto é, sem menção nem reply
// ao bot): pontua as mensagens novas e o contexto na CPU (src/heuristic.js,
// termos em src/dicionario.js) e só chama o modelo se passar dos limiares.
// null desliga (chama sempre; o modelo ainda pode responder NO_REPLY).
export const JUDGE = {
  thresholdOwn: 3, // as mensagens novas precisam disso sozinhas (ex.: "?" = 3)
  thresholdTotal: 4, // próprias + bônus do contexto
  halfLifeMinutes: 10, // peso do contexto cai pela metade a cada tanto
  maxContextBonus: 3, // teto do que o contexto pode somar
};

// Contexto enviado junto com cada lote: busca as últimas `fetch` mensagens do
// canal, inclui as últimas `channel` delas e, dentro das mesmas `fetch`, as
// últimas `author` de quem escreveu (se tiver menos, entra o que houver).
// Unidas sem duplicar, em ordem cronológica. channel = 0 e author = 0 desliga.
export const CONTEXT = {
  fetch: 50,
  channel: 10,
  author: 5,
};

// Análise de imagem (docs/superpowers/specs/2026-09-18-analise-imagem-design.md):
// só quando alguém da whitelist marca o bot explicitamente, com imagem anexada,
// linkada ou na mensagem citada (reply). Cada imagem é descrita numa chamada
// separada do CLI (modelo: MODEL.vision em settings.<backend>.js) e a descrição
// entra no prompt no lugar da imagem. max = 0 desliga.
export const IMAGES = {
  max: 2, // imagens por mensagem (anexos + links + citada); as demais são ignoradas com log
  maxBytes: 8_000_000,
  maxChars: 12_000, // corte da descrição (o prompt de visão mira em ~10000 chars)
  timeoutMs: 90_000, // por imagem
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
