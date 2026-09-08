import type { OfficialLink, ReleaseStatus, WorkKind } from '@scanlib/shared';
import { RateLimitedClient, cacheKeyOf } from '../http/rate-limited-client.js';
import { resolvePlatform } from '../links/platforms.js';
import {
  CACHE_TTL,
  type MediaProvider,
  type ProviderConfig,
  type ProviderHealthReport,
  type ProviderWork,
  type ProviderWorkDetails,
  type SearchOptions,
  type UpcomingRelease,
} from '../types.js';
import { cleanTitles, compact, toIso } from '../util.js';

const ENDPOINT = 'https://graphql.anilist.co';

/* --- Réponses GraphQL ---------------------------------------------------- */

interface AniListMedia {
  id: number;
  siteUrl?: string | null;
  type?: 'ANIME' | 'MANGA';
  format?: string | null;
  status?: string | null;
  averageScore?: number | null;
  episodes?: number | null;
  chapters?: number | null;
  duration?: number | null;
  seasonYear?: number | null;
  description?: string | null;
  genres?: string[];
  bannerImage?: string | null;
  coverImage?: { extraLarge?: string | null; large?: string | null };
  title?: { romaji?: string | null; english?: string | null; native?: string | null };
  synonyms?: string[];
  startDate?: { year?: number | null; month?: number | null; day?: number | null };
  endDate?: { year?: number | null; month?: number | null; day?: number | null };
  studios?: { nodes?: { name?: string }[] };
  nextAiringEpisode?: { episode: number; airingAt: number } | null;
  externalLinks?: {
    site?: string | null;
    url?: string | null;
    type?: string | null;
    language?: string | null;
    icon?: string | null;
    isDisabled?: boolean | null;
  }[];
}

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: { message: string; status?: number }[];
}

const MEDIA_FIELDS = `
  id siteUrl type format status averageScore episodes chapters duration seasonYear description(asHtml: false)
  genres bannerImage
  coverImage { extraLarge large }
  title { romaji english native }
  synonyms
  startDate { year month day }
  endDate { year month day }
  studios { nodes { name } }
  nextAiringEpisode { episode airingAt }
  externalLinks { site url type language icon isDisabled }
`;

/**
 * AniList fournit les meilleurs liens de streaming (`externalLinks` typés
 * STREAMING avec la langue) et le calendrier de diffusion à la minute.
 *
 * Son API est cependant régulièrement coupée par ses mainteneurs — elle
 * renvoyait encore « API temporarily disabled due to severe stability issues »
 * lors de l'écriture de cet adapter. Elle est donc désactivée par défaut
 * (`ENABLE_ANILIST`) et le registre bascule sur Jikan et Kitsu sans broncher.
 */
export class AniListProvider implements MediaProvider {
  readonly id = 'anilist' as const;
  readonly label = 'AniList';
  readonly kinds = ['anime', 'manga'] as const;
  readonly enabled: boolean;

  private readonly client: RateLimitedClient;

  constructor(config: ProviderConfig) {
    this.enabled = config.enableAnilist;
    this.client = new RateLimitedClient(
      this.id,
      ENDPOINT,
      { requestsPerSecond: 1, concurrency: 1, maxRetries: 1 },
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

    const results: ProviderWork[] = [];
    for (const kind of kinds) {
      const response = await this.query<{ Page?: { media?: AniListMedia[] } }>(
        `query ($search: String, $type: MediaType, $perPage: Int) {
           Page(perPage: $perPage) { media(search: $search, type: $type, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} } }
         }`,
        { search: query, type: kind === 'manga' ? 'MANGA' : 'ANIME', perPage: options.limit ?? 15 },
        cacheKeyOf('search', { q: query, kind }),
        CACHE_TTL.search,
      );
      for (const media of response?.Page?.media ?? []) results.push(this.toWork(media, kind));
    }
    return results;
  }

  async details(providerId: string, kind: WorkKind): Promise<ProviderWorkDetails | null> {
    if (!this.enabled) return null;
    const media = await this.fetchMedia(providerId);
    if (!media) return null;

    const base = this.toWork(media, kind);
    return {
      ...base,
      synopsis: media.description ? { en: stripHtml(media.description) } : {},
      genres: media.genres ?? [],
      bannerUrl: media.bannerImage ?? null,
      averageRuntime: media.duration ?? null,
      startDate: fuzzyDate(media.startDate),
      endDate: fuzzyDate(media.endDate),
      studios: compact((media.studios?.nodes ?? []).map((node) => node.name)),
      authors: [],
      availableLanguages: compact(
        (media.externalLinks ?? []).map((link) => link.language?.toLowerCase() ?? null),
      ),
      nextRelease: media.nextAiringEpisode
        ? {
            number: media.nextAiringEpisode.episode,
            airingAt: new Date(media.nextAiringEpisode.airingAt * 1000).toISOString(),
          }
        : null,
      updatedAt: new Date().toISOString(),
    };
  }

  /** Les liens les plus précis du projet : URL directe + langue du contenu. */
  async links(providerId: string): Promise<OfficialLink[]> {
    if (!this.enabled) return [];
    const media = await this.fetchMedia(providerId);
    if (!media) return [];

    return compact(
      (media.externalLinks ?? []).map((link) => {
        if (!link.url || !link.site || link.isDisabled) return null;
        const type = (link.type ?? '').toUpperCase();
        if (type !== 'STREAMING' && type !== 'READING') return null;
        const platform = resolvePlatform(link.site);
        const language = link.language?.toLowerCase() ?? null;
        return {
          platform: platform?.id ?? link.site.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          platformLabel: platform?.label ?? link.site,
          kind: type === 'READING' ? ('read' as const) : ('stream' as const),
          url: link.url,
          language: language === 'french' ? 'fr' : language === 'english' ? 'en' : language,
          region: null,
          monetization: platform?.monetization ?? 'unknown',
          confidence: 'exact' as const,
          official: true,
          source: this.id,
          logoUrl: link.icon ?? null,
        };
      }),
    );
  }

  async schedule(providerId: string): Promise<{ number: number; airingAt: string } | null> {
    if (!this.enabled) return null;
    const media = await this.fetchMedia(providerId);
    if (!media?.nextAiringEpisode) return null;
    return {
      number: media.nextAiringEpisode.episode,
      airingAt: new Date(media.nextAiringEpisode.airingAt * 1000).toISOString(),
    };
  }

  /**
   * Grille complète des diffusions à venir. AniList publie l'horodatage à la
   * minute de chaque épisode non encore diffusé : deux dates suffisent à
   * déduire la cadence d'une série.
   */
  async upcoming(providerId: string): Promise<UpcomingRelease[]> {
    if (!this.enabled) return [];
    const response = await this.query<{
      Media?: { airingSchedule?: { nodes?: { episode: number; airingAt: number }[] } };
    }>(
      `query ($id: Int) {
         Media(id: $id) {
           airingSchedule(notYetAired: true, perPage: 25) { nodes { episode airingAt } }
         }
       }`,
      { id: Number(providerId) },
      cacheKeyOf('upcoming', { id: providerId }),
      CACHE_TTL.schedule,
    );

    return (response?.Media?.airingSchedule?.nodes ?? []).map((node) => ({
      number: node.episode,
      airingAt: new Date(node.airingAt * 1000).toISOString(),
      title: null,
    }));
  }

  async health(): Promise<ProviderHealthReport> {
    if (!this.enabled) {
      return {
        provider: this.id,
        status: 'disabled',
        message: 'Désactivé par configuration (ENABLE_ANILIST=false).',
        checkedAt: new Date(),
      };
    }
    try {
      await this.query<{ Media?: { id: number } }>(
        'query { Media(id: 1) { id } }',
        {},
        'health',
        CACHE_TTL.health,
      );
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

  private async fetchMedia(providerId: string): Promise<AniListMedia | null> {
    const response = await this.query<{ Media?: AniListMedia }>(
      `query ($id: Int) { Media(id: $id) { ${MEDIA_FIELDS} } }`,
      { id: Number(providerId) },
      cacheKeyOf('media', { id: providerId }),
      CACHE_TTL.details,
    );
    return response?.Media ?? null;
  }

  private async query<T>(
    query: string,
    variables: Record<string, unknown>,
    cacheKey: string,
    cacheTtl: number,
  ): Promise<T | null> {
    const response = await this.client.request<GraphQLResponse<T>>('', {
      method: 'POST',
      body: { query, variables },
      cacheKey,
      cacheTtl,
    });
    // AniList répond 200 avec un tableau `errors` — et 403 quand l'API est coupée.
    if (response?.errors?.length) {
      throw new Error(response.errors.map((error) => error.message).join(' / '));
    }
    return response?.data ?? null;
  }

  private toWork(media: AniListMedia, kind: WorkKind): ProviderWork {
    return {
      provider: this.id,
      providerId: String(media.id),
      kind,
      title: media.title?.english ?? media.title?.romaji ?? 'Sans titre',
      titles: cleanTitles({
        en: media.title?.english ?? null,
        romaji: media.title?.romaji ?? null,
        native: media.title?.native ?? null,
      }),
      coverUrl: media.coverImage?.extraLarge ?? media.coverImage?.large ?? null,
      year: media.seasonYear ?? media.startDate?.year ?? null,
      releaseStatus: mapStatus(media.status),
      score: media.averageScore ? media.averageScore / 10 : null,
      totalUnits: kind === 'manga' ? (media.chapters ?? null) : (media.episodes ?? null),
      externals: [
        { provider: this.id, providerId: String(media.id), url: media.siteUrl ?? null },
      ],
    };
  }
}

function mapStatus(status: string | null | undefined): ReleaseStatus {
  switch (status) {
    case 'RELEASING':
      return 'ongoing';
    case 'FINISHED':
      return 'finished';
    case 'NOT_YET_RELEASED':
      return 'upcoming';
    case 'HIATUS':
      return 'hiatus';
    case 'CANCELLED':
      return 'cancelled';
    default:
      return 'unknown';
  }
}

function fuzzyDate(date: AniListMedia['startDate']): string | null {
  if (!date?.year) return null;
  const month = String(date.month ?? 1).padStart(2, '0');
  const day = String(date.day ?? 1).padStart(2, '0');
  return toIso(`${date.year}-${month}-${day}`);
}

function stripHtml(value: string): string {
  return value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
}
