import { DatabaseSync } from 'node:sqlite';
import { MessageFlags } from 'discord.js';
import { splitMessage } from './split.js';

export const MAX_USER_PROMPT_LENGTH = 2000;

export function createUserPromptStore(filePath, { onError = console.error } = {}) {
  const db = new DatabaseSync(filePath);
  db.exec(`CREATE TABLE IF NOT EXISTS user_prompts (
    user_id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  const upsert = db.prepare('INSERT INTO user_prompts (user_id, prompt, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET prompt = excluded.prompt, updated_at = excluded.updated_at');
  const selectOne = db.prepare('SELECT prompt, updated_at FROM user_prompts WHERE user_id = ?');
  const selectAll = db.prepare("SELECT user_id, prompt FROM user_prompts WHERE prompt <> '' ORDER BY updated_at DESC, user_id");
  const guard = (fn, fallback) => {
    try {
      return fn();
    } catch (err) {
      onError(`falha no user-prompts.db: ${err.message}`);
      return fallback;
    }
  };

  return {
    get: (userId) => guard(() => selectOne.get(userId)?.prompt || undefined, undefined),
    getState: (userId) => guard(() => {
      const row = selectOne.get(userId);
      return { prompt: row?.prompt || undefined, updatedAt: row?.updated_at };
    }, { prompt: undefined, updatedAt: undefined }),
    set: (userId, prompt, now = Date.now()) => {
      if (typeof prompt !== 'string' || !prompt.trim() || Array.from(prompt).length > MAX_USER_PROMPT_LENGTH) return false;
      return guard(() => {
        if (selectOne.get(userId)?.prompt !== prompt) upsert.run(userId, prompt, now);
        return true;
      }, false);
    },
    // Guarda a data da remoção para invalidar sessões antigas após reinícios.
    clear: (userId, now = Date.now()) => guard(() => {
      if (selectOne.get(userId)?.prompt) upsert.run(userId, '', now);
      return true;
    }, false),
    list: () => guard(() => selectAll.all().map((row) => ({ userId: row.user_id, prompt: row.prompt })), []),
  };
}

export function formatPromptList(rows) {
  if (rows.length === 0) return 'Ninguém definiu um prompt personalizado.';
  return 'Prompts personalizados completos:\n\n'
    + rows.map(({ userId, prompt }) => `<@${userId}>:\n${prompt}`).join('\n\n');
}

export async function replyPromptList(interaction, rows, { onError = () => {} } = {}) {
  const content = formatPromptList(rows);
  const allowedMentions = { parse: [] };
  if (content.length <= 2000) {
    await interaction.reply({ content, allowedMentions, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    for (const part of splitMessage(content)) {
      await interaction.user.send({ content: part, allowedMentions });
    }
  } catch (error) {
    onError(error);
    await interaction.editReply({ content: 'Não consegui enviar a lista completa no privado. Habilite mensagens diretas deste servidor e tente /prompt-list novamente.', allowedMentions });
    return;
  }
  await interaction.editReply({ content: 'Enviei os prompts completos no seu privado.', allowedMentions });
}
