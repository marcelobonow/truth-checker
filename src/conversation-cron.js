export function parseScheduledDateTime(date, time, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ''));
  if (!match) throw new TypeError('data inválida; use YYYY-MM-DD');
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const dateCheck = new Date(0);
  dateCheck.setUTCFullYear(year, month - 1, day);
  dateCheck.setUTCHours(0, 0, 0, 0);
  if (dateCheck.getUTCFullYear() !== year || dateCheck.getUTCMonth() !== month - 1 || dateCheck.getUTCDate() !== day) throw new TypeError('data inválida');
  const clock = /^(\d{2}):(\d{2})$/.exec(String(time ?? ''));
  if (!clock || Number(clock[1]) > 23 || Number(clock[2]) > 59) throw new TypeError('hora inválida; use HH:mm');
  const hour = Number(clock[1]), minute = Number(clock[2]);
  const targetDate = new Date(0);
  targetDate.setUTCFullYear(year, month - 1, day);
  targetDate.setUTCHours(hour, minute, 0, 0);
  const target = targetDate.getTime();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  let timestamp = target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = dateTimeParts(formatter, timestamp);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    timestamp += target - represented;
  }
  const parts = dateTimeParts(formatter, timestamp);
  if (parts.year !== year || parts.month !== month || parts.day !== day || parts.hour !== hour || parts.minute !== minute) {
    throw new TypeError('esse horário local não existe por causa da mudança de horário de verão');
  }
  return timestamp;
}

export function truncateDiscordContent(content, limit = 2_000) {
  const text = String(content ?? '');
  if (text.length <= limit) return text;
  if (limit <= 3) return '.'.repeat(Math.max(0, limit));
  let head = text.slice(0, limit - 3);
  if (head.charCodeAt(head.length - 1) >= 0xD800 && head.charCodeAt(head.length - 1) <= 0xDBFF) head = head.slice(0, -1);
  return `${head}...`;
}

export function createConversationCron({ cron, listJobs, tick, timeZone, now = Date.now, onError = () => {} }) {
  if (typeof cron?.schedule !== 'function' || typeof listJobs !== 'function' || typeof tick !== 'function') throw new TypeError('cron, listJobs e tick são obrigatórios');
  new Intl.DateTimeFormat('en-US', { timeZone });
  let stopped = false;
  let running = false;
  let runAgain = false;
  const tasks = new Map();

  function remove(id) {
    const entry = tasks.get(id);
    if (!entry) return;
    entry.task?.destroy?.();
    if (entry.timer) clearTimeout(entry.timer);
    tasks.delete(id);
  }

  function expressionFor(timestamp) {
    const fields = dateTimeParts(new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }), timestamp);
    return `0 ${fields.minute} ${fields.hour} ${fields.day} ${fields.month} *`;
  }

  async function arm(job) {
    const dueAt = Number(job.dueAt ?? job.scheduledAt);
    if (dueAt <= now() || tasks.has(job.id)) return;
    const expression = expressionFor(dueAt);
    let task;
    task = cron.schedule(expression, async () => {
      if (stopped) return;
      remove(job.id);
      if (now() + 60_000 < dueAt) {
        // node-cron has no year field; for a date over one year away, ignore
        // this year's matching month/day and arm the same one-shot cron again.
        await arm(job);
        return;
      }
      if (now() < dueAt) {
        const timer = setTimeout(() => { tasks.delete(job.id); void run(); }, dueAt - now());
        timer.unref?.();
        tasks.set(job.id, { dueAt, timer });
        return;
      }
      await run();
    }, {
      name: `conversation-analysis-${safeName(job.id)}`,
      timezone: timeZone,
      noOverlap: true,
      maxExecutions: 1,
      unref: true,
    });
    tasks.set(job.id, { dueAt, task });
  }

  async function refresh() {
    const jobs = await listJobs();
    const expected = new Map(jobs.map((job) => [job.id, Number(job.dueAt ?? job.scheduledAt)]));
    for (const [id, entry] of tasks) if (!expected.has(id) || expected.get(id) !== entry.dueAt) remove(id);
    let overdue = false;
    for (const job of jobs) {
      const dueAt = Number(job.dueAt ?? job.scheduledAt);
      if (dueAt <= now()) { overdue = true; continue; }
      if (!tasks.has(job.id)) await arm(job);
    }
    return overdue;
  }

  async function run() {
    if (stopped) return;
    if (running) { runAgain = true; return; }
    running = true;
    try {
      do {
        runAgain = false;
        await tick(now());
        if (await refresh()) runAgain = true;
      } while (runAgain && !stopped);
    } catch (error) {
      try { onError(error); } catch { /* logging must not interrupt later schedules */ }
    } finally { running = false; }
  }

  return {
    start: async () => { stopped = false; await refresh(); await run(); },
    refresh: async () => { const overdue = await refresh(); if (overdue) await run(); },
    wake: run,
    stop: () => { stopped = true; for (const id of tasks.keys()) remove(id); },
  };
}

function dateTimeParts(formatter, timestamp) {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute) };
}

function safeName(value) { return String(value).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48); }
