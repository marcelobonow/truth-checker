import path from 'node:path';
import pino from 'pino';

// Console legível (pino-pretty) + arquivos JSON por dia em logs/bot.YYYY-MM-DD.N.log.
// LOG_LEVEL (trace|debug|info|warn|error) controla os dois; padrão info.
const ROOT = path.resolve(import.meta.dirname, '..');

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    targets: [
      {
        target: 'pino-pretty',
        options: { destination: 1, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
      },
      {
        target: 'pino-roll',
        options: {
          file: path.join(ROOT, 'logs', 'bot.log'),
          frequency: 'daily',
          dateFormat: 'yyyy-MM-dd',
          mkdir: true,
        },
      },
    ],
  },
});
