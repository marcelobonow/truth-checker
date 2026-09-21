// Juiz local: decide, sem chamar modelo, se um lote sem menção/reply ao bot
// merece resposta. Pontua a mensagem nova (pergunta? assunto do dicionário?)
// e soma um bônus do contexto que decai com a idade e a distância.

const WEIGHTS = {
  question: 3,
  interrogative: 2,
  request: 2,
  group: 1,
  strong: 1,
  dictionaryCap: 3, // teto do dicionário numa mensagem
  short: -2,
  noise: -3,
  addressed: 5, // nome do bot como vocativo ("boa tarde bot", "isso é verdade, bot?")
  replyToOther: -10, // reply a outra pessoa (não ao bot): a conversa é deles
  contextTopicCap: 2,
  botRecent: 2,
  sameAuthorAsLastReply: 1,
};

const INTERROGATIVES = ['como', 'por que', 'porque', 'pq', 'o que', 'oq', 'oque', 'qual', 'quais', 'quando', 'onde', 'quem', 'quanto', 'quantos', 'quanta', 'quantas', 'de que modo', 'sera que', 'cade', 'que tal'];
const REQUESTS = ['alguem sabe', 'alguem conhece', 'alguem tem', 'alguem ja', 'me explica', 'me explique', 'explica ai', 'explica pra', 'explique', 'o que acham', 'oq acham', 'que acham', 'e se', 'me ajuda', 'me ajudem', 'como funciona', 'como assim', 'me diz', 'me diga', 'me fala', 'alguma fonte', 'tem fonte', 'qual a fonte', 'me indica', 'me recomenda', 'recomendam', 'indicam', 'opiniao de voces', 'opiniao', 'duvida', 'nao entendi', 'nao entendo'];
const GROUP = ['alguem', 'voces', 'vcs', 'galera', 'pessoal', 'gente', 'povo', 'mano', 'manos', 'amigos', 'irmaos'];
const STRONG = ['e obvio', 'obviamente', 'todo mundo sabe', 'mentira', 'errado', 'errada', 'na verdade', 'nunca', 'sempre', 'jamais', 'absurdo', 'ridiculo', 'falacia', 'nao faz sentido', 'prova', 'provem', 'provado', 'fato', 'e fato', 'claramente', 'sem duvida', 'com certeza', 'discordo', 'concordo', 'nao concordo', 'burrice', 'ignorancia', 'hipocrisia'];
// Palavra antes do nome que faz dele sujeito/objeto, não vocativo ("o bot", "esse bot", "do bot").
const DETERMINERS = new Set(['o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'esse', 'essa', 'esses', 'essas', 'este', 'esta', 'estes', 'estas', 'aquele', 'aquela', 'aqueles', 'aquelas', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas', 'ao', 'aos', 'pro', 'pra', 'pros', 'pras', 'pelo', 'pela', 'meu', 'minha', 'seu', 'sua', 'nosso', 'nossa', 'que', 'qual']);
const LAUGH_RE = /^(?:k+|rs+|ha(?:ha)+|kk+|hue+|lol|rsrs+)$/;
const URL_RE = /https?:\/\/\S+|www\.\S+/g;
const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu;
const CUSTOM_EMOJI_RE = /<a?:\w+:\d+>/g;

// Minúsculas, sem acentos, sem pontuação (o "?" é olhado antes), espaços simples.
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Termo do dicionário → regex sobre o texto normalizado.
//   palavra          casa a palavra inteira
//   econom*          prefixo
//   problema%calculo qualquer coisa no meio (até 3 palavras)
export function compileTerm(term) {
  // os marcadores são separados antes de normalizar (normalize os apagaria)
  const parts = term.split(/([*%])/).flatMap((p) => (p === '*' || p === '%' ? [p] : normalize(p).split(' ').filter(Boolean)));
  let re = '';
  let prefix = false;
  for (const p of parts) {
    if (p === '*') { prefix = true; continue; }
    if (p === '%') { re += '(?:\\s+\\S+){0,3}?\\s+'; continue; }
    if (re && !re.endsWith('\\s+')) re += '\\s+';
    re += escape(p);
  }
  return new RegExp(`\\b${re}${prefix ? '\\w*' : '\\b'}`);
}

export function compileDictionary(entries) {
  return entries.map((e) => {
    const { term, weight = 1 } = typeof e === 'string' ? { term: e } : e;
    return { term, weight, re: compileTerm(term) };
  });
}

// Nome do bot no texto normalizado como vocativo: sem artigo/demonstrativo/preposição
// logo antes. Vírgula e ponto já foram apagados pelo normalize.
export function addressedTo(text, names) {
  // nomes longos primeiro: "esse padre bot" rejeitado por "padre bot" não pode
  // voltar como "bot" precedido de "padre"
  const sorted = [...new Set(names.map(normalize).filter(Boolean))].sort((a, b) => b.length - a.length);
  let rest = text;
  for (const n of sorted) {
    const re = new RegExp(`(?:^|\\b(\\w+)\\s+)(${escape(n)})\\b`, 'g');
    for (const m of rest.matchAll(re)) {
      if (!m[1] || !DETERMINERS.has(m[1])) return n;
    }
    rest = rest.replace(new RegExp(`\\b${escape(n)}\\b`, 'g'), ' ');
  }
  return null;
}

const hasAny = (text, phrases) => phrases.find((p) => new RegExp(`\\b${escape(p)}\\b`).test(text)) ?? null;

// Checagem direta e sem contexto para o modo QUESTIONS_AND_MENTIONS_ONLY.
// Não consulta dicionário nem pontuação do juiz: "?" ou uma formulação
// interrogativa/pedido basta para a mensagem seguir ao modelo.
export function isQuestion(raw) {
  if (/\?/.test(String(raw ?? ''))) return true;
  const text = normalize(String(raw ?? '').replace(URL_RE, ' ').replace(CUSTOM_EMOJI_RE, ' ').replace(EMOJI_RE, ' '));
  return Boolean(hasAny(text, INTERROGATIVES) || hasAny(text, REQUESTS));
}

// Termos do dicionário presentes no texto normalizado (cada um conta uma vez).
export function dictionaryHits(text, dictionary) {
  return dictionary.filter((d) => d.re.test(text));
}

// Pontuação de uma mensagem nova, com a lista do que pontuou.
// `replyToOther`: a mensagem é reply a outra pessoa (não ao bot). Aí "?",
// interrogativas e pedidos são da conversa deles e não contam; só o quanto o
// texto tem a ver com o assunto (dicionário, sem teto) contra o peso negativo.
export function scoreMessage(raw, dictionary, weights = WEIGHTS, { replyToOther = false, names = [] } = {}) {
  const hits = [];
  let score = 0;
  const stripped = String(raw ?? '').replace(URL_RE, ' ').replace(CUSTOM_EMOJI_RE, ' ').replace(EMOJI_RE, ' ');
  const text = normalize(stripped);
  const words = text ? text.split(' ') : [];
  if (words.length === 0 || (words.length === 1 && LAUGH_RE.test(words[0]))) {
    return { score: weights.noise, hits: ['so link/emoji/risada'], text };
  }
  if (replyToOther) {
    score += weights.replyToOther;
    hits.push(`reply a outra pessoa ${weights.replyToOther}`);
    const dict = dictionaryHits(text, dictionary);
    if (dict.length > 0) {
      const sum = dict.reduce((acc, d) => acc + d.weight, 0);
      score += sum;
      hits.push(`dicionario(${sum > 0 ? '+' : ''}${sum}): ${dict.map((d) => d.term).join(', ')}`);
    }
    return { score, hits, text };
  }
  if (/\?/.test(raw)) { score += weights.question; hits.push('tem ?'); }
  const addressed = addressedTo(text, names);
  if (addressed) { score += weights.addressed; hits.push(`dirigida ao bot: ${addressed}`); }
  const interrogative = hasAny(text, INTERROGATIVES);
  if (interrogative) { score += weights.interrogative; hits.push(`interrogativa: ${interrogative}`); }
  const request = hasAny(text, REQUESTS);
  if (request) { score += weights.request; hits.push(`pedido: ${request}`); }
  const group = hasAny(text, GROUP);
  if (group) { score += weights.group; hits.push(`grupo: ${group}`); }
  const strong = hasAny(text, STRONG);
  if (strong) { score += weights.strong; hits.push(`afirmacao: ${strong}`); }
  const dict = dictionaryHits(text, dictionary);
  if (dict.length > 0) {
    const sum = Math.min(weights.dictionaryCap, dict.reduce((acc, d) => acc + d.weight, 0));
    score += sum;
    hits.push(`dicionario(${sum > 0 ? '+' : ''}${sum}): ${dict.map((d) => d.term).join(', ')}`);
  }
  if (words.length < 4 && !/\?/.test(raw) && !addressed) { score += weights.short; hits.push('curta'); }
  return { score, hits, text };
}

// Fator de recência × posição de uma mensagem do contexto: 0.5^(idade/meia-vida)
// vezes 0.8 por posição a partir da mais recente.
export function contextFactor({ ageMs, positionFromEnd, halfLifeMinutes }) {
  const recency = halfLifeMinutes > 0 ? Math.pow(0.5, ageMs / (halfLifeMinutes * 60_000)) : 1;
  return recency * Math.pow(0.8, positionFromEnd);
}

// Decisão para um lote. `items`: mensagens novas ({ content, authorId, timestamp,
// replyToOther }); `context`: anteriores em ordem cronológica ({ content,
// authorId, timestamp }); `now`: timestamp da mensagem que disparou; `botId`:
// para achar respostas do bot; `names`: nomes do bot (vocativo sem @). Se qualquer mensagem nova é reply a outra
// pessoa, o lote inteiro é tratado como dirigido a ela.
export function judge({ items, context = [], now, botId, names = [], dictionary, config, weights = WEIGHTS }) {
  const { thresholdOwn, thresholdTotal, halfLifeMinutes = 10, maxContextBonus = 3 } = config;
  const ownText = items.map((i) => i.content).join('\n');
  const replyToOther = items.some((i) => i.replyToOther);
  const own = scoreMessage(ownText, dictionary, weights, { replyToOther, names });
  const hits = own.hits.map((h) => `[nova] ${h}`);

  let topic = 0;
  let botRecent = 0;
  const authorId = items.at(-1)?.authorId;
  let lastBotIndex = -1;
  context.forEach((m, i) => {
    const f = contextFactor({ ageMs: Math.max(0, now - m.timestamp), positionFromEnd: context.length - 1 - i, halfLifeMinutes });
    if (m.authorId === botId) {
      lastBotIndex = i;
      botRecent = Math.max(botRecent, weights.botRecent * f);
      return;
    }
    const dict = dictionaryHits(normalize(m.content), dictionary);
    if (dict.length > 0) topic += f * Math.min(weights.dictionaryCap, dict.reduce((acc, d) => acc + d.weight, 0));
  });
  topic = Math.min(weights.contextTopicCap, topic);
  if (topic > 0) hits.push(`[contexto] assunto no ar +${topic.toFixed(1)}`);
  if (botRecent > 0) hits.push(`[contexto] bot respondeu ha pouco +${botRecent.toFixed(1)}`);

  let sameAuthor = 0;
  if (lastBotIndex > 0 && context[lastBotIndex - 1]?.authorId === authorId) {
    sameAuthor = weights.sameAuthorAsLastReply;
    hits.push(`[contexto] mesmo autor da ultima conversa +${sameAuthor}`);
  }

  const contextBonus = Math.min(maxContextBonus, topic + botRecent + sameAuthor);
  const total = own.score + contextBonus;
  const reply = own.score >= thresholdOwn && total >= thresholdTotal;
  return { reply, own: own.score, contextBonus, total, hits };
}

export { WEIGHTS };
