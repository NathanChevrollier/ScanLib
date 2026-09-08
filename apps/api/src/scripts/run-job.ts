import { closeDatabase } from '../db/client.js';
import { JOB_HANDLERS, JOB_NAMES, type JobName } from '../jobs/handlers.js';

/**
 * Exécute une tâche de fond à la demande, sans attendre sa planification :
 *
 *   npm run job:run -- detect-new-units
 */
async function main(): Promise<void> {
  const name = process.argv[2] as JobName | undefined;

  if (!name || !JOB_NAMES.includes(name)) {
    console.error(`Tâche inconnue. Disponibles : ${JOB_NAMES.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const started = Date.now();
  const result = await JOB_HANDLERS[name]();
  console.log(`${name} terminé en ${Math.round((Date.now() - started) / 1000)}s`, result);
  await closeDatabase();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await closeDatabase().catch(() => undefined);
  process.exitCode = 1;
});
