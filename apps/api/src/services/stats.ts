import { sql } from 'drizzle-orm';
import type { StatsResponse } from '@scanlib/shared';
import { estimatedRuntimeMinutes } from '@scanlib/shared';
import { config } from '../config.js';
import { db } from '../db/client.js';

/**
 * Toutes les statistiques en quelques agrégats SQL.
 *
 * Le temps passé est une estimation : on utilise la durée réelle de l'unité
 * quand la source la fournit, sinon la moyenne par famille (24 min pour un
 * épisode d'animé, 5 min pour un chapitre lu…).
 */
export async function computeStats(userId: string): Promise<StatsResponse> {
  const [byKind, byStatus, consumption, heatmap, genres, scores, activity] = await Promise.all([
    db.execute<{ kind: string; count: number }>(sql`
      select w.kind, count(*)::int as count
      from library_entries e join works w on w.id = e.work_id
      where e.user_id = ${userId}
      group by w.kind
    `),
    db.execute<{ status: string; count: number }>(sql`
      select e.status, count(*)::int as count
      from library_entries e
      where e.user_id = ${userId}
      group by e.status
    `),
    db.execute<{ kind: string; unit_kind: string; count: number; minutes: number }>(sql`
      select
        w.kind,
        u.kind as unit_kind,
        count(*)::int as count,
        coalesce(sum(u.runtime), 0)::int as minutes
      from unit_progress p
      join units u on u.id = p.unit_id
      join works w on w.id = p.work_id
      where p.user_id = ${userId}
      group by w.kind, u.kind
    `),
    db.execute<{ date: string; count: number }>(sql`
      select to_char(created_at at time zone ${config.TIMEZONE}, 'YYYY-MM-DD') as date,
             sum(amount)::int as count
      from activity_log
      where user_id = ${userId}
        and kind = 'unit_completed'
        and created_at >= now() - interval '365 days'
      group by 1
      order by 1
    `),
    db.execute<{ genre: string; count: number }>(sql`
      select genre, count(*)::int as count
      from library_entries e
      join works w on w.id = e.work_id,
      lateral unnest(w.genres) as genre
      where e.user_id = ${userId}
      group by genre
      order by count desc
      limit 12
    `),
    db.execute<{ score: number; count: number }>(sql`
      select round(score)::int as score, count(*)::int as count
      from library_entries
      where user_id = ${userId} and score is not null
      group by 1
      order by 1
    `),
    db.execute<{
      at: Date;
      kind: string;
      work_id: string | null;
      work_title: string | null;
      amount: number;
      detail: Record<string, unknown> | null;
    }>(sql`
      select a.created_at as at, a.kind, a.work_id, w.title as work_title, a.amount, a.detail
      from activity_log a
      left join works w on w.id = a.work_id
      where a.user_id = ${userId}
      order by a.created_at desc
      limit 25
    `),
  ]);

  let episodesWatched = 0;
  let chaptersRead = 0;
  let minutesWatched = 0;
  let minutesRead = 0;

  for (const row of consumption.rows) {
    const kind = row.kind as keyof typeof estimatedRuntimeMinutes;
    // `minutes` ne totalise que les unités ayant une durée connue ; pour les
    // autres on applique la moyenne de la famille.
    const known = row.minutes;
    const fallback = row.count * (estimatedRuntimeMinutes[kind] ?? 20);
    const estimated = known > 0 ? Math.max(known, fallback / 2) : fallback;

    if (row.unit_kind === 'chapter') {
      chaptersRead += row.count;
      minutesRead += Math.round(estimated);
    } else {
      episodesWatched += row.count;
      minutesWatched += Math.round(estimated);
    }
  }

  const heatmapRows = heatmap.rows.map((row) => ({ date: row.date, count: row.count }));

  return {
    totals: {
      works: byKind.rows.reduce((sum, row) => sum + row.count, 0),
      byKind: Object.fromEntries(byKind.rows.map((row) => [row.kind, row.count])),
      byStatus: Object.fromEntries(byStatus.rows.map((row) => [row.status, row.count])),
      episodesWatched,
      chaptersRead,
      minutesWatched,
      minutesRead,
    },
    heatmap: heatmapRows,
    topGenres: genres.rows.map((row) => ({ genre: row.genre, count: row.count })),
    scoreDistribution: scores.rows.map((row) => ({ score: row.score, count: row.count })),
    streak: computeStreak(heatmapRows.map((row) => row.date)),
    recentActivity: activity.rows.map((row) => ({
      at: new Date(row.at).toISOString(),
      kind: row.kind,
      workId: row.work_id,
      workTitle: row.work_title,
      detail: describeActivity(row.kind, row.amount, row.detail),
    })),
  };
}

/** Série de jours consécutifs avec au moins une unité terminée. */
function computeStreak(dates: string[]): { current: number; longest: number } {
  if (dates.length === 0) return { current: 0, longest: 0 };

  const days = new Set(dates);
  let longest = 0;
  let running = 0;
  let previous: number | null = null;

  for (const date of [...days].sort()) {
    const time = Date.parse(`${date}T00:00:00Z`);
    running = previous != null && time - previous === 86_400_000 ? running + 1 : 1;
    previous = time;
    if (running > longest) longest = running;
  }

  // La série courante ne compte que si elle touche aujourd'hui ou hier, dans le
  // même fuseau que le regroupement SQL — sinon elle se casse chaque nuit.
  const now = Date.now();
  const current =
    days.has(dayKey(now)) || days.has(dayKey(now - 86_400_000)) ? running : 0;

  return { current, longest };
}

/** « YYYY-MM-DD » dans le fuseau de référence de l'instance. */
function dayKey(timestamp: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp));
}

function describeActivity(
  kind: string,
  amount: number,
  detail: Record<string, unknown> | null,
): string | null {
  switch (kind) {
    case 'unit_completed':
      return amount > 1 ? `${amount} unités marquées comme terminées` : 'Unité terminée';
    case 'unit_uncompleted':
      return amount > 1 ? `${amount} unités décochées` : 'Unité décochée';
    case 'status_changed':
      return detail && 'to' in detail ? `Statut : ${String(detail.to)}` : 'Statut modifié';
    case 'score_changed':
      return detail && 'score' in detail ? `Note : ${String(detail.score)}/10` : 'Note modifiée';
    case 'work_added':
      return 'Ajouté à la bibliothèque';
    case 'work_removed':
      return 'Retiré de la bibliothèque';
    default:
      return null;
  }
}
