import path from 'node:path';
import pino from 'pino';

// Console legível (pino-pretty) + arquivo JSON por linha em logs/bot.log.
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
        target: 'pino/file',
        options: { destination: path.join(ROOT, 'logs', 'bot.log'), mkdir: true },
      },
    ],
  },
});
