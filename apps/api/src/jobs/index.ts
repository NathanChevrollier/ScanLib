import PgBoss from 'pg-boss';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { JOB_HANDLERS, JOB_NAMES, type JobName } from './handlers.js';
import { runJob } from './run.js';

/** Planification, dans le fuseau configuré par TIMEZONE. */
const SCHEDULES: Record<JobName, string> = {
  'refresh-metadata': '0 3 * * *',
  'detect-new-units': '0 */6 * * *',
  'refresh-links': '0 4 * * 0',
  'airing-calendar': '0 */12 * * *',
  // Les plateformes changent rarement d'adresse : une fois par semaine suffit,
  // à une heure creuse pour ne pas ralentir les recherches.
  'verify-platforms': '0 5 * * 1',
  maintenance: '30 3 * * *',
};

/**
 * Les tâches de fond tournent dans le même processus que l'API : sur un VPS
 * mono-machine, un worker séparé ajouterait un conteneur et une connexion de
 * plus sans bénéfice. pg-boss s'appuie sur PostgreSQL, donc aucune dépendance
 * supplémentaire (pas de Redis) et une reprise propre après redémarrage.
 */
export async function startJobs(): Promise<PgBoss | null> {
  if (!config.ENABLE_JOBS) {
    logger.info('tâches planifiées désactivées (ENABLE_JOBS=false)');
    return null;
  }

  const boss = new PgBoss({
    connectionString: config.DATABASE_URL,
    schema: 'pgboss',
    // Les jobs sont longs (des centaines d'appels d'API) : on évite qu'un
    // redémarrage relance immédiatement un job déjà en cours ailleurs.
    retryLimit: 1,
    retryDelay: 300,
  });

  boss.on('error', (error) => {
    logger.error('pg-boss', { error: error instanceof Error ? error.message : String(error) });
  });

  await boss.start();

  for (const name of JOB_NAMES) {
    await boss.createQueue(name).catch(() => undefined);

    // `runJob` journalise l'exécution en base : sans cette trace, une tâche qui
    // échoue chaque nuit resterait invisible.
    await boss.work(name, { batchSize: 1 }, async () => {
      await runJob(name, JOB_HANDLERS[name]);
    });

    await boss.schedule(name, SCHEDULES[name], undefined, { tz: config.TIMEZONE });
  }

  logger.info('tâches planifiées actives', { jobs: JOB_NAMES });
  return boss;
}
