import { DatabaseSync } from 'node:sqlite';

export const MAX_USER_PROMPT_LENGTH = 1000;

export function createUserPromptStore(filePath, { onError = console.error } = {}) {
  const db = new DatabaseSync(filePath);
  db.exec(`CREATE TABLE IF NOT EXISTS user_prompts (
    user_id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  const upsert = db.prepare('INSERT INTO user_prompts (user_id, prompt, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET prompt = excluded.prompt, updated_at = excluded.updated_at');
  const remove = db.prepare('DELETE FROM user_prompts WHERE user_id = ?');
  const selectOne = db.prepare('SELECT prompt FROM user_prompts WHERE user_id = ?');
  const selectAll = db.prepare('SELECT user_id, prompt FROM user_prompts ORDER BY updated_at DESC, user_id');
  const guard = (fn, fallback) => {
    try {
      return fn();
    } catch (err) {
      onError(`falha no user-prompts.db: ${err.message}`);
      return fallback;
    }
  };

  return {
    get: (userId) => guard(() => selectOne.get(userId)?.prompt, undefined),
    set: (userId, prompt, now = Date.now()) => {
      if (typeof prompt !== 'string' || !prompt.trim() || Array.from(prompt).length > MAX_USER_PROMPT_LENGTH) return false;
      return guard(() => { upsert.run(userId, prompt, now); return true; }, false);
    },
    clear: (userId) => guard(() => { remove.run(userId); return true; }, false),
    list: () => guard(() => selectAll.all().map((row) => ({ userId: row.user_id, prompt: row.prompt })), []),
  };
}

export function formatPromptListPages(rows) {
  if (rows.length === 0) return ['Ninguém definiu um prompt personalizado.'];
  const pages = [];
  let page = 'Quem definiu um prompt personalizado:';
  for (const { userId, prompt } of rows) {
    const characters = Array.from(prompt.replace(/\s+/g, ' '));
    const preview = characters.slice(0, 25).join('').replace(/[\\*_`~|>]/g, '\\$&');
    const line = `\n- <@${userId}> → ${preview}${characters.length > 25 ? '…' : ''}`;
    if (page.length + line.length > 2000) {
      pages.push(page);
      page = 'Continuação:';
    }
    page += line;
  }
  pages.push(page);
  return pages;
}
