import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConversationCron, parseScheduledDateTime, truncateDiscordContent } from '../src/conversation-cron.js';

function fakeCron() {
  const schedules = [];
  return {
    schedules,
    schedule(expression, callback, options) {
      const task = { expression, callback, options, destroyed: false, destroy() { this.destroyed = true; } };
      schedules.push(task);
      return task;
    },
  };
}

test('interpreta data e hora no fuso configurado e rejeita datas e horários locais inválidos', () => {
  assert.equal(parseScheduledDateTime('2026-10-10', '14:16', 'America/Sao_Paulo'), Date.parse('2026-10-10T17:16:00Z'));
  assert.throws(() => parseScheduledDateTime('2026-02-30', '14:16', 'America/Sao_Paulo'), /data inválida/);
  assert.throws(() => parseScheduledDateTime('2026-10-10', '24:00', 'America/Sao_Paulo'), /hora inválida/);
  assert.throws(() => parseScheduledDateTime('2026-03-08', '02:30', 'America/New_York'), /não existe/);
});

test('agenda um cron de uma única execução na data, hora e fuso do job', async () => {
  let now = Date.parse('2026-10-08T12:00:00Z');
  const dueAt = Date.parse('2026-10-10T17:16:00Z');
  const jobs = [{ id: 'j1', scheduledAt: dueAt }];
  const cron = fakeCron();
  const runs = [];
  const schedule = createConversationCron({
    cron, timeZone: 'America/Sao_Paulo', now: () => now,
    listJobs: async () => jobs,
    tick: async (at) => { runs.push(at); jobs.splice(0); },
  });

  await schedule.start();
  assert.equal(cron.schedules.length, 1);
  assert.equal(cron.schedules[0].expression, '0 16 14 10 10 *');
  assert.equal(cron.schedules[0].options.timezone, 'America/Sao_Paulo');
  assert.equal(cron.schedules[0].options.maxExecutions, 1);
  now = dueAt;
  await cron.schedules[0].callback();
  assert.deepEqual(runs, [Date.parse('2026-10-08T12:00:00Z'), dueAt]);
  schedule.stop();
});

test('não executa antecipadamente se o cron anual encontrar uma data-alvo distante', async () => {
  let now = Date.parse('2026-10-08T12:00:00Z');
  const dueAt = Date.parse('2028-10-10T17:16:00Z');
  const jobs = [{ id: 'j2', scheduledAt: dueAt }];
  const cron = fakeCron();
  let runs = 0;
  const schedule = createConversationCron({
    cron, timeZone: 'America/Sao_Paulo', now: () => now,
    listJobs: async () => jobs,
    tick: async (at) => { if (at >= dueAt) { runs++; jobs.splice(0); } },
  });

  await schedule.start();
  const firstYearMatch = cron.schedules[0];
  now = Date.parse('2027-10-10T17:16:00Z');
  await firstYearMatch.callback();
  assert.equal(runs, 0);
  assert.equal(cron.schedules.length, 2);
  now = dueAt;
  await cron.schedules[1].callback();
  assert.equal(runs, 1);
  schedule.stop();
});

test('recupera e executa no startup um job persistido que venceu enquanto o bot estava desligado', async () => {
  const now = Date.parse('2026-10-10T17:17:00Z');
  const jobs = [{ id: 'offline-job', scheduledAt: now - 60_000 }];
  const cron = fakeCron();
  const runs = [];
  const schedule = createConversationCron({
    cron, timeZone: 'America/Sao_Paulo', now: () => now,
    listJobs: async () => jobs,
    tick: async (at) => { runs.push(at); jobs.splice(0); },
  });
  await schedule.start();
  assert.deepEqual(runs, [now]);
  assert.equal(cron.schedules.length, 0);
  schedule.stop();
});

test('trunca a mensagem privada no limite de 2000 caracteres e acrescenta reticências', () => {
  const short = 'resumo curto';
  assert.equal(truncateDiscordContent(short), short);
  const truncated = truncateDiscordContent('😀'.repeat(2_100));
  assert.ok(truncated.length <= 2_000);
  assert.ok(truncated.endsWith('...'));
});
