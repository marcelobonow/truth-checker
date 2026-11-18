import { DatabaseSync } from 'node:sqlite';

export const USER_TIERS = Object.freeze(['free', 'vip', 'premium']);
const MICROS_PER_USD = 1_000_000;
const monthFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit',
});

export function readQuotaSettings(env) {
  const amount = (key, fallback) => {
    const value = Number(env[key]?.trim() || fallback);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${key} deve ser um valor positivo em USD`);
    return value;
  };
  const limits = {
    free: amount('QUOTA_FREE_USD', 1),
    vip: amount('QUOTA_VIP_USD', 5),
    premium: amount('QUOTA_PREMIUM_USD', 15),
  };
  if (!(limits.free < limits.vip && limits.vip < limits.premium)) {
    throw new Error('As cotas precisam seguir QUOTA_FREE_USD < QUOTA_VIP_USD < QUOTA_PREMIUM_USD');
  }
  return {
    limits,
    rates: {
      input: amount('QUOTA_INPUT_USD_PER_MILLION', 3),
      output: amount('QUOTA_OUTPUT_USD_PER_MILLION', 15),
      missingUsage: amount('QUOTA_MISSING_USAGE_USD', 0.01),
    },
  };
}

export function estimateCostUsd({ costUsd, tokenUsage = [] }, rates) {
  if (Number.isFinite(costUsd) && costUsd >= 0) return costUsd;
  const tokens = (value) => Number.isFinite(value) && value > 0 ? value : 0;
  const weightedTokens = tokenUsage.reduce((sum, usage) => (
    sum + tokens(usage.inputTokens) * rates.input + tokens(usage.outputTokens) * rates.output
  ), 0);
  return weightedTokens > 0 ? weightedTokens / 1_000_000 : rates.missingUsage;
}

export function createUserQuotaStore(filePath, limits) {
  const db = new DatabaseSync(filePath);
  db.exec(`CREATE TABLE IF NOT EXISTS user_quotas (
    user_id TEXT PRIMARY KEY,
    tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN (${USER_TIERS.map((tier) => `'${tier}'`).join(', ')})),
    month TEXT,
    spent_microusd INTEGER NOT NULL DEFAULT 0
  )`);
  const select = db.prepare('SELECT tier, month, spent_microusd FROM user_quotas WHERE user_id = ?');
  const topUsers = db.prepare(`SELECT user_id, tier, month, spent_microusd FROM user_quotas
    ORDER BY CASE WHEN month = ? THEN spent_microusd ELSE 0 END DESC, user_id
    LIMIT 20`);
  const insert = db.prepare('INSERT INTO user_quotas (user_id) VALUES (?)');
  const updateUsage = db.prepare(`UPDATE user_quotas
    SET spent_microusd = CASE WHEN month = :month THEN spent_microusd ELSE 0 END + :cost, month = :month
    WHERE user_id = :userId`);
  const upsertTier = db.prepare(`INSERT INTO user_quotas (user_id, tier) VALUES (?, ?)
    ON CONFLICT (user_id) DO UPDATE SET tier = excluded.tier`);

  const snapshot = (row, month) => {
    const tier = row?.tier ?? 'free';
    return {
      tier, month, limitUsd: limits[tier],
      spentUsd: row?.month === month ? row.spent_microusd / MICROS_PER_USD : 0,
    };
  };

  return {
    get(userId, now = Date.now()) {
      const row = select.get(userId);
      if (!row) insert.run(userId);
      return snapshot(row, monthFormatter.format(now));
    },
    inspect(userId, now = Date.now()) {
      return snapshot(select.get(userId), monthFormatter.format(now));
    },
    list(now = Date.now()) {
      const month = monthFormatter.format(now);
      return topUsers.all(month).map((row) => ({ userId: row.user_id, ...snapshot(row, month) }));
    },
    addUsage(userId, month, costUsd) {
      if (costUsd === 0) return;
      const cost = Math.max(1, Math.round(costUsd * MICROS_PER_USD));
      updateUsage.run({ month, cost, userId });
    },
    setTier: (userId, tier) => upsertTier.run(userId, tier),
    close: () => db.close(),
  };
}
