import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pickImages, imageLinks, collectImages, download, describeImage, analyzeImages, formatImage } from '../src/images.js';

const limits = { max: 2, maxBytes: 1000 };
const att = (id, contentType = 'image/png', size = 10, name = `${id}.png`) => ({ id, url: `https://cdn/${id}`, name, contentType, size });

test('pickImages: só image/png|jpeg|gif|webp até maxBytes, na ordem, no máximo max', () => {
  const list = [att('a'), att('b', 'image/svg+xml'), att('c', 'image/jpeg', 2000), att('d', 'image/webp'), att('e', 'image/gif')];
  const { images, rejected } = pickImages(list, limits);
  assert.deepEqual(images.map((i) => i.id), ['a', 'd']);
  assert.deepEqual(rejected, [
    { name: 'b.png', reason: 'tipo image/svg+xml' },
    { name: 'c.png', reason: 'acima de 1000 bytes' },
    { name: 'e.png', reason: 'passou de 2 imagens' },
  ]);
});

test('pickImages: anexo sem contentType conta pela extensão', () => {
  const { images } = pickImages([att('a', null, 10, 'foto.JPG'), att('b', null, 10, 'doc.pdf')], limits);
  assert.deepEqual(images.map((i) => i.id), ['a']);
});

test('imageLinks: URLs http(s) terminando em extensão de imagem, ignorando query string', () => {
  const text = 'olha https://x.com/a.png?size=2 e http://y.org/b.jpeg e https://z.com/pagina e <https://w.net/c.webp>';
  assert.deepEqual(imageLinks(text), ['https://x.com/a.png?size=2', 'http://y.org/b.jpeg', 'https://w.net/c.webp']);
  assert.deepEqual(imageLinks(''), []);
});

test('collectImages: nada sem menção explícita ou fora da whitelist', () => {
  const message = { id: 'm', content: 'https://x.com/a.png', attachments: [att('a')] };
  assert.deepEqual(collectImages({ message, mentionsBot: false, isTarget: true, limits }).images, []);
  assert.deepEqual(collectImages({ message, mentionsBot: true, isTarget: false, limits }).images, []);
});

test('collectImages: anexos, links, anexos da citada, links da citada; corte total em max', () => {
  const message = { id: 'm', content: 'https://x.com/l1.png', attachments: [att('a')] };
  const reference = { id: 'r', content: 'https://x.com/l2.png', attachments: [att('b')] };
  const { images, rejected } = collectImages({ message, reference, mentionsBot: true, isTarget: true, limits: { max: 10, maxBytes: 1000 } });
  assert.deepEqual(images.map((i) => [i.source, i.name]), [
    ['anexo', 'a.png'],
    ['link', 'https://x.com/l1.png'],
    ['citada', 'b.png'],
    ['link citado', 'https://x.com/l2.png'],
  ]);
  assert.deepEqual(rejected, []);
  const cut = collectImages({ message, reference, mentionsBot: true, isTarget: true, limits: { max: 3, maxBytes: 1000 } });
  assert.deepEqual(cut.images.map((i) => i.name), ['a.png', 'https://x.com/l1.png', 'b.png']);
  assert.deepEqual(cut.rejected, [{ name: 'https://x.com/l2.png', reason: 'passou de 3 imagens' }]);
});

test('collectImages: sem mensagem citada, só a própria', () => {
  const message = { id: 'm', content: '', attachments: [att('a')] };
  const { images } = collectImages({ message, reference: null, mentionsBot: true, isTarget: true, limits });
  assert.deepEqual(images.map((i) => i.name), ['a.png']);
});

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bot-imagens-'));
}
const fakeFetch = (body, headers = { 'content-type': 'image/png' }) => async () => new Response(body, { headers });

test('download: grava o arquivo com a extensão do tipo e devolve o caminho', async () => {
  const dir = tmpDir();
  const file = await download({ url: 'https://x/a', name: 'a' }, { dir, fileName: 'm-1', maxBytes: 100, fetchImpl: fakeFetch(Buffer.from([1, 2, 3])) });
  assert.equal(file, path.join(dir, 'm-1.png'));
  assert.deepEqual([...fs.readFileSync(file)], [1, 2, 3]);
  fs.rmSync(dir, { recursive: true });
});

test('download: recusa Content-Type que não é imagem', async () => {
  const dir = tmpDir();
  await assert.rejects(
    download({ url: 'https://x/pagina.png', name: 'p' }, { dir, fileName: 'm-1', maxBytes: 100, fetchImpl: fakeFetch('<html>', { 'content-type': 'text/html' }) }),
    /não é imagem \(text\/html\)/,
  );
  assert.deepEqual(fs.readdirSync(dir), []);
  fs.rmSync(dir, { recursive: true });
});

test('download: recusa corpo acima de maxBytes e apaga o parcial', async () => {
  const dir = tmpDir();
  await assert.rejects(
    download({ url: 'https://x/a', name: 'a' }, { dir, fileName: 'm-1', maxBytes: 2, fetchImpl: fakeFetch(Buffer.alloc(5)) }),
    /acima de 2 bytes/,
  );
  assert.deepEqual(fs.readdirSync(dir), []);
  fs.rmSync(dir, { recursive: true });
});

test('download: resposta com erro HTTP', async () => {
  const dir = tmpDir();
  await assert.rejects(
    download({ url: 'https://x/a', name: 'a' }, { dir, fileName: 'm-1', maxBytes: 100, fetchImpl: async () => new Response('', { status: 404 }) }),
    /HTTP 404/,
  );
  fs.rmSync(dir, { recursive: true });
});

test('describeImage: roda o backend em modo vision, cwd na pasta, com o caminho e a dica no prompt, e apaga o arquivo', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'm-1.png');
  fs.writeFileSync(file, 'x');
  const calls = [];
  const backend = {
    buildRequest: (req) => ({ args: ['--fake', req.mode], prompt: req.prompt, req }),
    run: async (opts) => {
      calls.push(opts);
      return { text: 'Um gato laranja.', isError: false };
    },
  };
  const config = { bin: 'cli', model: { web: 'w', vision: 'v' }, effort: { web: 'low', vision: undefined }, images: { maxChars: 8000, timeoutMs: 5000 } };
  const context = [{ authorName: 'Ana', content: 'olha meu gato' }, { authorName: 'Bot', content: 'bonito' }];
  const text = await describeImage({ file, hint: 'que raça é?', context, backend, config });
  assert.equal(text, 'Um gato laranja.');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cwd, dir);
  assert.equal(calls[0].bin, 'cli');
  assert.equal(calls[0].timeoutMs, 5000);
  assert.deepEqual(calls[0].args, ['--fake', 'vision']);
  assert.equal(calls[0].req.model, 'v');
  assert.equal(calls[0].req.effort, 'low'); // vision sem esforço próprio herda o do web
  assert.equal(calls[0].req.workDir, dir);
  assert.match(calls[0].prompt, new RegExp(file.replace(/[\\.]/g, '\\$&')));
  assert.match(calls[0].prompt, /"que raça é\?"/);
  assert.match(calls[0].prompt, /contexto recente do canal[^]*- Ana: olha meu gato\n- Bot: bonito/i);
  assert.ok(calls[0].prompt.indexOf('- Ana:') < calls[0].prompt.indexOf('que raça é?'), 'contexto vem antes da pergunta');
  assert.equal(fs.existsSync(file), false);
  fs.rmSync(dir, { recursive: true });
});

test('describeImage: corta em maxChars, trata ERRO: e isError como falha, apaga o arquivo mesmo assim', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'm-1.png');
  const backend = { buildRequest: (req) => ({ args: [], prompt: req.prompt }), run: null };
  const config = { bin: 'cli', model: {}, effort: {}, images: { maxChars: 5, timeoutMs: 5000 } };

  fs.writeFileSync(file, 'x');
  backend.run = async () => ({ text: 'abcdefgh', isError: false });
  assert.equal(await describeImage({ file, backend, config }), 'abcde');

  fs.writeFileSync(file, 'x');
  backend.run = async () => ({ text: 'ERRO: arquivo corrompido', isError: false });
  await assert.rejects(describeImage({ file, backend, config }), /arquivo corrompido/);
  assert.equal(fs.existsSync(file), false);

  fs.writeFileSync(file, 'x');
  backend.run = async () => ({ text: 'limite', isError: true, subtype: 'max_turns' });
  await assert.rejects(describeImage({ file, backend, config }), /max_turns/);

  fs.writeFileSync(file, 'x');
  backend.run = async () => ({ text: '', isError: false });
  await assert.rejects(describeImage({ file, backend, config }), /vazia/);
  fs.rmSync(dir, { recursive: true });
});

test('formatImage: bloco por origem, com descrição ou erro', () => {
  assert.equal(formatImage({ source: 'anexo', name: 'print.png', description: 'Uma tela.' }), '[imagem anexada "print.png": Uma tela.]');
  assert.equal(formatImage({ source: 'link', name: 'https://x/a.png', description: 'Um gato.' }), '[imagem do link https://x/a.png: Um gato.]');
  assert.equal(formatImage({ source: 'citada', name: 'foto.jpg', description: 'Praia.' }), '[imagem na mensagem citada "foto.jpg": Praia.]');
  assert.equal(formatImage({ source: 'link citado', name: 'https://x/b.png', description: 'Mapa.' }), '[imagem do link na mensagem citada https://x/b.png: Mapa.]');
  assert.equal(formatImage({ source: 'anexo', name: 'x.png', error: 'tempo esgotado' }), '[imagem anexada "x.png": não foi possível analisar (tempo esgotado)]');
});

test('analyzeImages: um resultado por imagem, em sequência; falha de uma não derruba as outras', async () => {
  const dir = tmpDir();
  const hints = [];
  const backend = {
    buildRequest: (req) => ({ args: [], prompt: req.prompt }),
    run: async ({ prompt }) => {
      hints.push(prompt);
      return { text: prompt.includes('-2.png') ? 'ERRO: ilegível' : 'Descrição ok.', isError: false };
    },
  };
  const config = { bin: 'cli', model: {}, effort: {}, images: { maxBytes: 100, maxChars: 8000, timeoutMs: 5000 } };
  const fetchImpl = async (url) => (url.endsWith('/3') ? new Response('', { status: 500 }) : new Response(Buffer.from([1]), { headers: { 'content-type': 'image/png' } }));
  const images = [
    { source: 'anexo', name: 'a.png', url: 'https://x/1' },
    { source: 'link', name: 'https://x/2', url: 'https://x/2' },
    { source: 'citada', name: 'c.png', url: 'https://x/3' },
  ];
  const seen = [];
  const results = await analyzeImages(images, { dir, fileBase: 'm', hint: 'oi', backend, config, fetchImpl, onResult: (r) => seen.push(r.name) });
  assert.deepEqual(results, [
    { source: 'anexo', name: 'a.png', description: 'Descrição ok.' },
    { source: 'link', name: 'https://x/2', error: 'ilegível' },
    { source: 'citada', name: 'c.png', error: 'HTTP 500 ao baixar https://x/3' },
  ]);
  assert.deepEqual(seen, ['a.png', 'https://x/2', 'c.png']);
  assert.equal(hints.length, 2);
  assert.match(hints[0], /"oi"/);
  assert.deepEqual(fs.readdirSync(dir), []);
  fs.rmSync(dir, { recursive: true });
});
