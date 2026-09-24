import { DatabaseSync } from 'node:sqlite';

// Escolha de modelo por usuário (/model e /model-list; design em
// docs/model-selector.md). Quem tem linha em user_models saiu do modelo padrão
// (MODEL.<modo> de settings.<backend>.js); sem linha = usa o padrão. Guardado
// em SQLite local (models.db), que NÃO entra no RESET_ON_START: escolha de
// modelo é preferência, não contexto de conversa.

// Valor do /model que apaga a escolha e volta ao modelo das settings.
export const DEFAULT_MODEL_CHOICE = 'padrão';

// Entradas de MODEL_CHOICES (settings.<backend>.js): `{ model, effort?, nome? }`
// (uma string vira `{ model }`). `effort` fixa o --effort daquela escolha
// (esforços válidos dependem do modelo), `nome` é o rótulo no dropdown, no
// /model-list e no log. Duas entradas podem ter o mesmo modelo com esforços
// diferentes (ex.: gpt-6-luna "low" e "sem thinking").
export function normalizeChoices(list = []) {
  return list
    .map((entry) => (typeof entry === 'string' ? { model: entry } : entry))
    .filter((entry) => entry && entry.model && entry.model !== DEFAULT_MODEL_CHOICE);
}

// Valor único por entrada: o que o Discord devolve e o banco guarda
// ("model" ou "model:effort"). Ids com ":" (ex.: ling-3.0-flash-sante:free)
// sem esforço ficam intactos.
export function choiceValue({ model, effort }) {
  return effort ? `${model}:${effort}` : model;
}

export function choiceName({ model, effort, nome }) {
  return nome ?? (effort ? `${model} (${effort})` : model);
}

export function createModelStore(filePath, { onError = console.error } = {}) {
  // Abertura que falha (sem permissão, caminho inválido) propaga o erro: o bot
  // encerra na inicialização com a mensagem (index.js).
  const db = new DatabaseSync(filePath);
  db.exec(`CREATE TABLE IF NOT EXISTS user_models (
    user_id TEXT PRIMARY KEY,
    model TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  const upsert = db.prepare(
    'INSERT INTO user_models (user_id, model, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET model = excluded.model, updated_at = excluded.updated_at',
  );
  const remove = db.prepare('DELETE FROM user_models WHERE user_id = ?');
  const selectOne = db.prepare('SELECT model FROM user_models WHERE user_id = ?');
  const selectAll = db.prepare('SELECT user_id, model, updated_at FROM user_models ORDER BY updated_at DESC');

  // Falha de banco não derruba a resposta pronta: vira log (onError) e o valor
  // seguro do fallback (set devolve false para o comando avisar quem chamou).
  const guard = (fn, fallback) => {
    try {
      return fn();
    } catch (err) {
      onError(`falha no models.db: ${err.message}`);
      return fallback;
    }
  };

  return {
    get: (userId) => guard(() => selectOne.get(userId)?.model, undefined),
    set: (userId, model, now = Date.now()) => guard(() => {
      upsert.run(userId, model, now);
      return true;
    }, false),
    clear: (userId) => guard(() => {
      remove.run(userId);
      return true;
    }, false),
    // [{ userId, model, updatedAt }] de quem mudou do padrão, mais recente primeiro.
    list: () => guard(() => selectAll.all().map((row) => ({ userId: row.user_id, model: row.model, updatedAt: row.updated_at })), []),
  };
}

// Texto do /model-list: só quem escolheu modelo aparece (docs/model-selector.md).
export function formatModelList(rows) {
  if (rows.length === 0) return 'Ninguém escolheu um modelo: todos usam o padrão.';
  return ['Quem saiu do modelo padrão:', ...rows.map((r) => `- <@${r.userId}> → ${r.model}`)].join('\n');
}
