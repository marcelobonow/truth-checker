import fs from 'node:fs';

// Guarda, por chave (servidor), a sessão do Claude num JSON em disco, para o
// contexto sobreviver a reinícios do bot:
//   { "<chave>": { id, messages, lastUsed, contextTokens } }
// `messages` = total de mensagens já enviadas ao Claude nessa sessão (lote +
// contexto); `lastUsed` = timestamp do último uso; `contextTokens` = tamanho
// do contexto na última rodada. Usados no reinício automático.
export function createSessionStore(filePath, { onError = console.error } = {}) {
  const sessions = load(filePath);

  // Falha de gravação (arquivo travado, sem permissão) não pode derrubar a
  // resposta já pronta: o valor fica em memória e a falha só é registrada.
  const save = () => {
    try {
      fs.writeFileSync(filePath, JSON.stringify(sessions, null, 2));
    } catch (err) {
      onError(`não consegui gravar ${filePath}: ${err.message}`);
    }
  };

  return {
    get: (key) => sessions[key]?.id,
    info: (key) => sessions[key],
    set(key, id) {
      if (sessions[key]?.id === id) return;
      sessions[key] = { id, messages: 0, lastUsed: Date.now(), contextTokens: 0 };
      save();
    },
    touch(key, addedMessages, now = Date.now(), contextTokens) {
      const entry = sessions[key];
      if (!entry) return;
      entry.messages += addedMessages;
      entry.lastUsed = now;
      if (contextTokens != null) entry.contextTokens = contextTokens;
      save();
    },
    clear(key) {
      delete sessions[key];
      save();
    },
    // Devolve quantas sessões foram apagadas.
    clearAll() {
      const count = Object.keys(sessions).length;
      for (const key of Object.keys(sessions)) delete sessions[key];
      save();
      return count;
    },
  };
}

function load(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return {};
    // formato antigo: valor era só o id
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') parsed[key] = { id: value, messages: 0, lastUsed: Date.now() };
    }
    return parsed;
  } catch {
    return {};
  }
}
