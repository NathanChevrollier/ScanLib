import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { jobRuns } from '../db/schema.js';
import { logger } from '../lib/logger.js';

/**
 * Exécute une tâche de fond en gardant une trace en base.
 *
 * Les journaux partent sur la sortie standard, que personne ne lit ; une tâche
 * qui échoue toutes les nuits pouvait donc passer inaperçue indéfiniment.
 * Chaque exécution laisse désormais une ligne — début, durée, issue, erreur —
 * consultable depuis l'écran d'administration.
 */
export async function runJob<T>(
  name: string,
  handler: () => Promise<T>,
): Promise<T | null> {
  const started = Date.now();

  const [row] = await db.insert(jobRuns).values({ job: name }).returning({ id: jobRuns.id });
  logger.info('tâche démarrée', { job: name });

  try {
    const result = await handler();
    await db
      .update(jobRuns)
      .set({
        finishedAt: new Date(),
        success: true,
        durationMs: Date.now() - started,
        result: (result ?? {}) as Record<string, unknown>,
      })
      .where(eq(jobRuns.id, row!.id));

    logger.info('tâche terminée', { job: name, ms: Date.now() - started, result });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(jobRuns)
      .set({
        finishedAt: new Date(),
        success: false,
        durationMs: Date.now() - started,
        error: message.slice(0, 2000),
      })
      .where(eq(jobRuns.id, row!.id));

    logger.error('tâche en échec', { job: name, error: message });
    return null;
  }
}

/** Ne garde que l'historique récent : cent lignes par tâche suffisent. */
export async function pruneJobRuns(): Promise<number> {
  const deleted = await db.execute<{ id: string }>(`
    delete from job_runs
    where id in (
      select id from (
        select id, row_number() over (partition by job order by started_at desc) as rang
        from job_runs
      ) classement
      where rang > 100
    )
    returning id
  `);
  return deleted.rows.length;
}
