import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, closeDatabase } from './client.js';
import { logger } from '../lib/logger.js';

/** Applique les migrations générées par drizzle-kit dans `apps/api/drizzle`. */
async function main(): Promise<void> {
  logger.info('application des migrations…');
  // fileURLToPath plutôt que `.pathname` : sous Windows ce dernier renvoie
  // « /C:/… », que le système de fichiers refuse.
  const folder = fileURLToPath(new URL('../../drizzle', import.meta.url));
  await migrate(db, { migrationsFolder: folder });
  logger.info('migrations appliquées.');
  await closeDatabase();
}

main().catch((error: unknown) => {
  logger.error('échec des migrations', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
