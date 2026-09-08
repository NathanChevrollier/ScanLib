import type { OfficialLink, ReleaseStatus, WorkKind } from '@scanlib/shared';
import { RateLimitedClient, cacheKeyOf } from '../http/rate-limited-client.js';
import { resolvePlatform } from '../links/platforms.js';
import {
  CACHE_TTL,
  type MediaProvider,
  type ProviderConfig,
  type ProviderHealthReport,
  type ProviderUnit,
  type ProviderWork,
  type ProviderWorkDetails,
  type SearchOptions,
  type UnitsOptions,
} from '../types.js';
import { cleanTitles, compact, minutesOf, parseNumber, toIso, uniq, yearOf } from '../util.js';

const BASE_URL = 'https://api.jikan.moe/v4';

/* --- Formes de réponse Jikan utilisées ici (sous-ensemble typé) ---------- */

interface JikanImage {
  jpg?: { image_url?: string; large_image_url?: string };
  webp?: { image_url?: string; large_image_url?: string };
}

interface JikanNamed {
  name?: string;
}

interface JikanEntry {
  mal_id: number;
  url?: string;
  images?: JikanImage;
  title?: string;
  title_english?: string | null;
  title_japanese?: string | null;
  titles?: { type?: string; title?: string }[];
  type?: string | null;
  status?: string | null;
  score?: number | null;
  synopsis?: string | null;
  year?: number | null;
  episodes?: number | null;
  chapters?: number | null;
  duration?: string | null;
  aired?: { from?: string | null; to?: string | null };
  published?: { from?: string | null; to?: string | null };
  genres?: JikanNamed[];
  themes?: JikanNamed[];
  studios?: JikanNamed[];
  authors?: JikanNamed[];
  streaming?: { name?: string; url?: string }[];
  external?: { name?: string; url?: string }[];
  broadcast?: { day?: string | null; time?: string | null; timezone?: string | null };
}

interface JikanList<T> {
  data: T[];
  pagination?: { has_next_page?: boolean; last_visible_page?: number };
}

interface JikanEpisode {
  mal_id: number;
  url?: string | null;
  title?: string | null;
  title_japanese?: string | null;
  aired?: string | null;
  filler?: boolean;
  recap?: boolean;
}

/**
 * Jikan expose MyAnimeList sans clé d'API. C'est la source primaire pour les
 * animés et les mangas depuis que l'API AniList est indisponible : elle couvre
 * les métadonnées, la liste des épisodes, les liens de streaming officiels
 * (`/anime/{id}/full` → `streaming`) et les recommandations.
 */
export class JikanProvider implements MediaProvider {
  readonly id = 'jikan' as const;
  readonly label = 'MyAnimeList (Jikan)';
  readonly kinds = ['anime', 'manga'] as const;
  readonly enabled = true;

  private readonly client: RateLimitedClient;

  constructor(config: ProviderConfig) {
    this.client = new RateLimitedClient(
      this.id,
      BASE_URL,
      // Limites publiques : 3 req/s et 60 req/min. On reste volontairement sous
      // le seuil, une seule requête à la fois.
      { requestsPerSecond: 2, concurrency: 1, maxRetries: 3 },
      config.cache,
      config.userAgent,
      config.logger,
      config.fetchImpl,
    );
  }

  async search(query: string, options: SearchOptions = {}): Promise<ProviderWork[]> {
    const limit = Math.min(options.limit ?? 20, 25);
    const kinds = (options.kinds ?? this.kinds).filter((kind) =>
      (this.kinds as readonly WorkKind[]).includes(kind),
    );
    if (kinds.length === 0) return [];

    const perKind = Math.max(5, Math.ceil(limit / kinds.length));
    const batches = await Promise.all(
      kinds.map(async (kind) => {
        const endpoint = kind === 'manga' ? '/manga' : '/anime';
        const params = new URLSearchParams({
          q: query,
          limit: String(perKind),
          sfw: 'true',
          order_by: 'members',
          sort: 'desc',
        });
        const response = await this.client.request<JikanList<JikanEntry>>(
          `${endpoint}?${params.toString()}`,
          {
            cacheKey: cacheKeyOf('search', { q: query, kind, limit: perKind }),
            cacheTtl: CACHE_TTL.search,
            // Une recherche rend la main vite : les autres sources compensent.
            retries: 0,
            ...(options.signal ? { signal: options.signal } : {}),
          },
        );
        return (response?.data ?? []).map((entry) => this.toWork(entry, kind));
      }),
    );

    return batches.flat().slice(0, limit);
  }

  async details(providerId: string, kind: WorkKind): Promise<ProviderWorkDetails | null> {
    const entry = await this.fetchFull(providerId, kind);
    if (!entry) return null;

    const base = this.toWork(entry, kind);
    const dates = kind === 'manga' ? entry.published : entry.aired;

    return {
      ...base,
      synopsis: entry.synopsis ? { en: entry.synopsis } : {},
      genres: uniq(compact([...(entry.genres ?? []), ...(entry.themes ?? [])].map((g) => g.name))),
      bannerUrl: null,
      averageRuntime: minutesOf(entry.duration),
      startDate: toIso(dates?.from ?? null),
      endDate: toIso(dates?.to ?? null),
      studios: compact((entry.studios ?? []).map((s) => s.name)),
      authors: compact((entry.authors ?? []).map((a) => a.name)),
      availableLanguages: ['ja'],
      nextRelease: null,
      updatedAt: new Date().toISOString(),
    };
  }

  async units(
    providerId: string,
    kind: WorkKind,
    options: UnitsOptions = {},
  ): Promise<ProviderUnit[]> {
    // MyAnimeList ne référence pas les chapitres individuellement : seuls les
    // épisodes d'animés sont exploitables ici (MangaDex prend le relais côté scans).
    if (kind !== 'anime') return [];

    const limit = options.limit ?? 2000;
    const units: ProviderUnit[] = [];
    let page = 1;

    while (units.length < limit && page <= 20) {
      const response = await this.client.request<JikanList<JikanEpisode>>(
        `/anime/${providerId}/episodes?page=${page}`,
        {
          cacheKey: cacheKeyOf('episodes', { id: providerId, page }),
          cacheTtl: CACHE_TTL.units,
          nullOn404: true,
          ...(options.signal ? { signal: options.signal } : {}),
        },
      );
      const data = response?.data ?? [];
      if (data.length === 0) break;

      for (const episode of data) {
        units.push({
          kind: 'episode',
          number: units.length + 1,
          season: 1,
          title: episode.title ?? null,
          language: 'ja',
          publishedAt: toIso(episode.aired ?? null),
          runtime: null,
          // L'URL MAL est informative, pas un lien de visionnage.
          externalUrl: null,
          isOfficial: false,
          source: this.id,
        });
      }

      if (!response?.pagination?.has_next_page) break;
      page += 1;
    }

    return units;
  }

  /**
   * Liens officiels : `streaming` liste les plateformes légales (Crunchyroll,
   * Netflix, ADN…) avec une URL directe vers l'œuvre — ce sont les liens les
   * plus fiables disponibles sans clé d'API.
   */
  async links(providerId: string, kind: WorkKind): Promise<OfficialLink[]> {
    const entry = await this.fetchFull(providerId, kind);
    if (!entry) return [];

    const links: OfficialLink[] = [];

    for (const stream of entry.streaming ?? []) {
      if (!stream.url || !stream.name) continue;
      const platform = resolvePlatform(stream.name);
      links.push({
        platform: platform?.id ?? slug(stream.name),
        platformLabel: platform?.label ?? stream.name,
        kind: 'stream',
        url: stream.url,
        language: null,
        region: null,
        monetization: platform?.monetization ?? 'unknown',
        confidence: 'exact',
        official: true,
        source: this.id,
        logoUrl: null,
      });
    }

    for (const external of entry.external ?? []) {
      if (!external.url || !external.name) continue;
      const platform = resolvePlatform(external.name);
      // On ne garde des liens externes que ceux menant à une lecture officielle
      // (Manga Plus, Shonen Jump+, Bookwalker…), pas les wikis et bases de données.
      if (!platform || platform.kind === 'info') continue;
      links.push({
        platform: platform.id,
        platformLabel: platform.label,
        kind: platform.kind,
        url: external.url,
        language: platform.languages[0] ?? null,
        region: null,
        monetization: platform.monetization,
        confidence: 'exact',
        official: true,
        source: this.id,
        logoUrl: null,
      });
    }

    return links;
  }

  async recommendations(providerId: string, kind: WorkKind): Promise<ProviderWork[]> {
    const endpoint = kind === 'manga' ? 'manga' : 'anime';
    const response = await this.client.request<JikanList<{ entry?: JikanEntry }>>(
      `/${endpoint}/${providerId}/recommendations`,
      {
        cacheKey: cacheKeyOf('reco', { id: providerId, kind }),
        cacheTtl: CACHE_TTL.details,
        nullOn404: true,
      },
    );
    return compact((response?.data ?? []).map((item) => item.entry)).map((entry) =>
      this.toWork(entry, kind),
    );
  }

  async health(): Promise<ProviderHealthReport> {
    try {
      await this.client.request<JikanList<JikanEntry>>('/anime?q=one&limit=1', {
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

  private async fetchFull(providerId: string, kind: WorkKind): Promise<JikanEntry | null> {
    const endpoint = kind === 'manga' ? 'manga' : 'anime';
    const response = await this.client.request<{ data: JikanEntry }>(
      `/${endpoint}/${providerId}/full`,
      {
        cacheKey: cacheKeyOf('full', { id: providerId, kind }),
        cacheTtl: CACHE_TTL.details,
        nullOn404: true,
      },
    );
    return response?.data ?? null;
  }

  private toWork(entry: JikanEntry, kind: WorkKind): ProviderWork {
    const synonyms = entry.titles ?? [];
    const romaji = synonyms.find((t) => t.type === 'Default')?.title ?? entry.title;
    const dates = kind === 'manga' ? entry.published : entry.aired;

    return {
      provider: this.id,
      providerId: String(entry.mal_id),
      kind,
      title: entry.title_english ?? entry.title ?? romaji ?? 'Sans titre',
      titles: cleanTitles({
        en: entry.title_english ?? null,
        romaji: romaji ?? null,
        native: entry.title_japanese ?? null,
      }),
      coverUrl:
        entry.images?.webp?.large_image_url ??
        entry.images?.jpg?.large_image_url ??
        entry.images?.jpg?.image_url ??
        null,
      year: entry.year ?? yearOf(dates?.from ?? null),
      releaseStatus: mapStatus(entry.status),
      score: entry.score ?? null,
      totalUnits: parseNumber(kind === 'manga' ? entry.chapters : entry.episodes),
      externals: [
        {
          provider: this.id,
          providerId: String(entry.mal_id),
          url: entry.url ?? null,
        },
      ],
    };
  }
}

function mapStatus(status: string | null | undefined): ReleaseStatus {
  switch ((status ?? '').toLowerCase()) {
    case 'currently airing':
    case 'publishing':
      return 'ongoing';
    case 'finished airing':
    case 'finished':
      return 'finished';
    case 'not yet aired':
    case 'not yet published':
      return 'upcoming';
    case 'on hiatus':
      return 'hiatus';
    case 'discontinued':
      return 'cancelled';
    default:
      return 'unknown';
  }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
