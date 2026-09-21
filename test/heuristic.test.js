import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, compileTerm, compileDictionary, scoreMessage, contextFactor, judge, isQuestion, WEIGHTS } from '../src/heuristic.js';
import { parseDictionary, DICIONARIO } from '../src/dicionario.js';

const dict = compileDictionary([{ term: 'estado', weight: 1 }, { term: 'imposto*', weight: 1 }, { term: 'problema%calculo', weight: 2 }, { term: 'bom dia', weight: -2 }]);

test('normalize: minúsculas, sem acento, sem pontuação, espaços simples', () => {
  assert.equal(normalize('  Olá, PORQUÊ?  não! '), 'ola porque nao');
});

test('isQuestion: aceita pontuação e formulações interrogativas, sem consultar o juiz', () => {
  assert.equal(isQuestion('isso funciona?'), true);
  assert.equal(isQuestion('como funciona isso'), true);
  assert.equal(isQuestion('alguém sabe onde fica'), true);
  assert.equal(isQuestion('fui no mercado hoje'), false);
});

test('compileTerm: palavra inteira, prefixo (*) e qualquer coisa no meio (%)', () => {
  assert.ok(compileTerm('estado').test('o estado quebrou'));
  assert.ok(!compileTerm('estado').test('estadual'));
  assert.ok(compileTerm('imposto*').test('impostos altos'));
  assert.ok(compileTerm('problema%calculo').test('o problema do calculo economico'));
  assert.ok(!compileTerm('problema%calculo').test('problema de um dois tres quatro calculo'));
});

test('scoreMessage: pergunta com termo do dicionário pontua; risada sozinha é ruído; curta sem ? perde ponto', () => {
  const q = scoreMessage('Alguém sabe por que o Estado cobra imposto?', dict);
  assert.ok(q.score >= WEIGHTS.question + WEIGHTS.interrogative + WEIGHTS.request + 2, JSON.stringify(q));
  assert.ok(q.hits.some((h) => h.startsWith('dicionario(+2)')));
  assert.equal(scoreMessage('kkkkk', dict).score, WEIGHTS.noise);
  assert.equal(scoreMessage('https://x.com/a', dict).score, WEIGHTS.noise);
  const short = scoreMessage('bom dia gente', dict);
  assert.ok(short.score < 0, JSON.stringify(short));
});

test('scoreMessage: dicionário tem teto por mensagem', () => {
  const big = compileDictionary(['a1', 'a2', 'a3', 'a4', 'a5']);
  const r = scoreMessage('a1 a2 a3 a4 a5 juntos aqui', big);
  assert.ok(r.hits.some((h) => h.startsWith(`dicionario(+${WEIGHTS.dictionaryCap})`)));
});

test('contextFactor: decai pela metade a cada meia-vida e 0.8 por posição', () => {
  assert.equal(contextFactor({ ageMs: 0, positionFromEnd: 0, halfLifeMinutes: 10 }), 1);
  assert.ok(Math.abs(contextFactor({ ageMs: 10 * 60_000, positionFromEnd: 0, halfLifeMinutes: 10 }) - 0.5) < 1e-9);
  assert.ok(Math.abs(contextFactor({ ageMs: 0, positionFromEnd: 2, halfLifeMinutes: 10 }) - 0.64) < 1e-9);
});

const cfg = { thresholdOwn: 3, thresholdTotal: 4, halfLifeMinutes: 10, maxContextBonus: 3 };
const now = 1_000_000;

test('judge: pergunta sobre o assunto passa; conversa sem pergunta e sem assunto não passa', () => {
  const yes = judge({ items: [{ content: 'por que o estado cobra imposto?', authorId: 'u', timestamp: now }], context: [], now, botId: 'bot', dictionary: dict, config: cfg });
  assert.equal(yes.reply, true);
  const no = judge({ items: [{ content: 'fui no mercado hoje', authorId: 'u', timestamp: now }], context: [], now, botId: 'bot', dictionary: dict, config: cfg });
  assert.equal(no.reply, false);
});

test('judge: a mensagem precisa passar o limiar próprio mesmo com contexto forte', () => {
  const context = [
    { content: 'o estado e o imposto são o problema', authorId: 'x', timestamp: now - 30_000 },
    { content: 'resposta do bot sobre estado', authorId: 'bot', timestamp: now - 20_000 },
  ];
  const weak = judge({ items: [{ content: 'sim', authorId: 'u', timestamp: now }], context, now, botId: 'bot', dictionary: dict, config: cfg });
  assert.equal(weak.reply, false);
  assert.ok(weak.contextBonus > 0);
});

test('judge: contexto empurra uma mensagem no limite para cima, e o bônus tem teto', () => {
  const border = { content: 'e o estado?', authorId: 'u', timestamp: now }; // ? (3) + estado (1) = 4 próprio
  const alone = judge({ items: [border], context: [], now, botId: 'bot', dictionary: dict, config: { ...cfg, thresholdTotal: 5 } });
  assert.equal(alone.reply, false);
  const context = [
    { content: 'imposto e estado', authorId: 'u', timestamp: now - 10_000 },
    { content: 'bot falou do estado', authorId: 'bot', timestamp: now - 5_000 },
  ];
  const helped = judge({ items: [border], context, now, botId: 'bot', dictionary: dict, config: { ...cfg, thresholdTotal: 5 } });
  assert.equal(helped.reply, true);
  assert.ok(helped.contextBonus <= cfg.maxContextBonus);
  assert.ok(helped.hits.some((h) => h.includes('mesmo autor')));
});

test('parseDictionary: termos com peso, sem duplicatas, comentários ignorados', () => {
  const entries = parseDictionary({ a: 'estado\n# comentario\nbom dia = -2\nestado = 2\n' });
  assert.deepEqual(entries.sort((x, y) => x.term.localeCompare(y.term)), [{ term: 'bom dia', weight: -2 }, { term: 'estado', weight: 2 }]);
  const real = parseDictionary(DICIONARIO);
  assert.ok(real.length > 500, `dicionário com ${real.length} termos`);
  assert.doesNotThrow(() => compileDictionary(real));
});

test('scoreMessage: reply a outra pessoa ignora "?" e interrogativas; só o dicionário (sem teto) conta contra o peso negativo', () => {
  const r = scoreMessage('por que você acha isso?', dict, WEIGHTS, { replyToOther: true });
  assert.equal(r.score, WEIGHTS.replyToOther, JSON.stringify(r));
  assert.ok(!r.hits.some((h) => h.includes('tem ?') || h.includes('interrogativa')));
  const big = compileDictionary(['a1', 'a2', 'a3', 'a4', 'a5']);
  const topic = scoreMessage('a1 a2 a3 a4 a5 juntos aqui', big, WEIGHTS, { replyToOther: true });
  assert.equal(topic.score, WEIGHTS.replyToOther + 5, JSON.stringify(topic));
});

test('judge: pergunta que é reply a outra pessoa não passa, mesmo com contexto; a mesma pergunta solta passa', () => {
  const context = [
    { content: 'o estado e o imposto são o problema', authorId: 'x', timestamp: now - 30_000 },
    { content: 'resposta do bot sobre estado', authorId: 'bot', timestamp: now - 20_000 },
  ];
  const item = { content: 'por que o estado cobra imposto?', authorId: 'u', timestamp: now };
  assert.equal(judge({ items: [{ ...item, replyToOther: true }], context, now, botId: 'bot', dictionary: dict, config: cfg }).reply, false);
  assert.equal(judge({ items: [item], context, now, botId: 'bot', dictionary: dict, config: cfg }).reply, true);
});

test('judge: um reply a outra pessoa no lote marca o lote inteiro', () => {
  const items = [
    { content: 'não', authorId: 'u', timestamp: now - 1_000, replyToOther: true },
    { content: 'por que o estado cobra imposto?', authorId: 'u', timestamp: now },
  ];
  const r = judge({ items, context: [], now, botId: 'bot', dictionary: dict, config: cfg });
  assert.equal(r.reply, false);
  assert.ok(r.hits.some((h) => h.includes('reply a outra pessoa')), JSON.stringify(r.hits));
});

test('scoreMessage: nome do bot como vocativo (sem artigo antes) pontua e cancela "curta"; com artigo/demonstrativo antes não', () => {
  const names = ['Bot', 'Padre Bot'];
  const greet = scoreMessage('bom dia bot', dict, WEIGHTS, { names });
  assert.equal(greet.score, -2 + WEIGHTS.addressed, JSON.stringify(greet));
  assert.ok(!greet.hits.includes('curta'));
  assert.ok(scoreMessage('é verdade isso bot?', dict, WEIGHTS, { names }).hits.some((h) => h.startsWith('dirigida ao bot')));
  assert.ok(scoreMessage('valeu, Padre Bot', dict, WEIGHTS, { names }).hits.some((h) => h.startsWith('dirigida ao bot')));
  for (const t of ['esse bot ta muito burro', 'o bot ta muito briguento', 'esse padre bot fala demais', 'do bot']) {
    assert.ok(!scoreMessage(t, dict, WEIGHTS, { names }).hits.some((h) => h.startsWith('dirigida ao bot')), t);
  }
  assert.ok(!scoreMessage('boa tarde bot', dict).hits.some((h) => h.startsWith('dirigida ao bot')));
});

test('judge: "boa tarde bot" passa o limiar; "boa tarde" solto não', () => {
  const now = 1_000_000;
  const cfg = { thresholdOwn: 3, thresholdTotal: 3, halfLifeMinutes: 10, maxContextBonus: 3 };
  const base = { context: [], now, botId: 'bot', dictionary: dict, config: cfg, names: ['Bot'] };
  assert.equal(judge({ ...base, items: [{ content: 'boa tarde bot', authorId: 'a', timestamp: now }] }).reply, true);
  assert.equal(judge({ ...base, items: [{ content: 'boa tarde', authorId: 'a', timestamp: now }] }).reply, false);
});
