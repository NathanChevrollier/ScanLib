import { and, inArray } from 'drizzle-orm';
import type { ProviderId, SearchQuery, SearchResponse, SearchResult } from '@scanlib/shared';
import type { ProviderWork } from '@scanlib/providers';
import { cache } from '../db/cache.js';
import { db } from '../db/client.js';
import { externalIds } from '../db/schema.js';
import { registry } from '../lib/providers.js';
import { logger } from '../lib/logger.js';
import type { SearchFailure } from '@scanlib/providers';
import { statusesByWorkId } from './library.js';

/** Un catalogue ne bouge pas d'une minute à l'autre. */
const MERGED_TTL_SECONDS = 10 * 60;

interface CachedSearch {
  results: ProviderWork[];
  failures: SearchFailure[];
}

/**
 * Recherche fusionnée, mise en cache avant découpage en pages.
 *
 * Chaque adapter met déjà ses réponses HTTP en cache, mais il fallait quand
 * même réveiller cinq files d'attente et refaire fusion puis classement à
 * chaque page. Une seule entrée par terme ramène tout cela à une lecture.
 */
async function mergedSearch(query: SearchQuery, needed: number): Promise<CachedSearch> {
  // Le terme est normalisé pour que « One Piece », « one piece » et
  // « one  piece » partagent la même entrée.
  const key = [
    'search:v1',
    query.q.trim().toLowerCase().replace(/\s+/g, ' '),
    (query.kinds ?? []).slice().sort().join('+') || 'all',
  ].join('|');

  if (!query.refresh) {
    const hit = await cache.get<CachedSearch>(key);
    // Un lot trop court ne peut pas servir une page profonde : on réinterroge.
    if (hit && hit.results.length >= needed) return hit;
  }

  const fresh = await registry.search(query.q, {
    ...(query.kinds ? { kinds: query.kinds } : {}),
    limit: Math.min(50, needed + 10),
  });

  const payload: CachedSearch = { results: fresh.results, failures: fresh.failures };

  // Un résultat partiel (source en panne) est conservé bien moins longtemps :
  // il ne doit pas figer une recherche incomplète pendant dix minutes.
  await cache
    .set(key, payload, fresh.failures.length > 0 ? 60 : MERGED_TTL_SECONDS)
    .catch((error: unknown) => {
      logger.warn('cache de recherche indisponible', {
        error: error instanceof Error ? error.message : String(error),
      });
    });

  return payload;
}

/**
 * Recherche multi-sources.
 *
 * Les résultats sont fusionnés par le registre, puis annotés avec le statut
 * déjà posé par l'utilisateur : c'est ce qui permet d'afficher « Déjà dans
 * votre bibliothèque » directement dans la liste de recherche plutôt qu'après
 * un ajout raté.
 */
export async function search(userId: string, query: SearchQuery): Promise<SearchResponse> {
  // On demande aux sources de quoi couvrir la page voulue, puis on découpe
  // après fusion et classement : chaque source pagine à sa façon, seul un
  // classement commun garantit un ordre stable entre les pages.
  const needed = query.offset + query.limit;
  const { results: everything, failures } = await mergedSearch(query, needed);

  const results = everything.slice(query.offset, query.offset + query.limit);
  const hasMore = everything.length > query.offset + query.limit;

  const pairs = results.flatMap((work) =>
    work.externals.map((external) => ({
      provider: external.provider,
      providerId: external.providerId,
    })),
  );

  const knownWorks = await resolveKnownWorks(pairs);
  const statuses = await statusesByWorkId(userId, [...new Set(knownWorks.values())]);

  const annotated: SearchResult[] = results.map((work) => {
    const workId = work.externals
      .map((external) => knownWorks.get(`${external.provider}:${external.providerId}`))
      .find(Boolean);

    return {
      id: workId ?? `${work.provider}:${work.providerId}`,
      kind: work.kind,
      title: work.title,
      titles: work.titles,
      coverUrl: work.coverUrl,
      year: work.year,
      releaseStatus: work.releaseStatus,
      score: work.score,
      totalUnits: work.totalUnits,
      externals: work.externals,
      provider: work.provider,
      libraryStatus: workId ? (statuses.get(workId) ?? null) : null,
    };
  });

  return {
    results: annotated,
    degraded: failures.map((failure) => ({ provider: failure.provider, reason: failure.reason })),
    hasMore,
  };
}

/** Associe chaque couple (provider, id) à l'œuvre déjà enregistrée, s'il y en a une. */
async function resolveKnownWorks(
  pairs: { provider: ProviderId; providerId: string }[],
): Promise<Map<string, string>> {
  if (pairs.length === 0) return new Map();

  const providers = [...new Set(pairs.map((pair) => pair.provider))];
  const ids = [...new Set(pairs.map((pair) => pair.providerId))];

  // Deux `in (...)` plutôt qu'une comparaison de tuples, que PostgreSQL ne sait
  // pas faire contre un tableau. Le produit croisé ramène quelques lignes de
  // trop, filtrées ensuite sur les couples exacts.
  const rows = await db
    .select({
      provider: externalIds.provider,
      providerId: externalIds.providerId,
      workId: externalIds.workId,
    })
    .from(externalIds)
    .where(
      and(inArray(externalIds.provider, providers), inArray(externalIds.providerId, ids)),
    );

  const wanted = new Set(pairs.map((pair) => `${pair.provider}:${pair.providerId}`));

  return new Map(
    rows
      .map((row) => [`${row.provider}:${row.providerId}`, row.workId] as const)
      .filter(([key]) => wanted.has(key)),
  );
}
