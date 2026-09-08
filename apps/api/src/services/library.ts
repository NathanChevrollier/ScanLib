import { and, arrayOverlaps, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type {
  AddToLibraryInput,
  LibraryEntry,
  LibraryItem,
  LibraryQuery,
  ProviderId,
  UpdateEntryInput,
  Unit,
  WorkSummary,
} from '@scanlib/shared';
import { db } from '../db/client.js';
import { activityLog, libraryEntries, works, type LibraryEntryRow } from '../db/schema.js';
import { conflict, notFound } from '../lib/errors.js';
import { ensureWork, getWork as getWorkRow, syncUnits, toSummary } from './works.js';

/* -------------------------------------------------------------------------
 * Lecture
 * ---------------------------------------------------------------------- */

interface LibraryRow {
  entry: LibraryEntryRow;
  work: typeof works.$inferSelect;
  unitsTotal: number;
  unitsCompleted: number;
  unitsAvailable: number;
}

/**
 * Liste filtrée de la bibliothèque avec ses compteurs.
 *
 * Les trois compteurs sont calculés en sous-requêtes corrélées plutôt qu'en
 * plusieurs allers-retours : le tri « prêt à binge » a besoin du nombre
 * d'unités disponibles non consommées directement dans le ORDER BY.
 */
export async function listLibrary(
  userId: string,
  query: LibraryQuery,
): Promise<{ items: LibraryItem[]; total: number }> {
  const conditions: SQL[] = [eq(libraryEntries.userId, userId)];

  if (query.status?.length) {
    conditions.push(inArray(libraryEntries.status, query.status));
  }
  if (query.kinds?.length) {
    conditions.push(inArray(works.kind, query.kinds));
  }
  if (query.genres?.length) {
    conditions.push(arrayOverlaps(works.genres, query.genres));
  }
  if (query.tags?.length) {
    conditions.push(arrayOverlaps(libraryEntries.tags, query.tags));
  }
  if (query.favorite != null) {
    conditions.push(eq(libraryEntries.favorite, query.favorite));
  }
  if (query.hasNewUnits != null) {
    conditions.push(eq(libraryEntries.hasNewUnits, query.hasNewUnits));
  }
  if (query.search) {
    const pattern = `%${query.search}%`;
    conditions.push(sql`(${works.title} ilike ${pattern} or ${works.titles}::text ilike ${pattern})`);
  }

  const where = and(...conditions)!;

  const unitsTotal = sql<number>`(select count(*)::int from units u where u.work_id = ${libraryEntries.workId})`;
  const unitsCompleted = sql<number>`(
    select count(*)::int from unit_progress p
    where p.user_id = ${libraryEntries.userId} and p.work_id = ${libraryEntries.workId}
  )`;
  const unitsAvailable = sql<number>`(
    select count(*)::int from units u
    where u.work_id = ${libraryEntries.workId}
      and (u.published_at is null or u.published_at <= now())
      and not exists (
        select 1 from unit_progress p
        where p.user_id = ${libraryEntries.userId} and p.unit_id = u.id
      )
  )`;

  const orderBy = buildOrder(query, unitsAvailable);

  const rows = (await db
    .select({
      entry: libraryEntries,
      work: works,
      unitsTotal,
      unitsCompleted,
      unitsAvailable,
    })
    .from(libraryEntries)
    .innerJoin(works, eq(works.id, libraryEntries.workId))
    .where(where)
    .orderBy(orderBy)
    .limit(query.limit)
    .offset(query.offset)) as LibraryRow[];

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(libraryEntries)
    .innerJoin(works, eq(works.id, libraryEntries.workId))
    .where(where);

  const nextUnits = await nextUnitsFor(
    userId,
    rows.map((row) => row.entry.workId),
  );

  return {
    items: rows.map((row) => ({
      entry: toEntry(row.entry),
      work: toSummary(row.work),
      unitsTotal: row.unitsTotal,
      unitsCompleted: row.unitsCompleted,
      unitsAvailable: row.unitsAvailable,
      nextUnit: nextUnits.get(row.entry.workId) ?? null,
      hasNewUnits: row.entry.hasNewUnits,
    })),
    total: countRow?.count ?? 0,
  };
}

function buildOrder(query: LibraryQuery, unitsAvailable: SQL<number>): SQL {
  const direction = query.order === 'asc' ? sql`asc` : sql`desc`;
  switch (query.sort) {
    case 'title':
      return sql`${works.title} ${direction}`;
    case 'score':
      return sql`${libraryEntries.score} ${direction} nulls last`;
    case 'progress':
      return sql`${libraryEntries.progress} ${direction} nulls last`;
    case 'added':
      return sql`${libraryEntries.createdAt} ${direction}`;
    case 'priority':
      return sql`${libraryEntries.priority} ${direction}, ${libraryEntries.updatedAt} desc`;
    case 'binge':
      // Le plus d'épisodes disponibles d'abord : c'est le tri « qu'est-ce que
      // je peux enchaîner tout de suite ».
      return sql`${unitsAvailable} desc, ${libraryEntries.updatedAt} desc`;
    default:
      return sql`${libraryEntries.updatedAt} ${direction}`;
  }
}

/** Prochaine unité non consommée pour chaque œuvre demandée. */
export async function nextUnitsFor(
  userId: string,
  workIds: string[],
): Promise<Map<string, Unit>> {
  if (workIds.length === 0) return new Map();

  const rows = await db.execute<{
    id: string;
    work_id: string;
    kind: 'chapter' | 'episode';
    number: number | null;
    season: number | null;
    title: string | null;
    language: string | null;
    published_at: Date | null;
    runtime: number | null;
    external_url: string | null;
    is_official: boolean;
    source: string;
  }>(sql`
    select distinct on (u.work_id)
      u.id, u.work_id, u.kind, u.number, u.season, u.title, u.language,
      u.published_at, u.runtime, u.external_url, u.is_official, u.source
    from units u
    where u.work_id in (${sql.join(
      workIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
      and not exists (
        select 1 from unit_progress p where p.user_id = ${userId} and p.unit_id = u.id
      )
    order by u.work_id, u.season asc nulls first, u.number asc nulls last, u.created_at asc
  `);

  const result = new Map<string, Unit>();
  for (const row of rows.rows) {
    result.set(row.work_id, {
      id: row.id,
      workId: row.work_id,
      kind: row.kind,
      number: row.number,
      season: row.season,
      title: row.title,
      language: row.language,
      publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
      runtime: row.runtime,
      externalUrl: row.external_url,
      isOfficial: row.is_official,
      source: row.source as ProviderId,
    });
  }
  return result;
}

export function toEntry(row: LibraryEntryRow): LibraryEntry {
  return {
    id: row.id,
    workId: row.workId,
    status: row.status,
    score: row.score,
    favorite: row.favorite,
    progress: row.progress,
    priority: row.priority,
    notes: row.notes,
    tags: row.tags,
    primaryLinks: { fr: row.primaryLinks?.fr ?? null, en: row.primaryLinks?.en ?? null },
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    revisitCount: row.revisitCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getEntry(userId: string, workId: string): Promise<LibraryEntryRow | null> {
  const [row] = await db
    .select()
    .from(libraryEntries)
    .where(and(eq(libraryEntries.userId, userId), eq(libraryEntries.workId, workId)))
    .limit(1);
  return row ?? null;
}

/* -------------------------------------------------------------------------
 * Écriture
 * ---------------------------------------------------------------------- */

/**
 * Ajoute une œuvre depuis un résultat de recherche. L'œuvre est créée en base
 * si elle n'existe pas encore, puis ses unités sont récupérées en arrière-plan
 * pour que l'utilisateur puisse cocher ses épisodes immédiatement après.
 */
export async function addToLibrary(
  userId: string,
  input: AddToLibraryInput,
  languages: string[],
): Promise<{ entry: LibraryEntry; work: WorkSummary }> {
  // Œuvre déjà connue de l'instance : inutile de repasser par une source
  // externe, on la rattache directement.
  const work = input.workId
    ? await getWorkRow(input.workId)
    : await ensureWork({
        provider: input.provider!,
        providerId: input.providerId!,
        kind: input.kind!,
      });

  const existing = await getEntry(userId, work.id);
  if (existing) throw conflict('Cette œuvre est déjà dans votre bibliothèque.');

  const [entry] = await db
    .insert(libraryEntries)
    .values({
      userId,
      workId: work.id,
      status: input.status,
      startedAt: input.status === 'in_progress' ? new Date() : null,
      lastActivityAt: new Date(),
    })
    .returning();

  await db.insert(activityLog).values({
    userId,
    kind: 'work_added',
    workId: work.id,
    detail: { status: input.status },
  });

  void syncUnits(work.id, { languages }).catch(() => undefined);

  return { entry: toEntry(entry!), work: toSummary(work) };
}

export async function updateEntry(
  userId: string,
  workId: string,
  input: UpdateEntryInput,
): Promise<LibraryEntry> {
  const existing = await getEntry(userId, workId);
  if (!existing) throw notFound('Entrée de bibliothèque');

  const patch: Partial<typeof libraryEntries.$inferInsert> = {
    updatedAt: new Date(),
    lastActivityAt: new Date(),
  };

  if (input.status !== undefined) {
    patch.status = input.status;
    // Les dates de début et de fin se déduisent du changement de statut : c'est
    // ce que l'utilisateur attend sans avoir à les saisir.
    if (input.status === 'in_progress' && !existing.startedAt) patch.startedAt = new Date();
    if (input.status === 'completed') patch.finishedAt = new Date();
    if (input.status === 'revisiting' && existing.status === 'completed') {
      patch.revisitCount = existing.revisitCount + 1;
    }
  }
  if (input.score !== undefined) patch.score = input.score;
  if (input.favorite !== undefined) patch.favorite = input.favorite;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.tags !== undefined) patch.tags = input.tags;
  if (input.primaryLinks !== undefined) {
    // Fusion plutôt que remplacement : l'écran envoie une langue à la fois,
    // renseigner le lien anglais ne doit pas effacer le français.
    patch.primaryLinks = { ...existing.primaryLinks, ...input.primaryLinks };
  }

  const [updated] = await db
    .update(libraryEntries)
    .set(patch)
    .where(and(eq(libraryEntries.userId, userId), eq(libraryEntries.workId, workId)))
    .returning();

  if (input.status !== undefined && input.status !== existing.status) {
    await db.insert(activityLog).values({
      userId,
      kind: 'status_changed',
      workId,
      detail: { from: existing.status, to: input.status },
    });
  }
  if (input.score !== undefined && input.score !== existing.score) {
    await db.insert(activityLog).values({
      userId,
      kind: 'score_changed',
      workId,
      detail: { score: input.score },
    });
  }

  return toEntry(updated!);
}

export async function removeFromLibrary(userId: string, workId: string): Promise<void> {
  const existing = await getEntry(userId, workId);
  if (!existing) throw notFound('Entrée de bibliothèque');

  await db
    .delete(libraryEntries)
    .where(and(eq(libraryEntries.userId, userId), eq(libraryEntries.workId, workId)));

  await db.insert(activityLog).values({ userId, kind: 'work_removed', workId });
}

/** Remise à zéro du badge « nouveautés » à l'ouverture de la fiche. */
export async function clearNewUnitsFlag(userId: string, workId: string): Promise<void> {
  await db
    .update(libraryEntries)
    .set({ hasNewUnits: false })
    .where(
      and(
        eq(libraryEntries.userId, userId),
        eq(libraryEntries.workId, workId),
        eq(libraryEntries.hasNewUnits, true),
      ),
    );
}

/** Statuts déjà posés par l'utilisateur, pour annoter les résultats de recherche. */
export async function statusesByWorkId(
  userId: string,
  workIds: string[],
): Promise<Map<string, LibraryEntryRow['status']>> {
  if (workIds.length === 0) return new Map();
  const rows = await db
    .select({ workId: libraryEntries.workId, status: libraryEntries.status })
    .from(libraryEntries)
    .where(and(eq(libraryEntries.userId, userId), inArray(libraryEntries.workId, workIds)));
  return new Map(rows.map((row) => [row.workId, row.status]));
}

/** Œuvres suivies par au moins un utilisateur — périmètre des jobs. */
export async function trackedWorkIds(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ workId: libraryEntries.workId })
    .from(libraryEntries)
    .innerJoin(works, eq(works.id, libraryEntries.workId))
    .where(sql`${libraryEntries.status} <> 'dropped'`);
  return rows.map((row) => row.workId);
}
