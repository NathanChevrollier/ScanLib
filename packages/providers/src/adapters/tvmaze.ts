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
  type UpcomingRelease,
} from '../types.js';
import { cleanTitles, compact, toIso, yearOf } from '../util.js';

const BASE_URL = 'https://api.tvmaze.com';

/* --- Réponses ------------------------------------------------------------ */

interface TvMazeShow {
  id: number;
  url?: string | null;
  name?: string | null;
  language?: string | null;
  genres?: string[];
  status?: string | null;
  runtime?: number | null;
  averageRuntime?: number | null;
  premiered?: string | null;
  ended?: string | null;
  officialSite?: string | null;
  schedule?: { time?: string | null; days?: string[] } | null;
  rating?: { average?: number | null } | null;
  network?: { name?: string | null; country?: { code?: string | null } | null } | null;
  webChannel?: { name?: string | null; country?: { code?: string | null } | null } | null;
  image?: { medium?: string | null; original?: string | null } | null;
  summary?: string | null;
  externals?: { tvrage?: number | null; thetvdb?: number | null; imdb?: string | null } | null;
  _embedded?: { episodes?: TvMazeEpisode[] };
}

interface TvMazeEpisode {
  id: number;
  name?: string | null;
  season?: number | null;
  number?: number | null;
  airstamp?: string | null;
  airdate?: string | null;
  runtime?: number | null;
  url?: string | null;
}

/**
 * TVmaze — base communautaire des séries télévisées.
 *
 * Elle comble le trou laissé par TMDB, qui demande une clé : sans
 * `TMDB_API_KEY`, aucune source ne couvrait la famille `tv`. Ouverte, sans clé
 * ni quota déclaré, elle publie surtout la grille de diffusion épisode par
 * épisode avec l'horodatage exact — de quoi pré-remplir les récurrences.
 */
export class TvMazeProvider implements MediaProvider {
  readonly id = 'tvmaze' as const;
  readonly label = 'TVmaze';
  readonly kinds = ['tv'] as const;
  readonly enabled = true;

  private readonly client: RateLimitedClient;

  constructor(config: ProviderConfig) {
    this.client = new RateLimitedClient(
      this.id,
      BASE_URL,
      { requestsPerSecond: 2, concurrency: 2, maxRetries: 2 },
      config.cache,
      config.userAgent,
      config.logger,
      config.fetchImpl,
    );
  }

  async search(query: string, options: SearchOptions = {}): Promise<ProviderWork[]> {
    const kinds = options.kinds ?? this.kinds;
    if (!kinds.includes('tv')) return [];

    const response = await this.client.request<{ show: TvMazeShow }[]>(
      `/search/shows?q=${encodeURIComponent(query)}`,
      {
        cacheKey: cacheKeyOf('search', { q: query }),
        cacheTtl: CACHE_TTL.search,
        // Une recherche rend la main vite : les autres sources compensent.
        retries: 0,
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );

    return (response ?? [])
      .slice(0, Math.min(options.limit ?? 20, 20))
      .map((row) => this.toWork(row.show));
  }

  async details(providerId: string): Promise<ProviderWorkDetails | null> {
    const show = await this.fetchShow(providerId);
    if (!show) return null;

    return {
      ...this.toWork(show),
      synopsis: show.summary ? { en: stripHtml(show.summary) } : {},
      genres: show.genres ?? [],
      bannerUrl: show.image?.original ?? null,
      averageRuntime: show.averageRuntime ?? show.runtime ?? null,
      startDate: toIso(show.premiered ?? null),
      endDate: toIso(show.ended ?? null),
      studios: compact([show.network?.name ?? null, show.webChannel?.name ?? null]),
      authors: [],
      availableLanguages: compact([show.language?.slice(0, 2).toLowerCase() ?? null]),
      nextRelease: await this.nextEpisodeOf(providerId),
      updatedAt: new Date().toISOString(),
    };
  }

  async units(providerId: string, _kind: WorkKind, options: UnitsOptions = {}): Promise<ProviderUnit[]> {
    const episodes = await this.fetchEpisodes(providerId);
    const since = options.since ? new Date(options.since).getTime() : null;

    const mapped = episodes
      .map((episode) => ({
        kind: 'episode' as const,
        number: episode.number ?? null,
        season: episode.season ?? null,
        title: episode.name ?? null,
        language: null,
        publishedAt: toIso(episode.airstamp ?? episode.airdate ?? null),
        runtime: episode.runtime ?? null,
        externalUrl: episode.url ?? null,
        isOfficial: false,
        source: this.id,
      }))
      // `since` évite de retraiter l'intégralité du catalogue à chaque passage.
      .filter((unit) => {
        if (since == null || !unit.publishedAt) return true;
        return new Date(unit.publishedAt).getTime() > since;
      });

    return options.limit ? mapped.slice(-options.limit) : mapped;
  }

  /**
   * TVmaze ne référence pas les plateformes par pays, mais donne le diffuseur
   * d'origine et le site officiel — deux liens sûrs, là où une URL devinée
   * finit souvent en 404.
   */
  async links(providerId: string): Promise<OfficialLink[]> {
    const show = await this.fetchShow(providerId);
    if (!show) return [];

    const links: OfficialLink[] = [];

    if (show.officialSite) {
      links.push({
        platform: 'site-officiel',
        platformLabel: 'Site officiel',
        kind: 'info',
        url: show.officialSite,
        language: show.language?.slice(0, 2).toLowerCase() ?? null,
        region: show.network?.country?.code ?? null,
        monetization: 'unknown',
        confidence: 'exact',
        official: true,
        source: this.id,
        logoUrl: null,
      });
    }

    const channel = show.webChannel?.name ?? null;
    const platform = channel ? resolvePlatform(channel) : null;
    if (channel && platform) {
      links.push({
        platform: platform.id,
        platformLabel: platform.label,
        kind: 'stream',
        url: `https://www.tvmaze.com/shows/${show.id}`,
        language: show.language?.slice(0, 2).toLowerCase() ?? null,
        region: show.webChannel?.country?.code ?? null,
        monetization: platform.monetization,
        // La plateforme est certaine, l'URL profonde ne l'est pas : le résolveur
        // saura la remplacer par un lien direct si une autre source en fournit un.
        confidence: 'site',
        official: true,
        source: this.id,
        logoUrl: null,
      });
    }

    return links;
  }

  async schedule(providerId: string): Promise<{ number: number; airingAt: string } | null> {
    const next = await this.nextEpisodeOf(providerId);
    return next ? { number: next.number, airingAt: next.airingAt } : null;
  }

  /** Toutes les diffusions à venir — le calendrier en déduit la cadence réelle. */
  async upcoming(providerId: string): Promise<UpcomingRelease[]> {
    const now = Date.now();
    const episodes = await this.fetchEpisodes(providerId);

    return compact(
      episodes.map((episode) => {
        const airingAt = toIso(episode.airstamp ?? episode.airdate ?? null);
        if (!airingAt || new Date(airingAt).getTime() < now) return null;
        return {
          number: episode.number ?? 0,
          airingAt,
          title: episode.name ?? null,
        };
      }),
    );
  }

  async health(): Promise<ProviderHealthReport> {
    try {
      await this.client.request('/shows/1', { cacheKey: 'health', cacheTtl: CACHE_TTL.health });
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

  private async fetchShow(providerId: string): Promise<TvMazeShow | null> {
    return this.client.request<TvMazeShow>(`/shows/${providerId}`, {
      cacheKey: cacheKeyOf('show', { id: providerId }),
      cacheTtl: CACHE_TTL.details,
      nullOn404: true,
    });
  }

  private async fetchEpisodes(providerId: string): Promise<TvMazeEpisode[]> {
    const response = await this.client.request<TvMazeEpisode[]>(
      `/shows/${providerId}/episodes`,
      {
        cacheKey: cacheKeyOf('episodes', { id: providerId }),
        cacheTtl: CACHE_TTL.units,
        nullOn404: true,
      },
    );
    return response ?? [];
  }

  private async nextEpisodeOf(providerId: string): Promise<UpcomingRelease | null> {
    const upcoming = await this.upcoming(providerId);
    return upcoming[0] ?? null;
  }

  private toWork(show: TvMazeShow): ProviderWork {
    const language = show.language?.slice(0, 2).toLowerCase() ?? 'en';

    return {
      provider: this.id,
      providerId: String(show.id),
      kind: 'tv',
      title: show.name ?? 'Sans titre',
      titles: cleanTitles({ [language]: show.name ?? null }),
      coverUrl: show.image?.original ?? show.image?.medium ?? null,
      year: yearOf(show.premiered ?? null),
      releaseStatus: mapStatus(show.status),
      // TVmaze note sur 10, comme ScanLib.
      score: show.rating?.average ?? null,
      // Le nombre d'épisodes n'est pas publié sur la fiche : il faudrait charger
      // toute la grille, ce qu'une ligne de recherche ne justifie pas.
      totalUnits: null,
      externals: [
        {
          provider: this.id,
          providerId: String(show.id),
          url: show.url ?? `https://www.tvmaze.com/shows/${show.id}`,
        },
      ],
    };
  }
}

function mapStatus(status: string | null | undefined): ReleaseStatus {
  switch (status) {
    case 'Running':
      return 'ongoing';
    case 'Ended':
      return 'finished';
    case 'To Be Determined':
    case 'In Development':
      return 'upcoming';
    default:
      return 'unknown';
  }
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();
}
