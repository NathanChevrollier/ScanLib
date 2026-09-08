import type { OfficialLink, ReleaseStatus, WorkKind } from '@scanlib/shared';
import { RateLimitedClient, cacheKeyOf } from '../http/rate-limited-client.js';
import { resolvePlatform } from '../links/platforms.js';
import {
  CACHE_TTL,
  ProviderError,
  type MediaProvider,
  type ProviderConfig,
  type ProviderHealthReport,
  type ProviderUnit,
  type ProviderWork,
  type ProviderWorkDetails,
  type SearchOptions,
  type UnitsOptions,
} from '../types.js';
import { cleanTitles, compact, toIso, uniq, yearOf } from '../util.js';

const BASE_URL = 'https://api.themoviedb.org/3';
const IMAGE_URL = 'https://image.tmdb.org/t/p';

/** Mention imposée par les conditions d'utilisation de TMDB. */
export const TMDB_ATTRIBUTION =
  'Données de disponibilité fournies par JustWatch via TMDB. Ce produit utilise l’API TMDB mais n’est ni approuvé ni certifié par TMDB.';

/* --- Formes de réponse TMDB --------------------------------------------- */

interface TmdbSearchItem {
  id: number;
  name?: string;
  title?: string;
  original_name?: string;
  original_title?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  first_air_date?: string;
  release_date?: string;
  vote_average?: number;
  original_language?: string;
}

interface TmdbTranslation {
  iso_639_1: string;
  data?: { name?: string; title?: string; overview?: string };
}

interface TmdbProviderEntry {
  provider_id: number;
  provider_name: string;
  logo_path?: string | null;
  display_priority?: number;
}

interface TmdbWatchProviders {
  results?: Record<
    string,
    {
      link?: string;
      flatrate?: TmdbProviderEntry[];
      free?: TmdbProviderEntry[];
      ads?: TmdbProviderEntry[];
      rent?: TmdbProviderEntry[];
      buy?: TmdbProviderEntry[];
    }
  >;
}

interface TmdbDetails extends TmdbSearchItem {
  genres?: { name: string }[];
  status?: string;
  episode_run_time?: number[];
  runtime?: number | null;
  number_of_episodes?: number | null;
  number_of_seasons?: number | null;
  last_air_date?: string | null;
  seasons?: { season_number: number; episode_count: number; name?: string }[];
  networks?: { name: string }[];
  production_companies?: { name: string }[];
  created_by?: { name: string }[];
  next_episode_to_air?: { episode_number: number; air_date?: string | null; name?: string } | null;
  external_ids?: { imdb_id?: string | null; tvdb_id?: number | null };
  translations?: { translations?: TmdbTranslation[] };
  'watch/providers'?: TmdbWatchProviders;
}

interface TmdbSeason {
  season_number: number;
  episodes?: {
    id: number;
    episode_number: number;
    season_number: number;
    name?: string;
    overview?: string;
    air_date?: string | null;
    runtime?: number | null;
  }[];
}

/**
 * TMDB couvre les séries et les films, et donne surtout la disponibilité par
 * pays via JustWatch (`watch/providers`). Attention : cet endpoint renvoie la
 * liste des plateformes, pas d'URL vers l'œuvre — le lien direct est
 * reconstruit par OfficialLinkResolver à partir du registre de plateformes.
 */
export class TmdbProvider implements MediaProvider {
  readonly id = 'tmdb' as const;
  readonly label = 'The Movie Database';
  readonly kinds = ['tv', 'movie'] as const;
  readonly enabled: boolean;

  private readonly client: RateLimitedClient;
  private readonly apiKey: string;
  private readonly regions: string[];

  constructor(config: ProviderConfig) {
    this.apiKey = config.tmdbApiKey ?? '';
    this.enabled = this.apiKey.length > 0;
    this.regions = config.regions.length > 0 ? config.regions : ['FR', 'US'];
    this.client = new RateLimitedClient(
      this.id,
      BASE_URL,
      { requestsPerSecond: 20, concurrency: 6, maxRetries: 3 },
      config.cache,
      config.userAgent,
      config.logger,
      config.fetchImpl,
    );
  }

  async search(query: string, options: SearchOptions = {}): Promise<ProviderWork[]> {
    if (!this.enabled) return [];
    const kinds = (options.kinds ?? this.kinds).filter((kind) =>
      (this.kinds as readonly WorkKind[]).includes(kind),
    );
    if (kinds.length === 0) return [];
    const limit = options.limit ?? 20;

    const batches = await Promise.all(
      kinds.map(async (kind) => {
        const endpoint = kind === 'movie' ? '/search/movie' : '/search/tv';
        const response = await this.client.request<{ results?: TmdbSearchItem[] }>(
          `${endpoint}?${this.params({ query, include_adult: 'false' })}`,
          {
            cacheKey: cacheKeyOf('search', { q: query, kind }),
            cacheTtl: CACHE_TTL.search,
            retries: 0,
            ...(options.signal ? { signal: options.signal } : {}),
          },
        );
        return (response?.results ?? []).map((item) => this.toWork(item, kind));
      }),
    );

    return batches.flat().slice(0, limit);
  }

  async details(providerId: string, kind: WorkKind): Promise<ProviderWorkDetails | null> {
    if (!this.enabled) return null;
    const details = await this.fetchDetails(providerId, kind);
    if (!details) return null;

    const base = this.toWork(details, kind);
    const translations = details.translations?.translations ?? [];
    const synopsis: Record<string, string> = {};
    if (details.overview) synopsis.fr = details.overview;
    for (const translation of translations) {
      const text = translation.data?.overview;
      if (text && !synopsis[translation.iso_639_1]) synopsis[translation.iso_639_1] = text;
    }

    const runtime =
      details.runtime ??
      (details.episode_run_time && details.episode_run_time.length > 0
        ? details.episode_run_time[0]
        : null) ??
      null;

    return {
      ...base,
      synopsis: cleanTitles(synopsis),
      genres: (details.genres ?? []).map((genre) => genre.name),
      bannerUrl: details.backdrop_path ? `${IMAGE_URL}/w1280${details.backdrop_path}` : null,
      averageRuntime: runtime,
      startDate: toIso(details.first_air_date ?? details.release_date ?? null),
      endDate: toIso(details.last_air_date ?? null),
      studios: uniq(
        compact([
          ...(details.networks ?? []).map((n) => n.name),
          ...(details.production_companies ?? []).map((c) => c.name),
        ]),
      ),
      authors: compact((details.created_by ?? []).map((person) => person.name)),
      availableLanguages: uniq(
        compact([details.original_language ?? null, ...translations.map((t) => t.iso_639_1)]),
      ),
      nextRelease: details.next_episode_to_air?.air_date
        ? {
            number: details.next_episode_to_air.episode_number,
            airingAt: toIso(details.next_episode_to_air.air_date) ?? '',
          }
        : null,
      updatedAt: new Date().toISOString(),
    };
  }

  async units(
    providerId: string,
    kind: WorkKind,
    options: UnitsOptions = {},
  ): Promise<ProviderUnit[]> {
    if (!this.enabled) return [];

    if (kind === 'movie') {
      const details = await this.fetchDetails(providerId, kind);
      if (!details) return [];
      return [
        {
          kind: 'episode',
          number: 1,
          season: null,
          title: details.title ?? details.name ?? null,
          language: null,
          publishedAt: toIso(details.release_date ?? null),
          runtime: details.runtime ?? null,
          externalUrl: null,
          isOfficial: false,
          source: this.id,
        },
      ];
    }

    const details = await this.fetchDetails(providerId, kind);
    if (!details) return [];

    const seasons = (details.seasons ?? []).filter((season) => season.episode_count > 0);
    const units: ProviderUnit[] = [];

    for (const season of seasons) {
      if (options.limit && units.length >= options.limit) break;
      const response = await this.client.request<TmdbSeason>(
        `/tv/${providerId}/season/${season.season_number}?${this.params({})}`,
        {
          cacheKey: cacheKeyOf('season', { id: providerId, season: season.season_number }),
          cacheTtl: CACHE_TTL.units,
          nullOn404: true,
          ...(options.signal ? { signal: options.signal } : {}),
        },
      );
      for (const episode of response?.episodes ?? []) {
        units.push({
          kind: 'episode',
          number: episode.episode_number,
          season: episode.season_number,
          title: episode.name ?? null,
          language: null,
          publishedAt: toIso(episode.air_date ?? null),
          runtime: episode.runtime ?? null,
          externalUrl: null,
          isOfficial: false,
          source: this.id,
        });
      }
    }

    return units;
  }

  /**
   * Disponibilité par pays. TMDB ne fournit pas de lien direct vers l'œuvre :
   * on renvoie donc chaque plateforme avec `confidence: 'search'`, plus la page
   * TMDB du pays en lien `exact` de repli.
   */
  async links(providerId: string, kind: WorkKind, regions?: string[]): Promise<OfficialLink[]> {
    if (!this.enabled) return [];
    const details = await this.fetchDetails(providerId, kind);
    if (!details) return [];

    const providers = details['watch/providers']?.results ?? {};
    const wanted = regions?.length ? regions : this.regions;
    const title = details.name ?? details.title ?? details.original_name ?? details.original_title;
    const links: OfficialLink[] = [];

    for (const region of wanted) {
      const entry = providers[region];
      if (!entry) continue;

      const buckets: [TmdbProviderEntry[] | undefined, OfficialLink['monetization']][] = [
        [entry.flatrate, 'sub'],
        [entry.free, 'free'],
        [entry.ads, 'ads'],
        [entry.rent, 'rent'],
        [entry.buy, 'buy'],
      ];

      for (const [entries, monetization] of buckets) {
        for (const item of entries ?? []) {
          const platform = resolvePlatform(item.provider_name);
          const url = platform?.search?.(title ?? '') ?? entry.link;
          if (!url) continue;
          links.push({
            platform: platform?.id ?? slug(item.provider_name),
            platformLabel: platform?.label ?? item.provider_name,
            kind: 'stream',
            url,
            language: region === 'FR' ? 'fr' : 'en',
            region,
            monetization,
            confidence: platform?.search ? 'search' : 'exact',
            official: true,
            source: this.id,
            logoUrl: item.logo_path ? `${IMAGE_URL}/original${item.logo_path}` : null,
          });
        }
      }

      if (entry.link) {
        links.push({
          platform: 'tmdb',
          platformLabel: `Toutes les offres (${region})`,
          kind: 'info',
          url: entry.link,
          language: null,
          region,
          monetization: 'unknown',
          confidence: 'exact',
          official: false,
          source: this.id,
          logoUrl: null,
        });
      }
    }

    return links;
  }

  async schedule(
    providerId: string,
    kind: WorkKind,
  ): Promise<{ number: number; airingAt: string } | null> {
    if (!this.enabled || kind !== 'tv') return null;
    const details = await this.fetchDetails(providerId, kind);
    const next = details?.next_episode_to_air;
    if (!next?.air_date) return null;
    return { number: next.episode_number, airingAt: toIso(next.air_date) ?? '' };
  }

  async health(): Promise<ProviderHealthReport> {
    if (!this.enabled) {
      return {
        provider: this.id,
        status: 'disabled',
        message: 'TMDB_API_KEY absente — films et séries indisponibles.',
        checkedAt: new Date(),
      };
    }
    try {
      await this.client.request(`/configuration?${this.params({})}`, {
        cacheKey: 'health',
        cacheTtl: CACHE_TTL.health,
      });
      return { provider: this.id, status: 'ok', message: null, checkedAt: new Date() };
    } catch (error) {
      return {
        provider: this.id,
        status: 'down',
        message: error instanceof Error ? error.message : String(error),
        checkedAt: new Date(),
      };
    }
  }

  private params(extra: Record<string, string>): string {
    if (!this.apiKey) throw new ProviderError(this.id, 'TMDB_API_KEY manquante');
    return new URLSearchParams({
      api_key: this.apiKey,
      language: 'fr-FR',
      ...extra,
    }).toString();
  }

  private async fetchDetails(providerId: string, kind: WorkKind): Promise<TmdbDetails | null> {
    const endpoint = kind === 'movie' ? 'movie' : 'tv';
    return this.client.request<TmdbDetails>(
      `/${endpoint}/${providerId}?${this.params({
        append_to_response: 'external_ids,translations,watch/providers',
      })}`,
      {
        cacheKey: cacheKeyOf('details', { id: providerId, kind }),
        cacheTtl: CACHE_TTL.details,
        nullOn404: true,
      },
    );
  }

  private toWork(item: TmdbSearchItem, kind: WorkKind): ProviderWork {
    const localized = item.name ?? item.title ?? null;
    const original = item.original_name ?? item.original_title ?? null;
    const date = item.first_air_date ?? item.release_date ?? null;
    const details = item as TmdbDetails;

    return {
      provider: this.id,
      providerId: String(item.id),
      kind,
      title: localized ?? original ?? 'Sans titre',
      titles: cleanTitles({
        fr: localized,
        en: original,
        ...Object.fromEntries(
          (details.translations?.translations ?? [])
            .map((translation) => [
              translation.iso_639_1,
              translation.data?.name ?? translation.data?.title ?? null,
            ])
            .filter(([, value]) => value),
        ),
      }),
      coverUrl: item.poster_path ? `${IMAGE_URL}/w500${item.poster_path}` : null,
      year: yearOf(date),
      releaseStatus: mapStatus(details.status),
      score: item.vote_average ?? null,
      totalUnits: details.number_of_episodes ?? (kind === 'movie' ? 1 : null),
      externals: [
        {
          provider: this.id,
          providerId: String(item.id),
          url: `https://www.themoviedb.org/${kind === 'movie' ? 'movie' : 'tv'}/${item.id}`,
        },
      ],
    };
  }
}

function mapStatus(status: string | null | undefined): ReleaseStatus {
  switch ((status ?? '').toLowerCase()) {
    case 'returning series':
    case 'in production':
      return 'ongoing';
    case 'ended':
    case 'released':
      return 'finished';
    case 'planned':
    case 'post production':
      return 'upcoming';
    case 'canceled':
    case 'cancelled':
      return 'cancelled';
    default:
      return 'unknown';
  }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
