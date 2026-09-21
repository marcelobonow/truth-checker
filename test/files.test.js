import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { isReadableFile, pickFiles, collectFiles, readFile, readFiles, formatFile, rejectedNonImages } from '../src/files.js';

const att = (name, overrides = {}) => ({ id: name, name, url: `https://x/${name}`, size: 10, contentType: null, ...overrides });
const limits = { max: 2, maxBytes: 100, maxChars: 20 };
const fakeFetch = (body, headers = { 'content-type': 'text/plain' }) => async () => new Response(body, { headers });

test('isReadableFile e pickFiles: aceita texto, Word, PDF e ODT respeitando limites', () => {
  for (const name of ['dados.csv', 'texto.doc', 'texto.docx', 'arquivo.pdf', 'texto.odt']) assert.equal(isReadableFile(att(name)), true, name);
  assert.equal(isReadableFile(att('foto.png', { contentType: 'image/png' })), false);
  const { files, rejected } = pickFiles([att('a.txt'), att('b.pdf'), att('c.odt'), att('foto.png'), att('grande.txt', { size: 101 })], limits);
  assert.deepEqual(files.map((f) => f.name), ['a.txt', 'b.pdf']);
  assert.ok(rejected.some((f) => f.name === 'c.odt' && f.reason.includes('passou')));
  assert.ok(rejected.some((f) => f.name === 'foto.png'));
  assert.ok(rejected.some((f) => f.name === 'grande.txt'));
});

test('collectFiles: só whitelist em conversa dirigida ao bot; inclui anexo e citada', () => {
  const message = { attachments: new Map([['a', att('a.txt')]]) };
  const reference = { attachments: new Map([['b', att('b.csv')]]) };
  assert.equal(collectFiles({ message, reference, directedToBot: false, isTarget: true, limits }).files.length, 0);
  assert.equal(collectFiles({ message, reference, directedToBot: true, isTarget: false, limits }).files.length, 0);
  const { files } = collectFiles({ message, reference, directedToBot: true, isTarget: true, limits });
  assert.deepEqual(files.map((f) => [f.name, f.source]), [['a.txt', 'anexo'], ['b.csv', 'citada']]);
});

test('readFile: lê texto, ODT e aplica corte', async () => {
  assert.equal(await readFile(att('a.txt'), { ...limits, fetchImpl: fakeFetch('olá') }), 'olá');
  assert.match(await readFile(att('a.txt'), { ...limits, fetchImpl: fakeFetch('x'.repeat(30)) }), /arquivo cortado em 20 caracteres/);
  const zip = new JSZip();
  zip.file('content.xml', '<office:document-content><text:p>Olá <text:span>mundo</text:span></text:p></office:document-content>');
  const odt = await zip.generateAsync({ type: 'nodebuffer' });
  assert.match(await readFile(att('a.odt'), { ...limits, maxBytes: 10_000, fetchImpl: fakeFetch(odt, { 'content-type': 'application/vnd.oasis.opendocument.text' }) }), /Olá mundo/);
});

test('readFiles e formatFile: mantém um resultado por arquivo e bloco do prompt', async () => {
  const files = [{ ...att('a.txt'), source: 'anexo' }, { ...att('b.csv'), source: 'citada' }];
  const results = await readFiles(files, { limits, fetchImpl: fakeFetch('conteúdo') });
  assert.equal(results.length, 2);
  assert.equal(formatFile(results[0]), '[arquivo anexado "a.txt" (.txt):\nconteúdo\n]');
  assert.match(formatFile({ source: 'citada', name: 'b.csv', error: 'HTTP 404' }), /arquivo na mensagem citada "b.csv" \(.csv\)/);
});

test('rejectedNonImages: avisa sobre vídeo e outros formatos, mas deixa imagens no fluxo visual', () => {
  const rejected = [
    { name: 'video.mp4', contentType: 'video/mp4', reason: 'tipo video/mp4' },
    { name: 'foto.png', contentType: 'image/png', reason: 'tipo image/png' },
  ];
  assert.deepEqual(rejectedNonImages(rejected).map((file) => file.name), ['video.mp4']);
  assert.match(formatFile({ ...rejected[0], source: 'anexo', error: rejected[0].reason }), /"video.mp4" \(.mp4\).*não foi possível ler/s);
});
