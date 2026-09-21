import JSZip from 'jszip';
import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';
import { PDFParse } from 'pdf-parse';
import path from 'node:path';

// Arquivos cujo conteúdo o bot pode extrair sem executar nada. O conteúdo é
// limitado antes de entrar no prompt; PDFs/imagens escaneados sem texto não
// recebem OCR neste fluxo.
const EXTENSIONS = new Set([
  '.txt', '.csv', '.tsv', '.md', '.markdown', '.json', '.jsonl', '.log',
  '.yaml', '.yml', '.xml', '.ini', '.conf', '.cfg', '.toml', '.properties',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.php', '.java',
  '.c', '.h', '.cpp', '.cs', '.go', '.rs', '.sh', '.ps1', '.sql', '.html',
  '.css', '.scss', '.svg', '.doc', '.docx', '.pdf', '.odt',
]);
const TYPES = new Set([
  'application/json', 'application/ld+json', 'application/xml',
  'application/javascript', 'application/sql', 'application/x-yaml',
  'application/yaml', 'application/toml', 'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
]);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

const typeOf = (value) => (value ?? '').split(';')[0].trim().toLowerCase();
const extensionOf = (name) => path.extname(name ?? '').toLowerCase();

function isImageFile({ name = '', contentType } = {}) {
  return IMAGE_EXTENSIONS.has(extensionOf(name)) || typeOf(contentType).startsWith('image/');
}

export function isReadableFile({ name = '', contentType } = {}) {
  return EXTENSIONS.has(extensionOf(name)) || TYPES.has(typeOf(contentType)) || typeOf(contentType).startsWith('text/');
}

export function pickFiles(attachments, { max, maxBytes }) {
  const files = [];
  const rejected = [];
  for (const attachment of attachments) {
    if (!isReadableFile(attachment)) rejected.push({ name: attachment.name, contentType: attachment.contentType, reason: `tipo ${attachment.contentType ?? 'desconhecido'}` });
    else if (attachment.size > maxBytes) rejected.push({ name: attachment.name, contentType: attachment.contentType, reason: `acima de ${maxBytes} bytes` });
    else if (files.length >= max) rejected.push({ name: attachment.name, contentType: attachment.contentType, reason: `passou de ${max} arquivos` });
    else files.push({ id: attachment.id, url: attachment.url, name: attachment.name, contentType: attachment.contentType, size: attachment.size });
  }
  return { files, rejected };
}

export function collectFiles({ message, reference = null, directedToBot, isTarget, limits }) {
  if (!directedToBot || !isTarget) return { files: [], rejected: [] };
  const candidates = [];
  const rejected = [];
  const add = (msg, source) => {
    if (!msg) return;
    const picked = pickFiles([...msg.attachments.values()], { max: Infinity, maxBytes: limits.maxBytes });
    rejected.push(...picked.rejected.map((file) => ({ ...file, source })));
    candidates.push(...picked.files.map((file) => ({ ...file, source })));
  };
  add(message, 'anexo');
  add(reference, 'citada');
  const files = candidates.slice(0, limits.max);
  for (const file of candidates.slice(limits.max)) rejected.push({ name: file.name, source: file.source, contentType: file.contentType, reason: `passou de ${limits.max} arquivos` });
  return { files, rejected };
}

async function download(file, { maxBytes, fetchImpl }) {
  const res = await fetchImpl(file.url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar ${file.url}`);
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > maxBytes) throw new Error(`acima de ${maxBytes} bytes: ${file.url}`);
    chunks.push(chunk);
  }
  return { body: Buffer.concat(chunks), contentType: typeOf(res.headers.get('content-type')) };
}

function decodeText(body) {
  if (body.includes(0)) throw new Error('conteúdo binário');
  return new TextDecoder('utf-8').decode(body).replace(/^\uFEFF/, '');
}

async function extractOdt(body) {
  const zip = await JSZip.loadAsync(body);
  const content = zip.file('content.xml');
  if (!content) throw new Error('ODT sem content.xml');
  const xml = await content.async('string');
  return xml
    .replace(/<text:tab[^>]*\/>/g, '\t')
    .replace(/<text:line-break[^>]*\/>/g, '\n')
    .replace(/<\/text:(?:p|h|list-item)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

async function extractDocument(body, file, contentType) {
  const ext = extensionOf(file.name);
  if (ext === '.pdf' || contentType === 'application/pdf') {
    const parser = new PDFParse({ data: body });
    try { return (await parser.getText()).text; } finally { await parser.destroy(); }
  }
  if (ext === '.docx' || contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return (await mammoth.extractRawText({ buffer: body })).value;
  if (ext === '.doc' || contentType === 'application/msword') return (await new WordExtractor().extract(body)).getBody();
  if (ext === '.odt' || contentType === 'application/vnd.oasis.opendocument.text') return extractOdt(body);
  return decodeText(body);
}

export async function readFile(file, { maxBytes, maxChars, fetchImpl = fetch }) {
  const { body, contentType } = await download(file, { maxBytes, fetchImpl });
  if (!isReadableFile({ name: file.name, contentType })) throw new Error(`não é arquivo legível (${contentType || 'sem Content-Type'})`);
  const text = await extractDocument(body, file, contentType);
  if (!text.trim()) throw new Error('arquivo não contém texto extraível');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[... arquivo cortado em ${maxChars} caracteres ...]` : text;
}

export async function readFiles(files, { limits, fetchImpl, onResult = () => {} }) {
  const results = [];
  for (const file of files) {
    const started = Date.now();
    let result;
    try { result = { source: file.source, name: file.name, contentType: file.contentType, text: await readFile(file, { ...limits, fetchImpl }) }; }
    catch (err) { result = { source: file.source, name: file.name, contentType: file.contentType, error: err.message }; }
    onResult(result, (Date.now() - started) / 1000);
    results.push(result);
  }
  return results;
}

export function formatFile({ source, name, contentType, text, error }) {
  const label = source === 'citada' ? 'arquivo na mensagem citada' : 'arquivo anexado';
  const body = error ? `não foi possível ler (${error})` : text;
  const format = extensionOf(name) || typeOf(contentType) || 'formato desconhecido';
  return `[${label} "${name}" (${format}):\n${body}\n]`;
}

// Imagens têm o fluxo próprio (src/images.js), logo não devem aparecer como
// "arquivo ilegível" junto da descrição visual.
export function rejectedNonImages(rejected) {
  return rejected.filter((file) => !isImageFile(file));
}
