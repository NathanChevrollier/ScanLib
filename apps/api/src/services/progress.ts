import { and, eq, inArray, sql } from 'drizzle-orm';
import type { LibraryEntry } from '@scanlib/shared';
import { db } from '../db/client.js';
import { activityLog, libraryEntries, unitProgress, units } from '../db/schema.js';
import { forbidden, notFound } from '../lib/errors.js';
import { getEntry, toEntry } from './library.js';

export interface ProgressResult {
  entry: LibraryEntry;
  completedUnitIds: string[];
}

/**
 * Marque ou démarque un lot d'unités.
 *
 * Tout passe par cette fonction — case à cocher, « marquer jusqu'ici », bouton
 * « suivant » — afin que la progression, le statut et le journal d'activité
 * restent cohérents quel que soit le geste de l'utilisateur.
 */
export async function setUnitsCompleted(
  userId: string,
  unitIds: string[],
  completed: boolean,
): Promise<ProgressResult> {
  const rows = await db
    .select({ id: units.id, workId: units.workId })
    .from(units)
    .where(inArray(units.id, unitIds));

  if (rows.length === 0) throw notFound('Unité');

  const workIds = [...new Set(rows.map((row) => row.workId))];
  if (workIds.length > 1) {
    throw forbidden('Les unités doivent appartenir à une seule œuvre.');
  }
  const workId = workIds[0]!;

  const entry = await getEntry(userId, workId);
  if (!entry) throw notFound('Entrée de bibliothèque');

  if (completed) {
    await db
      .insert(unitProgress)
      .values(rows.map((row) => ({ userId, unitId: row.id, workId })))
      .onConflictDoNothing();
  } else {
    await db
      .delete(unitProgress)
      .where(
        and(
          eq(unitProgress.userId, userId),
          inArray(
            unitProgress.unitId,
            rows.map((row) => row.id),
          ),
        ),
      );
  }

  await db.insert(activityLog).values({
    userId,
    kind: completed ? 'unit_completed' : 'unit_uncompleted',
    workId,
    amount: rows.length,
  });

  const updated = await recomputeEntry(userId, workId);
  return { entry: updated, completedUnitIds: await completedUnitIds(userId, workId) };
}

/**
 * « Marquer jusqu'ici » : tout ce qui précède l'unité choisie, saison comprise,
 * passe à terminé. C'est le geste le plus utile quand on reprend une série
 * commencée ailleurs.
 */
export async function markUpTo(
  userId: string,
  workId: string,
  number: number,
): Promise<ProgressResult> {
  const entry = await getEntry(userId, workId);
  if (!entry) throw notFound('Entrée de bibliothèque');

  const rows = await db
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.workId, workId), sql`coalesce(${units.number}, 0) <= ${number}`));

  if (rows.length > 0) {
    await db
      .insert(unitProgress)
      .values(rows.map((row) => ({ userId, unitId: row.id, workId })))
      .onConflictDoNothing();

    await db.insert(activityLog).values({
      userId,
      kind: 'unit_completed',
      workId,
      amount: rows.length,
      detail: { upTo: number },
    });
  }

  const updated = await recomputeEntry(userId, workId);
  return { entry: updated, completedUnitIds: await completedUnitIds(userId, workId) };
}

/**
 * Fixe la progression à un numéro précis : tout ce qui précède est marqué
 * terminé, tout ce qui suit redevient à consommer.
 *
 * C'est l'opération qui manque quand on avance ou recule d'un cran : contrairement
 * à « marquer jusqu'ici », elle décoche aussi, ce qui permet de corriger une
 * erreur sans décocher les unités une par une.
 */
export async function setProgressNumber(
  userId: string,
  workId: string,
  number: number,
): Promise<ProgressResult> {
  const entry = await getEntry(userId, workId);
  if (!entry) throw notFound('Entrée de bibliothèque');

  const rows = await db
    .select({ id: units.id, number: units.number })
    .from(units)
    .where(eq(units.workId, workId));

  // Les unités sans numéro (bonus, hors-série) ne sont pas concernées : les
  // inclure les cocherait toutes dès qu'on règle sa progression.
  const numbered = rows.filter((row) => row.number != null);
  const toComplete = numbered.filter((row) => row.number! <= number).map((row) => row.id);
  const toClear = numbered.filter((row) => row.number! > number).map((row) => row.id);

  if (toComplete.length > 0) {
    await db
      .insert(unitProgress)
      .values(toComplete.map((unitId) => ({ userId, unitId, workId })))
      .onConflictDoNothing();
  }
  if (toClear.length > 0) {
    await db
      .delete(unitProgress)
      .where(and(eq(unitProgress.userId, userId), inArray(unitProgress.unitId, toClear)));
  }

  await db.insert(activityLog).values({
    userId,
    kind: 'unit_completed',
    workId,
    amount: Math.max(1, toComplete.length),
    detail: { setTo: number },
  });

  const updated = await recomputeEntry(userId, workId);
  return { entry: updated, completedUnitIds: await completedUnitIds(userId, workId) };
}

export async function completedUnitIds(userId: string, workId: string): Promise<string[]> {
  const rows = await db
    .select({ unitId: unitProgress.unitId })
    .from(unitProgress)
    .where(and(eq(unitProgress.userId, userId), eq(unitProgress.workId, workId)));
  return rows.map((row) => row.unitId);
}

/**
 * Recalcule la progression affichée et fait évoluer le statut automatiquement :
 * cocher un premier épisode fait passer « à commencer » en « en cours », cocher
 * le dernier bascule en « terminé ». L'utilisateur garde la main : un statut
 * choisi explicitement (en pause, abandonné) n'est jamais écrasé.
 */
async function recomputeEntry(userId: string, workId: string): Promise<LibraryEntry> {
  const result = await db.execute<{
    completed: number;
    max_number: number | null;
    total: number;
  }>(sql`
    select
      count(p.unit_id)::int as completed,
      max(u.number) as max_number,
      (select count(*)::int from units where work_id = ${workId}) as total
    from unit_progress p
    join units u on u.id = p.unit_id
    where p.user_id = ${userId} and p.work_id = ${workId}
  `);
  const stats = result.rows[0];

  const entry = await getEntry(userId, workId);
  if (!entry) throw notFound('Entrée de bibliothèque');

  const completed = stats?.completed ?? 0;
  const total = stats?.total ?? 0;
  const patch: Partial<typeof libraryEntries.$inferInsert> = {
    progress: stats?.max_number ?? null,
    lastActivityAt: new Date(),
    updatedAt: new Date(),
  };

  const isFinished = total > 0 && completed >= total;

  if (isFinished && (entry.status === 'in_progress' || entry.status === 'revisiting')) {
    patch.status = 'completed';
    patch.finishedAt = new Date();
  } else if (!isFinished && completed > 0 && entry.status === 'planned') {
    patch.status = 'in_progress';
    patch.startedAt = entry.startedAt ?? new Date();
  } else if (!isFinished && entry.status === 'completed' && completed < total) {
    // Décocher un épisode d'une série terminée la remet logiquement en cours.
    patch.status = 'in_progress';
    patch.finishedAt = null;
  }

  const [updated] = await db
    .update(libraryEntries)
    .set(patch)
    .where(and(eq(libraryEntries.userId, userId), eq(libraryEntries.workId, workId)))
    .returning();

  return toEntry(updated!);
}
