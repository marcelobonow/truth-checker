import fs from 'node:fs';
import path from 'node:path';

// Imagens que o bot analisa (ver docs/superpowers/specs/2026-09-18-analise-imagem-design.md):
// só quando quem está na whitelist marca o bot explicitamente, anexadas à
// mensagem, linkadas nela, ou na mensagem citada (reply). A análise é uma
// chamada separada do CLI em modo "vision", e a descrição em texto entra no
// prompt no lugar da imagem.

const TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
const EXTENSIONS = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const LINK_RE = /https?:\/\/[^\s<>]+/g;

// Anexos do Discord que servem: tipo de imagem aceito e tamanho até maxBytes,
// na ordem, até `max`. Os demais voltam em `rejected` com o motivo (para o log).
export function pickImages(attachments, { max, maxBytes }) {
  const images = [];
  const rejected = [];
  for (const a of attachments) {
    const type = a.contentType ?? EXTENSIONS[path.extname(a.name ?? '').toLowerCase()];
    if (!TYPES[type]) rejected.push({ name: a.name, reason: `tipo ${type ?? 'desconhecido'}` });
    else if (a.size > maxBytes) rejected.push({ name: a.name, reason: `acima de ${maxBytes} bytes` });
    else if (images.length >= max) rejected.push({ name: a.name, reason: `passou de ${max} imagens` });
    else images.push({ id: a.id, url: a.url, name: a.name, contentType: type, size: a.size });
  }
  return { images, rejected };
}

// Links diretos de imagem no texto (caminho da URL termina em extensão de
// imagem; query string ignorada). Não depende do embed do Discord, que chega
// depois da mensagem.
export function imageLinks(rawContent) {
  const links = [];
  for (const raw of (rawContent ?? '').match(LINK_RE) ?? []) {
    const url = raw.replace(/[>)\]]+$/, ''); // <url> ou (url) no texto
    try {
      if (EXTENSIONS[path.extname(new URL(url).pathname).toLowerCase()]) links.push(url);
    } catch {
      // URL inválida: ignora
    }
  }
  return links;
}

// Imagens a analisar de uma mensagem nova (`message`) e da que ela cita
// (`reference`, opcional): anexos, links, anexos da citada, links da citada,
// no máximo `max` no total. Vazio sem menção explícita ou fora da whitelist.
export function collectImages({ message, reference = null, mentionsBot, isTarget, limits }) {
  if (!mentionsBot || !isTarget) return { images: [], rejected: [] };
  const candidates = [];
  const rejected = [];
  const add = (msg, attachmentSource, linkSource) => {
    if (!msg) return;
    const picked = pickImages([...msg.attachments.values()], { max: Infinity, maxBytes: limits.maxBytes });
    rejected.push(...picked.rejected);
    candidates.push(...picked.images.map((i) => ({ ...i, source: attachmentSource })));
    candidates.push(...imageLinks(msg.content).map((url) => ({ url, name: url, source: linkSource })));
  };
  add(message, 'anexo', 'link');
  add(reference, 'citada', 'link citado');
  const images = candidates.slice(0, limits.max);
  for (const extra of candidates.slice(limits.max)) rejected.push({ name: extra.name, reason: `passou de ${limits.max} imagens` });
  return { images, rejected };
}

// Baixa a imagem para `<dir>/<fileName><ext>` (ext pelo Content-Type) e
// devolve o caminho. Recusa resposta que não é imagem ou corpo acima de maxBytes.
export async function download({ url }, { dir, fileName, maxBytes, fetchImpl = fetch }) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar ${url}`);
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  const ext = TYPES[type];
  if (!ext) throw new Error(`não é imagem (${type || 'sem Content-Type'}): ${url}`);
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > maxBytes) throw new Error(`acima de ${maxBytes} bytes: ${url}`);
    chunks.push(chunk);
  }
  const file = path.join(dir, `${fileName}${ext}`);
  fs.writeFileSync(file, Buffer.concat(chunks));
  return file;
}

// Uma chamada do CLI em modo vision (só ferramenta de leitura, cwd = pasta da
// imagem, sem sessão) que devolve a descrição em texto. `hint`: o que o autor
// escreveu junto, para a descrição focar nisso; `context`: mensagens recentes
// do canal ({ authorName, content }, mais antiga primeiro), para o analisador
// entender do que estão falando. Apaga o arquivo ao terminar.
export async function describeImage({ file, hint = '', context = [], backend, config, signal }) {
  const dir = path.dirname(file);
  const parts = [];
  if (context.length > 0) {
    parts.push('Contexto recente do canal do Discord onde a imagem foi mandada (mais antigo primeiro), só para você entender do que estão falando:');
    parts.push(...context.map((m) => `- ${m.authorName}: ${m.content}`));
  }
  // a pergunta do autor vem antes do pedido: é o que a descrição precisa responder
  if (hint.trim()) parts.push(`O autor escreveu junto com a imagem: "${hint.trim()}". Comece respondendo a isso, com o máximo de detalhes que a imagem permite, e depois descreva tudo o mais.`);
  parts.push(`Descreva a imagem em ${file}, de forma longa e minuciosa, seguindo as seções do seu prompt.`);
  const prompt = parts.join('\n');
  try {
    const res = await backend.run({
      ...backend.buildRequest({
        mode: 'vision',
        workDir: dir,
        model: config.model?.vision ?? config.model?.web,
        effort: config.effort?.vision ?? config.effort?.web,
        prompt,
      }),
      cwd: dir,
      bin: config.bin,
      timeoutMs: config.images.timeoutMs,
      signal,
    });
    const text = (res.text ?? '').trim();
    if (res.isError) throw new Error(`${res.subtype ?? 'erro'}: ${text.slice(0, 200)}`);
    if (/^ERRO:/i.test(text)) throw new Error(text.replace(/^ERRO:\s*/i, ''));
    if (!text) throw new Error('descrição vazia');
    return text.slice(0, config.images.maxChars);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

// Baixa e descreve cada imagem, em sequência. Devolve um resultado por imagem:
// { source, name, description } ou { source, name, error } (o modelo fica
// sabendo que havia uma imagem que não deu para ler).
export async function analyzeImages(images, { dir, fileBase, hint, context, backend, config, fetchImpl, onResult = () => { } }) {
  const results = [];
  for (const [i, image] of images.entries()) {
    const started = Date.now();
    let result;
    try {
      const file = await download(image, { dir, fileName: `${fileBase}-${i + 1}`, maxBytes: config.images.maxBytes, fetchImpl });
      const description = await describeImage({ file, hint, context, backend, config });
      result = { source: image.source, name: image.name, description };
    } catch (err) {
      result = { source: image.source, name: image.name, error: err.message };
    }
    onResult(result, (Date.now() - started) / 1000);
    results.push(result);
  }
  return results;
}

// Bloco que entra na mensagem nova no lugar da imagem.
const LABELS = {
  anexo: (name) => `imagem anexada "${name}"`,
  link: (name) => `imagem do link ${name}`,
  citada: (name) => `imagem na mensagem citada "${name}"`,
  'link citado': (name) => `imagem do link na mensagem citada ${name}`,
};

export function formatImage({ source, name, description, error }) {
  const body = error ? `não foi possível analisar (${error})` : description;
  return `[${LABELS[source](name)}: ${body}]`;
}
