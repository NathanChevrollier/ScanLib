import type { ReleaseStatus, WorkKind } from '@scanlib/shared';
import { RateLimitedClient, cacheKeyOf } from '../http/rate-limited-client.js';
import {
  CACHE_TTL,
  type MediaProvider,
  type ProviderConfig,
  type ProviderHealthReport,
  type ProviderWork,
  type ProviderWorkDetails,
  type SearchOptions,
} from '../types.js';
import { cleanTitles, toIso, yearOf } from '../util.js';

const BASE_URL = 'https://kitsu.io/api/edge';

interface KitsuResource {
  id: string;
  type: string;
  attributes: {
    slug?: string;
    canonicalTitle?: string;
    titles?: Record<string, string | null>;
    abbreviatedTitles?: string[] | null;
    synopsis?: string | null;
    description?: string | null;
    averageRating?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    status?: string | null;
    subtype?: string | null;
    episodeCount?: number | null;
    episodeLength?: number | null;
    chapterCount?: number | null;
    posterImage?: Record<string, string> | null;
    coverImage?: Record<string, string> | null;
  };
}

/**
 * Kitsu sert de source de secours quand Jikan est saturé, et surtout de source
 * d'appoint pour les titres et résumés localisés : c'est la seule base ouverte
 * qui expose régulièrement des titres français pour les animés et les mangas.
 */
export class KitsuProvider implements MediaProvider {
  readonly id = 'kitsu' as const;
  readonly label = 'Kitsu';
  readonly kinds = ['anime', 'manga'] as const;
  readonly enabled = true;

  private readonly client: RateLimitedClient;

  constructor(config: ProviderConfig) {
    this.client = new RateLimitedClient(
      this.id,
      BASE_URL,
      { requestsPerSecond: 5, concurrency: 3, maxRetries: 2 },
      config.cache,
      config.userAgent,
      config.logger,
      config.fetchImpl,
    );
  }

  async search(query: string, options: SearchOptions = {}): Promise<ProviderWork[]> {
    const kinds = (options.kinds ?? this.kinds).filter((kind) =>
      (this.kinds as readonly WorkKind[]).includes(kind),
    );
    if (kinds.length === 0) return [];
    const limit = Math.min(options.limit ?? 20, 20);
    const perKind = Math.max(5, Math.ceil(limit / kinds.length));

    const batches = await Promise.all(
      kinds.map(async (kind) => {
        const params = new URLSearchParams({
          'filter[text]': query,
          'page[limit]': String(perKind),
        });
        const response = await this.client.request<{ data?: KitsuResource[] }>(
          `/${kind}?${params.toString()}`,
          {
            cacheKey: cacheKeyOf('search', { q: query, kind, limit: perKind }),
            cacheTtl: CACHE_TTL.search,
            // Une recherche rend la main vite : les autres sources compensent.
            retries: 0,
            headers: { Accept: 'application/vnd.api+json' },
            ...(options.signal ? { signal: options.signal } : {}),
          },
        );
        return (response?.data ?? []).map((resource) => this.toWork(resource, kind));
      }),
    );

    return batches.flat().slice(0, limit);
  }

  async details(providerId: string, kind: WorkKind): Promise<ProviderWorkDetails | null> {
    const response = await this.client.request<{ data?: KitsuResource }>(
      `/${kind === 'manga' ? 'manga' : 'anime'}/${providerId}`,
      {
        cacheKey: cacheKeyOf('details', { id: providerId, kind }),
        cacheTtl: CACHE_TTL.details,
        headers: { Accept: 'application/vnd.api+json' },
        nullOn404: true,
      },
    );
    const resource = response?.data;
    if (!resource) return null;

    const base = this.toWork(resource, kind);
    const synopsis = resource.attributes.synopsis ?? resource.attributes.description ?? null;

    return {
      ...base,
      synopsis: synopsis ? { en: synopsis } : {},
      genres: [],
      bannerUrl: resource.attributes.coverImage?.large ?? null,
      averageRuntime: resource.attributes.episodeLength ?? null,
      startDate: toIso(resource.attributes.startDate ?? null),
      endDate: toIso(resource.attributes.endDate ?? null),
      studios: [],
      authors: [],
      availableLanguages: Object.keys(resource.attributes.titles ?? {}),
      nextRelease: null,
      updatedAt: new Date().toISOString(),
    };
  }

  async health(): Promise<ProviderHealthReport> {
    try {
      await this.client.request('/anime?page[limit]=1', {
        cacheKey: 'health',
        cacheTtl: CACHE_TTL.health,
        headers: { Accept: 'application/vnd.api+json' },
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

  private toWork(resource: KitsuResource, kind: WorkKind): ProviderWork {
    const titles = resource.attributes.titles ?? {};
    const rating = resource.attributes.averageRating
      ? Number(resource.attributes.averageRating) / 10
      : null;

    return {
      provider: this.id,
      providerId: resource.id,
      kind,
      title: titles.fr ?? titles.en ?? resource.attributes.canonicalTitle ?? 'Sans titre',
      titles: cleanTitles({
        fr: titles.fr ?? titles.fr_fr ?? null,
        en: titles.en ?? titles.en_us ?? null,
        romaji: titles.en_jp ?? resource.attributes.canonicalTitle ?? null,
        native: titles.ja_jp ?? null,
      }),
      coverUrl:
        resource.attributes.posterImage?.large ?? resource.attributes.posterImage?.medium ?? null,
      year: yearOf(resource.attributes.startDate ?? null),
      releaseStatus: mapStatus(resource.attributes.status),
      score: rating && Number.isFinite(rating) ? rating : null,
      totalUnits: resource.attributes.episodeCount ?? resource.attributes.chapterCount ?? null,
      externals: [
        {
          provider: this.id,
          providerId: resource.id,
          url: `https://kitsu.app/${kind}/${resource.attributes.slug ?? resource.id}`,
        },
      ],
    };
  }
}

function mapStatus(status: string | null | undefined): ReleaseStatus {
  switch (status) {
    case 'current':
      return 'ongoing';
    case 'finished':
      return 'finished';
    case 'upcoming':
    case 'unreleased':
    case 'tba':
      return 'upcoming';
    default:
      return 'unknown';
  }
}
