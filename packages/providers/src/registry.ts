import type { ProviderId, WorkKind } from '@scanlib/shared';
import { isSameWork } from '@scanlib/shared';
import { CircuitBreaker } from './http/circuit-breaker.js';
import { rankWorks } from './ranking.js';
import { AniListProvider } from './adapters/anilist.js';
import { JikanProvider } from './adapters/jikan.js';
import { KitsuProvider } from './adapters/kitsu.js';
import { MangaDexProvider } from './adapters/mangadex.js';
import { TmdbProvider } from './adapters/tmdb.js';
import { TvMazeProvider } from './adapters/tvmaze.js';
import type {
  MediaProvider,
  ProviderConfig,
  ProviderHealthReport,
  ProviderWork,
  SearchOptions,
} from './types.js';

/**
 * Ordre de préférence par famille d'œuvre. Le premier provider disponible
 * fournit les données affichées ; les suivants complètent (titres localisés,
 * liens supplémentaires) et prennent le relais en cas de panne.
 */
export const PROVIDER_PRIORITY: Record<WorkKind, ProviderId[]> = {
  manga: ['mangadex', 'anilist', 'jikan', 'kitsu'],
  anime: ['anilist', 'jikan', 'kitsu', 'tmdb'],
  // TVmaze passe après TMDB quand une clé est configurée, et prend toute la
  // place sinon : sans lui, une instance sans `TMDB_API_KEY` n'avait aucune
  // source pour les séries.
  tv: ['tmdb', 'tvmaze'],
  movie: ['tmdb'],
};

export interface SearchFailure {
  provider: ProviderId;
  reason: string;
}

export interface MergedSearch {
  results: ProviderWork[];
  failures: SearchFailure[];
}

/**
 * Point d'entrée unique vers les sources externes. Le reste de l'application
 * ne connaît que le registre : ajouter, retirer ou désactiver une source ne
 * demande aucune modification ailleurs.
 */
/**
 * Au-delà, une source est considérée trop lente. Les sources étant interrogées
 * en parallèle, ce délai est aussi le plafond du temps de réponse global.
 */
const SEARCH_TIMEOUT_MS = 2500;

export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, MediaProvider>();
  private readonly breaker: CircuitBreaker;

  constructor(private readonly config: ProviderConfig) {
    this.breaker = new CircuitBreaker(3, 60_000, 15 * 60_000, config.logger, config.cache);
    for (const provider of [
      new MangaDexProvider(config),
      new JikanProvider(config),
      new KitsuProvider(config),
      new TmdbProvider(config),
      new AniListProvider(config),
      new TvMazeProvider(config),
    ]) {
      this.providers.set(provider.id, provider);
    }
  }

  get(id: ProviderId): MediaProvider | undefined {
    return this.providers.get(id);
  }

  all(): MediaProvider[] {
    return [...this.providers.values()];
  }

  /** Providers actifs capables de traiter cette famille, dans l'ordre de priorité. */
  for(kind: WorkKind): MediaProvider[] {
    return (PROVIDER_PRIORITY[kind] ?? [])
      .map((id) => this.providers.get(id))
      .filter((provider): provider is MediaProvider => Boolean(provider?.enabled))
      .filter((provider) => provider.kinds.includes(kind));
  }

  /**
   * Interroge en parallèle toutes les sources concernées, fusionne les
   * doublons et signale les sources en échec au lieu de faire échouer la
   * recherche entière — une API publique indisponible ne doit jamais casser
   * l'application.
   *
   * Deux garde-fous conditionnent le temps de réponse : les sources déjà
   * connues comme en panne sont écartées d'emblée (coupe-circuit), et chaque
   * source dispose d'un délai maximum au-delà duquel on rend la main avec ce
   * que les autres ont trouvé.
   */
  async search(query: string, options: SearchOptions = {}): Promise<MergedSearch> {
    const kinds = options.kinds ?? (['manga', 'anime', 'tv', 'movie'] as WorkKind[]);
    const targets = new Set<MediaProvider>();
    for (const kind of kinds) {
      for (const provider of this.for(kind)) targets.add(provider);
    }

    const failures: SearchFailure[] = [];
    const settled = await Promise.all(
      [...targets].map(async (provider) => {
        if (this.breaker.isOpen(provider.id)) {
          const state = this.breaker.state(provider.id);
          failures.push({
            provider: provider.id,
            reason: `Source écartée après ${state.failures} échecs, nouvelle tentative après ${state.retryAt?.slice(11, 16) ?? 'bientôt'}.`,
          });
          return [];
        }

        try {
          const results = await withTimeout(
            provider.search(query, options),
            SEARCH_TIMEOUT_MS,
            provider.id,
          );
          this.breaker.recordSuccess(provider.id);
          return results;
        } catch (error) {
          this.breaker.recordFailure(provider.id);
          this.config.logger?.warn('recherche en échec', {
            provider: provider.id,
            error: error instanceof Error ? error.message : String(error),
          });
          failures.push({
            provider: provider.id,
            reason: error instanceof Error ? error.message : 'Erreur inconnue',
          });
          return [];
        }
      }),
    );

    return { results: mergeWorks(settled.flat(), query), failures };
  }

  /** État du coupe-circuit, pour l'écran de diagnostic. */
  breakerState(id: ProviderId) {
    return this.breaker.state(id);
  }

  async health(): Promise<ProviderHealthReport[]> {
    return Promise.all(
      this.all().map(async (provider) => {
        try {
          return await provider.health();
        } catch (error) {
          return {
            provider: provider.id,
            status: 'down' as const,
            message: error instanceof Error ? error.message : String(error),
            checkedAt: new Date(),
          };
        }
      }),
    );
  }
}

/**
 * Fusionne les résultats de plusieurs sources décrivant la même œuvre.
 *
 * On s'appuie d'abord sur les identifiants croisés que les bases se donnent
 * entre elles (MangaDex publie les IDs MAL / AniList / Kitsu), ce qui est
 * fiable ; la similarité de titre ne sert que de repli.
 */
export function mergeWorks(works: ProviderWork[], query?: string): ProviderWork[] {
  const groups: ProviderWork[][] = [];

  for (const work of works) {
    const group = groups.find((candidates) =>
      candidates.some((candidate) => sharesExternalId(candidate, work) || isSameWork(candidate, work)),
    );
    if (group) group.push(work);
    else groups.push([work]);
  }

  const merged = groups.map((group) => mergeGroup(group));

  // Chaque source classe selon ses propres critères : il faut un ordre commun,
  // calculé sur la fiche fusionnée — tous les titres connus, la meilleure note.
  return query ? rankWorks(merged, query) : merged;
}

function sharesExternalId(a: ProviderWork, b: ProviderWork): boolean {
  if (a.kind !== b.kind) return false;
  return a.externals.some((left) =>
    b.externals.some(
      (right) => left.provider === right.provider && left.providerId === right.providerId,
    ),
  );
}

/** Conserve la source la mieux placée et complète les champs manquants. */
function mergeGroup(group: ProviderWork[]): ProviderWork {
  const priority = PROVIDER_PRIORITY[group[0]!.kind] ?? [];
  const sorted = [...group].sort(
    (a, b) => indexOrLast(priority, a.provider) - indexOrLast(priority, b.provider),
  );
  const primary = sorted[0]!;

  const titles = { ...primary.titles };
  const externals = [...primary.externals];

  for (const other of sorted.slice(1)) {
    for (const [lang, value] of Object.entries(other.titles)) {
      if (!titles[lang]) titles[lang] = value;
    }
    for (const external of other.externals) {
      const exists = externals.some(
        (candidate) =>
          candidate.provider === external.provider && candidate.providerId === external.providerId,
      );
      if (!exists) externals.push(external);
    }
  }

  return {
    ...primary,
    // Un titre français vient presque toujours d'une source secondaire (Kitsu,
    // TMDB) : on le privilégie dès qu'il existe.
    title: titles.fr ?? primary.title,
    titles,
    externals,
    coverUrl: primary.coverUrl ?? sorted.find((work) => work.coverUrl)?.coverUrl ?? null,
    score: primary.score ?? sorted.find((work) => work.score != null)?.score ?? null,
    year: primary.year ?? sorted.find((work) => work.year != null)?.year ?? null,
    totalUnits:
      primary.totalUnits ?? sorted.find((work) => work.totalUnits != null)?.totalUnits ?? null,
  };
}

function indexOrLast(priority: ProviderId[], id: ProviderId): number {
  const index = priority.indexOf(id);
  return index === -1 ? priority.length : index;
}

/** Borne la durée d'une source : les autres ne doivent pas l'attendre. */
async function withTimeout<T>(promise: Promise<T>, ms: number, provider: ProviderId): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${provider} n'a pas répondu en ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
