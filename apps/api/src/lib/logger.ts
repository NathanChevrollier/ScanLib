import type { Logger } from '@scanlib/providers';
import { config } from '../config.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

const levels: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = config.NODE_ENV === 'development' ? levels.debug : levels.info;

/**
 * Journal minimal en JSON sur la sortie standard : Docker et journald s'en
 * chargent ensuite, inutile d'embarquer une dépendance de plus.
 */
function write(level: Level, message: string, meta?: Record<string, unknown>): void {
  if (levels[level] < threshold) return;
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    message,
    ...(meta ?? {}),
  });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const logger: Logger = {
  debug: (message, meta) => write('debug', message, meta),
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
};
