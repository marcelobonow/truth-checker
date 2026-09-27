import { DatabaseSync } from 'node:sqlite';

const HOUR_MS = 60 * 60 * 1000;
const hourStart = (timestamp) => Math.floor(timestamp / HOUR_MS) * HOUR_MS;
const known = (value) => value == null ? null : Number(value);
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'local';
const localDay = (timestamp) => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const shiftLocalDay = (day, amount) => {
  const [year, month, date] = day.split('-').map(Number);
  const shifted = new Date(year, month - 1, date + amount);
  return localDay(shifted.getTime());
};

function eachLocalDaySegment(from, to, callback) {
  let cursor = from;
  while (cursor < to) {
    const start = new Date(cursor);
    start.setHours(0, 0, 0, 0);
    const endOfDay = new Date(start);
    endOfDay.setDate(endOfDay.getDate() + 1);
    const end = Math.min(to, endOfDay.getTime());
    if (end <= cursor) break;
    callback(localDay(cursor), end - cursor);
    cursor = end;
  }
}

function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function createMonitor(filePath, { onError = console.error } = {}) {
  const db = new DatabaseSync(filePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 3000;

    CREATE TABLE IF NOT EXISTS connection_samples (
      sampled_at INTEGER PRIMARY KEY,
      connected INTEGER NOT NULL,
      ping_ms REAL,
      heartbeat_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS connection_outages (
      id INTEGER PRIMARY KEY,
      shard_id INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      cause TEXT,
      end_reason TEXT
    );
    CREATE TABLE IF NOT EXISTS connection_episodes (
      id INTEGER PRIMARY KEY,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      last_accounted_at INTEGER NOT NULL,
      cause TEXT,
      end_reason TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS connection_episodes_one_open
      ON connection_episodes(ended_at) WHERE ended_at IS NULL;
    CREATE TABLE IF NOT EXISTS connection_episode_days (
      episode_id INTEGER NOT NULL REFERENCES connection_episodes(id),
      local_day TEXT NOT NULL,
      time_zone TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (episode_id, local_day, time_zone)
    );
    CREATE TABLE IF NOT EXISTS daily_connection_metrics (
      local_day TEXT NOT NULL,
      time_zone TEXT NOT NULL,
      disconnections_count INTEGER NOT NULL DEFAULT 0,
      disconnected_ms_sum INTEGER NOT NULL DEFAULT 0,
      max_contiguous_ms INTEGER NOT NULL DEFAULT 0,
      max_episode_ms INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (local_day, time_zone)
    );
    CREATE TABLE IF NOT EXISTS daily_token_totals (
      local_day TEXT NOT NULL,
      time_zone TEXT NOT NULL,
      input_tokens_sum INTEGER NOT NULL DEFAULT 0,
      input_token_records INTEGER NOT NULL DEFAULT 0,
      output_tokens_sum INTEGER NOT NULL DEFAULT 0,
      output_token_records INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (local_day, time_zone)
    );
    CREATE TABLE IF NOT EXISTS daily_token_metrics (
      local_day TEXT NOT NULL,
      time_zone TEXT NOT NULL,
      backend TEXT NOT NULL,
      model TEXT NOT NULL,
      mode TEXT NOT NULL,
      input_tokens_sum INTEGER NOT NULL DEFAULT 0,
      input_token_records INTEGER NOT NULL DEFAULT 0,
      output_tokens_sum INTEGER NOT NULL DEFAULT 0,
      output_token_records INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (local_day, time_zone, backend, model, mode)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS connection_outages_one_open_per_shard
      ON connection_outages(shard_id) WHERE ended_at IS NULL;
    CREATE TABLE IF NOT EXISTS generations (
      id INTEGER PRIMARY KEY,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      duration_ms INTEGER,
      backend TEXT NOT NULL,
      mode TEXT NOT NULL,
      model TEXT,
      effort TEXT,
      analyzed_message_count INTEGER NOT NULL,
      model_succeeded INTEGER,
      replied_at INTEGER,
      outcome TEXT NOT NULL,
      backend_metadata_json TEXT
    );
    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY,
      generation_id INTEGER NOT NULL REFERENCES generations(id),
      source_key TEXT NOT NULL,
      measured_at INTEGER NOT NULL,
      granularity TEXT NOT NULL CHECK (granularity IN ('request', 'generation')),
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_read_input_tokens INTEGER,
      cache_creation_input_tokens INTEGER,
      UNIQUE (generation_id, source_key)
    );
    CREATE TABLE IF NOT EXISTS hourly_metrics (
      hour_start_ms INTEGER NOT NULL,
      backend TEXT NOT NULL,
      model TEXT NOT NULL,
      mode TEXT NOT NULL,
      generations_count INTEGER NOT NULL DEFAULT 0,
      generation_duration_ms_sum INTEGER NOT NULL DEFAULT 0,
      generation_duration_avg_ms REAL,
      replies_count INTEGER NOT NULL DEFAULT 0,
      analyzed_messages_count INTEGER NOT NULL DEFAULT 0,
      input_tokens_sum INTEGER NOT NULL DEFAULT 0,
      input_token_records INTEGER NOT NULL DEFAULT 0,
      output_tokens_sum INTEGER NOT NULL DEFAULT 0,
      output_token_records INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (hour_start_ms, backend, model, mode)
    );
    CREATE TABLE IF NOT EXISTS hourly_tool_metrics (
      hour_start_ms INTEGER NOT NULL,
      backend TEXT NOT NULL,
      model TEXT NOT NULL,
      mode TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      calls_count INTEGER NOT NULL DEFAULT 0,
      completed_count INTEGER NOT NULL DEFAULT 0,
      duration_ms_sum INTEGER NOT NULL DEFAULT 0,
      duration_avg_ms REAL,
      failures_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (hour_start_ms, backend, model, mode, tool_name)
    );
    CREATE TABLE IF NOT EXISTS tool_runs (
      id INTEGER PRIMARY KEY,
      generation_id INTEGER NOT NULL REFERENCES generations(id),
      source_key TEXT NOT NULL,
      model TEXT,
      tool_name TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      duration_ms INTEGER,
      outcome TEXT,
      UNIQUE (generation_id, source_key)
    );
    CREATE INDEX IF NOT EXISTS connection_outages_time ON connection_outages(started_at, ended_at);
    CREATE INDEX IF NOT EXISTS generations_started ON generations(started_at);
    CREATE INDEX IF NOT EXISTS generations_finished_model ON generations(finished_at, model);
    CREATE INDEX IF NOT EXISTS generations_replied ON generations(replied_at);
    CREATE INDEX IF NOT EXISTS token_usage_time_model ON token_usage(measured_at, model);
    CREATE INDEX IF NOT EXISTS tool_runs_finished ON tool_runs(finished_at, tool_name, model);
    CREATE INDEX IF NOT EXISTS hourly_metrics_time_model ON hourly_metrics(hour_start_ms, model);
    CREATE INDEX IF NOT EXISTS hourly_tools_time_name_model ON hourly_tool_metrics(hour_start_ms, tool_name, model);
    CREATE INDEX IF NOT EXISTS daily_connection_range ON daily_connection_metrics(time_zone, local_day);
    CREATE INDEX IF NOT EXISTS daily_tokens_range ON daily_token_totals(time_zone, local_day);
  `);

  const dailyConnectionColumns = db.prepare('PRAGMA table_info(daily_connection_metrics)').all().map((column) => column.name);
  if (!dailyConnectionColumns.includes('max_episode_ms')) {
    db.exec('ALTER TABLE daily_connection_metrics ADD COLUMN max_episode_ms INTEGER NOT NULL DEFAULT 0');
  }

  // Registros ainda abertos pertencem a um processo que deixou de ser observado.
  const lastSample = db.prepare('SELECT MAX(sampled_at) AS sampled_at FROM connection_samples').get()?.sampled_at;
  db.prepare(`UPDATE connection_outages
    SET ended_at = MAX(started_at, COALESCE(?, started_at)), end_reason = 'observation_lost'
    WHERE ended_at IS NULL`).run(lastSample ?? null);
  db.prepare("UPDATE generations SET outcome = 'interrupted' WHERE outcome = 'running' AND finished_at IS NULL").run();
  db.prepare("UPDATE connection_episodes SET ended_at = last_accounted_at, end_reason = 'observation_lost' WHERE ended_at IS NULL").run();

  let enabled = true;
  const report = (err) => {
    enabled = false;
    try { db.close(); } catch { /* já pode estar fechado */ }
    try { onError(`falha no monitor.db; coleta desativada até reiniciar: ${err.message}`); } catch { /* logging não afeta o bot */ }
  };
  const guard = (fn, fallback = undefined) => {
    if (!enabled) return fallback;
    try { return fn(); } catch (err) { report(err); return fallback; }
  };
  const upsertHourly = db.prepare(`INSERT INTO hourly_metrics (
    hour_start_ms, backend, model, mode, generations_count, generation_duration_ms_sum, generation_duration_avg_ms,
    replies_count, analyzed_messages_count, input_tokens_sum, input_token_records,
    output_tokens_sum, output_token_records
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(hour_start_ms, backend, model, mode) DO UPDATE SET
    generation_duration_avg_ms = CASE
      WHEN generations_count + excluded.generations_count > 0
      THEN CAST(generation_duration_ms_sum + excluded.generation_duration_ms_sum AS REAL) / (generations_count + excluded.generations_count)
      ELSE generation_duration_avg_ms END,
    generations_count = generations_count + excluded.generations_count,
    generation_duration_ms_sum = generation_duration_ms_sum + excluded.generation_duration_ms_sum,
    replies_count = replies_count + excluded.replies_count,
    analyzed_messages_count = analyzed_messages_count + excluded.analyzed_messages_count,
    input_tokens_sum = input_tokens_sum + excluded.input_tokens_sum,
    input_token_records = input_token_records + excluded.input_token_records,
    output_tokens_sum = output_tokens_sum + excluded.output_tokens_sum,
    output_token_records = output_token_records + excluded.output_token_records`);

  function bump({ at, backend, model, mode, generations = 0, duration = 0, replies = 0, analyzed = 0, input = null, output = null }) {
    const avg = generations > 0 ? duration / generations : null;
    upsertHourly.run(hourStart(at), backend, model ?? 'unknown', mode,
      generations, duration, avg, replies, analyzed,
      input ?? 0, input == null ? 0 : 1, output ?? 0, output == null ? 0 : 1);
  }

  const insertSample = db.prepare('INSERT OR REPLACE INTO connection_samples (sampled_at, connected, ping_ms, heartbeat_at) VALUES (?, ?, ?, ?)');
  const insertEpisode = db.prepare('INSERT INTO connection_episodes (started_at, last_accounted_at, cause) VALUES (?, ?, ?)');
  const findOpenEpisode = db.prepare('SELECT id, started_at, last_accounted_at FROM connection_episodes WHERE ended_at IS NULL');
  const closeEpisode = db.prepare('UPDATE connection_episodes SET ended_at = ?, end_reason = ? WHERE id = ? AND ended_at IS NULL');
  const upsertDailyConnection = db.prepare(`INSERT INTO daily_connection_metrics
    (local_day, time_zone, disconnections_count, disconnected_ms_sum, max_contiguous_ms, max_episode_ms)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(local_day, time_zone) DO UPDATE SET
      disconnections_count = disconnections_count + excluded.disconnections_count,
      disconnected_ms_sum = disconnected_ms_sum + excluded.disconnected_ms_sum,
      max_contiguous_ms = MAX(max_contiguous_ms, excluded.max_contiguous_ms),
      max_episode_ms = MAX(max_episode_ms, excluded.max_episode_ms)`);
  const upsertEpisodeDay = db.prepare(`INSERT INTO connection_episode_days (episode_id, local_day, time_zone, duration_ms)
    VALUES (?, ?, ?, ?) ON CONFLICT(episode_id, local_day, time_zone) DO UPDATE SET duration_ms = duration_ms + excluded.duration_ms`);
  const getEpisodeDay = db.prepare('SELECT duration_ms FROM connection_episode_days WHERE episode_id = ? AND local_day = ? AND time_zone = ?');
  const upsertDailyToken = db.prepare(`INSERT INTO daily_token_totals
    (local_day, time_zone, input_tokens_sum, input_token_records, output_tokens_sum, output_token_records)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(local_day, time_zone) DO UPDATE SET
      input_tokens_sum = input_tokens_sum + excluded.input_tokens_sum,
      input_token_records = input_token_records + excluded.input_token_records,
      output_tokens_sum = output_tokens_sum + excluded.output_tokens_sum,
      output_token_records = output_token_records + excluded.output_token_records`);
  const upsertDailyTokenModel = db.prepare(`INSERT INTO daily_token_metrics
    (local_day, time_zone, backend, model, mode, input_tokens_sum, input_token_records, output_tokens_sum, output_token_records)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(local_day, time_zone, backend, model, mode) DO UPDATE SET
      input_tokens_sum = input_tokens_sum + excluded.input_tokens_sum,
      input_token_records = input_token_records + excluded.input_token_records,
      output_tokens_sum = output_tokens_sum + excluded.output_tokens_sum,
      output_token_records = output_token_records + excluded.output_token_records`);
  const findOpenOutage = db.prepare('SELECT id FROM connection_outages WHERE shard_id = ? AND ended_at IS NULL');
  const insertOutage = db.prepare('INSERT INTO connection_outages (shard_id, started_at, cause) VALUES (?, ?, ?)');
  const closeOutage = db.prepare('UPDATE connection_outages SET ended_at = ?, end_reason = ? WHERE shard_id = ? AND ended_at IS NULL');
  const insertGeneration = db.prepare(`INSERT INTO generations
    (started_at, backend, mode, model, effort, analyzed_message_count, outcome)
    VALUES (?, ?, ?, ?, ?, ?, 'running')`);
  const generationState = db.prepare('SELECT backend, mode, model, started_at, finished_at, analyzed_message_count FROM generations WHERE id = ?');
  const setGenerationModel = db.prepare('UPDATE generations SET model = ? WHERE id = ? AND model IS NULL');
  const finishGeneration = db.prepare(`UPDATE generations SET finished_at = ?, duration_ms = ?, model_succeeded = ?, outcome = ?
    WHERE id = ? AND finished_at IS NULL AND outcome = 'running'`);
  const setOutcome = db.prepare('UPDATE generations SET outcome = ? WHERE id = ? AND finished_at IS NOT NULL');
  const setReply = db.prepare(`UPDATE generations SET replied_at = ?, outcome = 'replied'
    WHERE id = ? AND replied_at IS NULL AND model_succeeded = 1 AND outcome = 'awaiting_reply'`);
  const insertToken = db.prepare(`INSERT OR IGNORE INTO token_usage
    (generation_id, source_key, measured_at, granularity, model, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertTool = db.prepare(`INSERT OR IGNORE INTO tool_runs
    (generation_id, source_key, model, tool_name, started_at) VALUES (?, ?, ?, ?, ?)`);
  const finishTool = db.prepare(`UPDATE tool_runs SET finished_at = ?, duration_ms = ?, outcome = ?
    WHERE generation_id = ? AND source_key = ? AND finished_at IS NULL`);
  const upsertTool = db.prepare(`INSERT INTO hourly_tool_metrics
    (hour_start_ms, backend, model, mode, tool_name, calls_count, completed_count, duration_ms_sum, duration_avg_ms, failures_count)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(hour_start_ms, backend, model, mode, tool_name) DO UPDATE SET
      duration_avg_ms = CASE
        WHEN completed_count + excluded.completed_count > 0
        THEN CAST(duration_ms_sum + excluded.duration_ms_sum AS REAL) / (completed_count + excluded.completed_count)
        ELSE duration_avg_ms END,
      calls_count = calls_count + 1,
      completed_count = completed_count + excluded.completed_count,
      duration_ms_sum = duration_ms_sum + excluded.duration_ms_sum,
      failures_count = failures_count + excluded.failures_count`);

  function generationMeta(id) { return generationState.get(id); }

  function advanceEpisode(episode, observedAt) {
    if (!episode || observedAt <= episode.last_accounted_at) return false;
    const zone = timeZone();
    eachLocalDaySegment(episode.last_accounted_at, observedAt, (day, duration) => {
      upsertEpisodeDay.run(episode.id, day, zone, duration);
      const episodeDayDuration = getEpisodeDay.get(episode.id, day, zone).duration_ms;
      upsertDailyConnection.run(day, zone, 0, duration, episodeDayDuration, observedAt - episode.started_at);
    });
    db.prepare('UPDATE connection_episodes SET last_accounted_at = ? WHERE id = ? AND ended_at IS NULL').run(observedAt, episode.id);
    return true;
  }

  return {
    get enabled() { return enabled; },
    sampleConnection({ sampledAt = Date.now(), connected, pingMs = null, heartbeatAt = null }) {
      return guard(() => insertSample.run(sampledAt, Number(Boolean(connected)), pingMs, heartbeatAt));
    },
    startConnectionEpisode({ startedAt = Date.now(), cause = 'gateway_unavailable' } = {}) {
      return guard(() => transaction(db, () => {
        if (findOpenEpisode.get()) return false;
        const result = insertEpisode.run(startedAt, startedAt, cause);
        upsertDailyConnection.run(localDay(startedAt), timeZone(), 1, 0, 0, 0);
        return Number(result.lastInsertRowid);
      }), false);
    },
    advanceConnectionEpisode({ observedAt = Date.now() } = {}) {
      return guard(() => transaction(db, () => advanceEpisode(findOpenEpisode.get(), observedAt)), false);
    },
    finishConnectionEpisode({ endedAt = Date.now(), reason = 'gateway_ready' } = {}) {
      return guard(() => transaction(db, () => {
        const episode = findOpenEpisode.get();
        if (!episode) return false;
        advanceEpisode(episode, endedAt);
        return closeEpisode.run(endedAt, reason, episode.id).changes > 0;
      }), false);
    },
    openOutage({ shardId = 0, startedAt = Date.now(), cause = 'gateway_disconnect' }) {
      return guard(() => {
        if (findOpenOutage.get(shardId)) return false;
        insertOutage.run(shardId, startedAt, cause);
        return true;
      }, false);
    },
    closeOutage({ shardId = 0, endedAt = Date.now(), reason = 'gateway_ready' }) {
      return guard(() => closeOutage.run(endedAt, reason, shardId).changes > 0, false);
    },
    closeOpenOutages({ endedAt = Date.now(), reason = 'shutdown' }) {
      return guard(() => db.prepare('UPDATE connection_outages SET ended_at = ?, end_reason = ? WHERE ended_at IS NULL').run(endedAt, reason).changes);
    },
    startGeneration({ startedAt = Date.now(), backend, mode, model = null, effort = null, analyzedMessageCount = 0 }) {
      return guard(() => transaction(db, () => {
        const result = insertGeneration.run(startedAt, backend, mode, model, effort, analyzedMessageCount);
        bump({ at: startedAt, backend, model, mode, analyzed: analyzedMessageCount });
        return Number(result.lastInsertRowid);
      }));
    },
    finishGeneration({ id, finishedAt = Date.now(), modelSucceeded, outcome }) {
      return guard(() => transaction(db, () => {
        const meta = generationMeta(id);
        if (!meta || meta.finished_at != null) return false;
        const duration = Math.max(0, finishedAt - meta.started_at);
        const result = finishGeneration.run(finishedAt, duration, modelSucceeded == null ? null : Number(Boolean(modelSucceeded)), outcome, id);
        if (!result.changes) return false;
        if (modelSucceeded) bump({ at: finishedAt, backend: meta.backend, model: meta.model, mode: meta.mode, generations: 1, duration });
        return true;
      }), false);
    },
    setGenerationOutcome(id, outcome) {
      return guard(() => setOutcome.run(outcome, id).changes > 0, false);
    },
    markReplied({ id, repliedAt = Date.now() }) {
      return guard(() => transaction(db, () => {
        const meta = generationMeta(id);
        if (!meta) return false;
        const result = setReply.run(repliedAt, id);
        if (!result.changes) return false;
        bump({ at: repliedAt, backend: meta.backend, model: meta.model, mode: meta.mode, replies: 1 });
        return true;
      }), false);
    },
    recordTokenUsage({ generationId, sourceKey, measuredAt = Date.now(), granularity = 'request', model = null, inputTokens = null, outputTokens = null, cacheReadInputTokens = null, cacheCreationInputTokens = null }) {
      return guard(() => transaction(db, () => {
        const meta = generationMeta(generationId);
        if (!meta) return false;
        const effectiveModel = model ?? meta.model;
        if (meta.model == null && effectiveModel != null && setGenerationModel.run(effectiveModel, generationId).changes > 0) {
          if (meta.analyzed_message_count > 0) {
            bump({ at: meta.started_at, backend: meta.backend, model: null, mode: meta.mode, analyzed: -meta.analyzed_message_count });
            bump({ at: meta.started_at, backend: meta.backend, model: effectiveModel, mode: meta.mode, analyzed: meta.analyzed_message_count });
          }
          meta.model = effectiveModel;
        }
        const result = insertToken.run(generationId, sourceKey, measuredAt, granularity, effectiveModel, known(inputTokens), known(outputTokens), known(cacheReadInputTokens), known(cacheCreationInputTokens));
        if (!result.changes) return false;
        const input = known(inputTokens);
        const output = known(outputTokens);
        bump({ at: measuredAt, backend: meta.backend, model: effectiveModel, mode: meta.mode, input, output });
        const day = localDay(measuredAt);
        const zone = timeZone();
        const inputRecords = input == null ? 0 : 1;
        const outputRecords = output == null ? 0 : 1;
        upsertDailyToken.run(day, zone, input ?? 0, inputRecords, output ?? 0, outputRecords);
        upsertDailyTokenModel.run(day, zone, meta.backend, effectiveModel ?? 'unknown', meta.mode,
          input ?? 0, inputRecords, output ?? 0, outputRecords);
        return true;
      }), false);
    },
    startTool({ generationId, sourceKey, model = null, toolName, startedAt = Date.now() }) {
      return guard(() => insertTool.run(generationId, sourceKey, model, toolName, startedAt).changes > 0, false);
    },
    finishTool({ generationId, sourceKey, finishedAt = Date.now(), outcome = 'success' }) {
      return guard(() => transaction(db, () => {
        const run = db.prepare('SELECT model, tool_name, started_at FROM tool_runs WHERE generation_id = ? AND source_key = ? AND finished_at IS NULL').get(generationId, sourceKey);
        const meta = generationMeta(generationId);
        if (!run || !meta) return false;
        const duration = Math.max(0, finishedAt - run.started_at);
        const result = finishTool.run(finishedAt, duration, outcome, generationId, sourceKey);
        if (!result.changes) return false;
        upsertTool.run(hourStart(finishedAt), meta.backend, run.model ?? meta.model ?? 'unknown', meta.mode, run.tool_name, 1, duration, duration, outcome === 'success' ? 0 : 1);
        return true;
      }), false);
    },
    readMetrics({ now = Date.now(), hours = 24, days = 7 } = {}) {
      return guard(() => {
        const from = hourStart(now) - (Math.max(1, Math.min(168, hours)) - 1) * HOUR_MS;
        const hourly = db.prepare(`SELECT * FROM hourly_metrics WHERE hour_start_ms >= ? AND
          (generations_count != 0 OR generation_duration_ms_sum != 0 OR replies_count != 0 OR analyzed_messages_count != 0 OR input_token_records != 0 OR output_token_records != 0)
          ORDER BY hour_start_ms DESC, model, mode`).all(from);
        const tools = db.prepare(`SELECT * FROM hourly_tool_metrics WHERE hour_start_ms >= ? AND calls_count != 0
          ORDER BY hour_start_ms DESC, model, tool_name`).all(from);
        const connection = db.prepare('SELECT sampled_at, connected, ping_ms, heartbeat_at FROM connection_samples ORDER BY sampled_at DESC LIMIT 1').get() ?? null;
        const zone = timeZone();
        const today = localDay(now);
        const dayCount = Math.max(1, Math.min(31, days));
        const firstDay = shiftLocalDay(today, -(dayCount - 1));
        const connectionByDay = new Map(db.prepare(`SELECT local_day, disconnections_count, disconnected_ms_sum, max_contiguous_ms, max_episode_ms
          FROM daily_connection_metrics WHERE time_zone = ? AND local_day BETWEEN ? AND ?`).all(zone, firstDay, today).map((row) => [row.local_day, row]));
        const tokensByDay = new Map(db.prepare(`SELECT local_day, input_tokens_sum, input_token_records, output_tokens_sum, output_token_records
          FROM daily_token_totals WHERE time_zone = ? AND local_day BETWEEN ? AND ?`).all(zone, firstDay, today).map((row) => [row.local_day, row]));
        const modelsByDay = new Map();
        for (const row of db.prepare(`SELECT local_day, backend, model, mode, input_tokens_sum, input_token_records, output_tokens_sum, output_token_records
          FROM daily_token_metrics WHERE time_zone = ? AND local_day BETWEEN ? AND ? ORDER BY local_day, model, mode, backend`).all(zone, firstDay, today)) {
          const models = modelsByDay.get(row.local_day) ?? [];
          models.push(row);
          modelsByDay.set(row.local_day, models);
        }
        const daily = [];
        for (let offset = 0; offset < dayCount; offset += 1) {
          const day = shiftLocalDay(firstDay, offset);
          daily.push({
            local_day: day,
            ...(connectionByDay.get(day) ?? { disconnections_count: 0, disconnected_ms_sum: 0, max_contiguous_ms: 0, max_episode_ms: 0 }),
            ...(tokensByDay.get(day) ?? { input_tokens_sum: 0, input_token_records: 0, output_tokens_sum: 0, output_token_records: 0 }),
            models: modelsByDay.get(day) ?? [],
          });
        }
        const weeklyDisconnections = daily.reduce((sum, row) => sum + row.disconnections_count, 0);
        const longestDisconnection = daily.reduce((longest, row) => row.max_episode_ms > (longest?.duration_ms ?? 0)
          ? { local_day: row.local_day, duration_ms: row.max_episode_ms } : longest, null);
        return { from, hourly, tools, connection, timeZone: zone, daily, weeklyDisconnections, longestDisconnection };
      }, null);
    },
    close() {
      return guard(() => { db.close(); enabled = false; return true; }, false);
    },
  };
}

export function createDisabledMonitor() {
  return {
    enabled: false,
    sampleConnection() {}, startConnectionEpisode() { return false; }, advanceConnectionEpisode() {}, finishConnectionEpisode() { return false; },
    openOutage() {}, closeOutage() {}, closeOpenOutages() {},
    startGeneration() { return null; }, finishGeneration() {}, setGenerationOutcome() {},
    markReplied() {}, recordTokenUsage() {}, startTool() {}, finishTool() {},
    readMetrics() { return null; }, close() {},
  };
}
