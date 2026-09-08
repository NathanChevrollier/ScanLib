import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { config } from './config.js';
import { closeDatabase } from './db/client.js';
import { startJobs } from './jobs/index.js';
import { logger } from './lib/logger.js';

const app = createApp();

const server = serve({ fetch: app.fetch, port: config.API_PORT }, (info) => {
  logger.info('API démarrée', { port: info.port, env: config.NODE_ENV });
});

const boss = await startJobs();

async function shutdown(signal: string): Promise<void> {
  logger.info('arrêt en cours', { signal });
  server.close();
  await boss?.stop({ graceful: true, timeout: 10_000 }).catch(() => undefined);
  await closeDatabase().catch(() => undefined);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
