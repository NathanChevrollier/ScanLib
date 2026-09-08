import { sql } from 'drizzle-orm';
import type { QueueResponse, Recommendation, WorkKind } from '@scanlib/shared';
import { db } from '../db/client.js';
import { registry } from '../lib/providers.js';
import { logger } from '../lib/logger.js';
import { listLibrary } from './library.js';

/**
 * Trois files complémentaires qui répondent à « je regarde quoi maintenant ? » :
 * ce qui attend d'être commencé, ce qui a des épisodes en réserve, et ce qui
 * s'est arrêté en route.
 */
export async function getQueues(userId: string): Promise<QueueResponse> {
  const [toStart, inProgress] = await Promise.all([
    listLibrary(userId, {
      status: ['planned'],
      sort: 'priority',
      order: 'desc',
      limit: 12,
      offset: 0,
    }),
    listLibrary(userId, {
      status: ['in_progress', 'revisiting'],
      sort: 'binge',
      order: 'desc',
      limit: 60,
      offset: 0,
    }),
  ]);

  const stalledThreshold = Date.now() - 30 * 86_400_000;

  return {
    toStart: toStart.items,
    readyToBinge: inProgress.items.filter((item) => item.unitsAvailable > 0).slice(0, 12),
    stalled: inProgress.items
      .filter((item) => {
        const last = item.entry.updatedAt ? Date.parse(item.entry.updatedAt) : 0;
        return last < stalledThreshold;
      })
      .slice(0, 12),
  };
}

/**
 * Recommandations à partir des œuvres les mieux notées de la bibliothèque.
 * On interroge les suggestions du provider (MyAnimeList en propose de bonnes),
 * puis on écarte tout ce que l'utilisateur suit déjà.
 */
export async function getRecommendations(userId: string, limit = 24): Promise<Recommendation[]> {
  const seeds = await db.execute<{
    work_id: string;
    kind: WorkKind;
    title: string;
    provider: string;
    provider_id: string;
  }>(sql`
    select e.work_id, w.kind, w.title, x.provider, x.provider_id
    from library_entries e
    join works w on w.id = e.work_id
    join external_ids x on x.work_id = w.id
    where e.user_id = ${userId}
      and e.status in ('completed', 'in_progress', 'revisiting')
      and x.provider in ('jikan', 'anilist')
    order by coalesce(e.score, 0) desc, e.updated_at desc
    limit 6
  `);

  const owned = await db.execute<{ provider: string; provider_id: string }>(sql`
    select x.provider, x.provider_id
    from library_entries e
    join external_ids x on x.work_id = e.work_id
    where e.user_id = ${userId}
  `);
  const ownedKeys = new Set(owned.rows.map((row) => `${row.provider}:${row.provider_id}`));

  const recommendations = new Map<string, Recommendation>();

  for (const seed of seeds.rows) {
    const provider = registry.get(seed.provider as 'jikan');
    if (!provider?.enabled || !provider.recommendations) continue;
    try {
      const suggestions = await provider.recommendations(seed.provider_id, seed.kind);
      for (const suggestion of suggestions.slice(0, 8)) {
        const key = `${suggestion.provider}:${suggestion.providerId}`;
        if (ownedKeys.has(key) || recommendations.has(key)) continue;
        recommendations.set(key, {
          id: key,
          kind: suggestion.kind,
          title: suggestion.title,
          titles: suggestion.titles,
          coverUrl: suggestion.coverUrl,
          year: suggestion.year,
          releaseStatus: suggestion.releaseStatus,
          score: suggestion.score,
          totalUnits: suggestion.totalUnits,
          externals: suggestion.externals,
          provider: suggestion.provider,
          providerId: suggestion.providerId,
          reason: `Parce que vous avez aimé « ${seed.title} »`,
        });
      }
    } catch (error) {
      logger.debug('recommandations indisponibles', {
        provider: seed.provider,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (recommendations.size >= limit) break;
  }

  return [...recommendations.values()].slice(0, limit);
}
