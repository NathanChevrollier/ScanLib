import { sql } from 'drizzle-orm';
import type { CalendarEntry, CalendarResponse } from '@scanlib/shared';
import { db } from '../db/client.js';
import { expandSchedule, schedulesOf } from './schedules.js';
import { summariesOf } from './works.js';

/**
 * Agenda des sorties pour les œuvres suivies.
 *
 * Trois origines complémentaires, par ordre d'autorité décroissante :
 *
 * 1. les unités déjà indexées dont la date de publication tombe dans la
 *    fenêtre (MangaDex publie les dates des chapitres à l'avance, TMDB et
 *    TVmaze celles des épisodes) ;
 * 2. les récurrences saisies par l'utilisateur, qui décrivent le rythme réel
 *    d'une série ;
 * 3. le champ « prochaine sortie » renseigné par les jobs pour les séries en
 *    cours de diffusion.
 *
 * Une récurrence manuelle l'emporte sur l'annonce automatique de la même œuvre :
 * qui corrige une date le fait parce que la source se trompe.
 */
export async function getCalendar(
  userId: string,
  from: Date,
  to: Date,
): Promise<CalendarResponse> {
  const [unitRows, nextRows, schedules] = await Promise.all([
    db.execute<{
      work_id: string;
      number: number | null;
      title: string | null;
      published_at: Date;
      completed: boolean;
    }>(sql`
      select u.work_id, u.number, u.title, u.published_at,
             exists (
               select 1 from unit_progress p
               where p.user_id = ${userId} and p.unit_id = u.id
             ) as completed
      from units u
      join library_entries e on e.work_id = u.work_id and e.user_id = ${userId}
      where e.status <> 'dropped'
        and u.published_at between ${from} and ${to}
      order by u.published_at asc
      limit 500
    `),
    db.execute<{
      work_id: string;
      next_release_number: number | null;
      next_release_at: Date;
    }>(sql`
      select w.id as work_id, w.next_release_number, w.next_release_at
      from works w
      join library_entries e on e.work_id = w.id and e.user_id = ${userId}
      where e.status <> 'dropped'
        and w.next_release_at between ${from} and ${to}
    `),
    schedulesOf(userId),
  ]);

  const occurrences = schedules.flatMap((schedule) => expandSchedule(schedule, from, to));

  const workIds = [
    ...new Set([
      ...unitRows.rows.map((row) => row.work_id),
      ...nextRows.rows.map((row) => row.work_id),
      ...occurrences.map((occurrence) => occurrence.workId).filter((id): id is string => id != null),
    ]),
  ];
  const summaries = await summariesOf(workIds);

  const entries: CalendarEntry[] = [];
  const seen = new Set<string>();
  /** Œuvres dont l'utilisateur pilote lui-même le rythme. */
  const overridden = new Set(
    occurrences.map((occurrence) => occurrence.workId).filter((id): id is string => id != null),
  );
  const now = Date.now();

  for (const row of unitRows.rows) {
    const work = summaries.get(row.work_id);
    if (!work) continue;
    const releaseAt = new Date(row.published_at);
    seen.add(`${row.work_id}|${row.number}`);
    entries.push({
      work,
      unitNumber: row.number,
      unitTitle: row.title,
      releaseAt: releaseAt.toISOString(),
      isAvailable: releaseAt.getTime() <= now && !row.completed,
      source: 'unit',
      scheduleId: null,
      label: null,
    });
  }

  for (const occurrence of occurrences) {
    const work = occurrence.workId ? (summaries.get(occurrence.workId) ?? null) : null;
    if (occurrence.workId && !work) continue;
    // Une occurrence manuelle qui retombe sur une unité déjà indexée ferait
    // doublon : la vraie sortie, elle, porte un titre et un lien.
    if (occurrence.workId && seen.has(`${occurrence.workId}|${occurrence.number}`)) continue;

    entries.push({
      work,
      unitNumber: occurrence.number,
      unitTitle: null,
      releaseAt: occurrence.releaseAt.toISOString(),
      isAvailable: false,
      source: 'manual',
      scheduleId: occurrence.scheduleId,
      label: occurrence.label,
    });
  }

  for (const row of nextRows.rows) {
    const work = summaries.get(row.work_id);
    // La sortie annoncée fait souvent doublon avec une unité déjà indexée, et
    // n'a plus lieu d'être quand l'utilisateur a saisi son propre rythme.
    if (!work || overridden.has(row.work_id)) continue;
    if (seen.has(`${row.work_id}|${row.next_release_number}`)) continue;
    entries.push({
      work,
      unitNumber: row.next_release_number,
      unitTitle: null,
      releaseAt: new Date(row.next_release_at).toISOString(),
      isAvailable: false,
      source: 'provider',
      scheduleId: null,
      label: null,
    });
  }

  entries.sort((a, b) => a.releaseAt.localeCompare(b.releaseAt));

  return { entries, from: from.toISOString(), to: to.toISOString() };
}
