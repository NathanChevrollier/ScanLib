import type { ExternalRef, OfficialLink, ReleaseStatus, Titles, WorkKind } from '@scanlib/shared';
import { RateLimitedClient, cacheKeyOf } from '../http/rate-limited-client.js';
import { resolvePlatformByUrl } from '../links/platforms.js';
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
import { cleanTitles, compact, parseNumber, toIso, uniq } from '../util.js';

const BASE_URL = 'https://api.mangadex.org';
const COVERS_URL = 'https://uploads.mangadex.org/covers';

/* --- Formes de réponse MangaDex ----------------------------------------- */

interface MdRelationship {
  id: string;
  type: string;
  attributes?: { fileName?: string; name?: string };
}

interface MdManga {
  id: string;
  type: 'manga';
  attributes: {
    title: Record<string, string>;
    altTitles?: Record<string, string>[];
    description?: Record<string, string>;
    links?: Record<string, string> | null;
    originalLanguage?: string;
    lastVolume?: string | null;
    lastChapter?: string | null;
    status?: string;
    year?: number | null;
    contentRating?: string;
    tags?: { attributes?: { name?: Record<string, string> } }[];
    availableTranslatedLanguages?: (string | null)[];
    latestUploadedChapter?: string | null;
    createdAt?: string;
    updatedAt?: string;
  };
  relationships?: MdRelationship[];
}

interface MdChapter {
  id: string;
  attributes: {
    volume?: string | null;
    chapter?: string | null;
    title?: string | null;
    translatedLanguage?: string | null;
    externalUrl?: string | null;
    publishAt?: string | null;
    readableAt?: string | null;
    pages?: number;
  };
}

interface MdList<T> {
  result: string;
  data: T[];
  limit?: number;
  offset?: number;
  total?: number;
}

interface MdSingle<T> {
  result: string;
  data: T;
}

interface MdStatistics {
  statistics: Record<string, { rating?: { average?: number | null; bayesian?: number | null } }>;
}

/**
 * MangaDex est la source de référence côté scans : catalogue multilingue,
 * index des chapitres avec langue de traduction, et surtout les liens de
 * lecture officiels — `attributes.links` (éditeurs et libraires) ainsi que les
 * chapitres portant un `externalUrl` qui pointent vers MANGA Plus, Azuki ou
 * Bilibili Comics, c'est-à-dire de la lecture légale et gratuite.
 */
export class MangaDexProvider implements MediaProvider {
  readonly id = 'mangadex' as const;
  readonly label = 'MangaDex';
  readonly kinds = ['manga'] as const;
  readonly enabled = true;

  private readonly client: RateLimitedClient;

  constructor(config: ProviderConfig) {
    this.client = new RateLimitedClient(
      this.id,
      BASE_URL,
      // Limite globale annoncée : 5 req/s.
      { requestsPerSecond: 4, concurrency: 2, maxRetries: 3 },
      config.cache,
      config.userAgent,
      config.logger,
      config.fetchImpl,
    );
  }

  async search(query: string, options: SearchOptions = {}): Promise<ProviderWork[]> {
    if (options.kinds && !options.kinds.includes('manga')) return [];
    const limit = Math.min(options.limit ?? 20, 50);

    const params = new URLSearchParams({ title: query, limit: String(limit) });
    params.append('includes[]', 'cover_art');
    params.append('includes[]', 'author');
    params.append('order[relevance]', 'desc');
    for (const rating of ['safe', 'suggestive', 'erotica']) {
      params.append('contentRating[]', rating);
    }

    const response = await this.client.request<MdList<MdManga>>(`/manga?${params.toString()}`, {
      cacheKey: cacheKeyOf('search', { q: query, limit }),
      cacheTtl: CACHE_TTL.search,
      retries: 0,
      ...(options.signal ? { signal: options.signal } : {}),
    });

    return (response?.data ?? []).map((manga) => this.toWork(manga));
  }

  async details(providerId: string): Promise<ProviderWorkDetails | null> {
    const params = new URLSearchParams();
    for (const include of ['cover_art', 'author', 'artist']) {
      params.append('includes[]', include);
    }

    const response = await this.client.request<MdSingle<MdManga>>(
      `/manga/${providerId}?${params.toString()}`,
      {
        cacheKey: cacheKeyOf('details', { id: providerId }),
        cacheTtl: CACHE_TTL.details,
        nullOn404: true,
      },
    );
    const manga = response?.data;
    if (!manga) return null;

    const base = this.toWork(manga);
    const authors = compact(
      (manga.relationships ?? [])
        .filter((rel) => rel.type === 'author' || rel.type === 'artist')
        .map((rel) => rel.attributes?.name),
    );

    return {
      ...base,
      synopsis: cleanTitles(manga.attributes.description ?? {}),
      genres: compact(
        (manga.attributes.tags ?? []).map((tag) => tag.attributes?.name?.en ?? undefined),
      ),
      bannerUrl: null,
      averageRuntime: null,
      startDate: manga.attributes.year ? `${manga.attributes.year}-01-01T00:00:00.000Z` : null,
      endDate: null,
      studios: [],
      authors: uniq(authors),
      availableLanguages: compact(manga.attributes.availableTranslatedLanguages ?? []),
      nextRelease: null,
      updatedAt: toIso(manga.attributes.updatedAt ?? null),
    };
  }

  /**
   * Index des chapitres. On interroge le flux dans les langues demandées et on
   * remonte le `externalUrl` quand il existe : dans ce cas le chapitre n'est pas
   * hébergé par MangaDex mais lisible gratuitement chez l'éditeur.
   */
  async units(
    providerId: string,
    _kind: WorkKind,
    options: UnitsOptions = {},
  ): Promise<ProviderUnit[]> {
    const languages = options.languages?.length ? options.languages : ['fr', 'en'];
    const max = options.limit ?? 1500;
    const units: ProviderUnit[] = [];
    let offset = 0;

    /*
     * Mode incrémental : quand on connaît déjà la date du dernier chapitre, on
     * demande les plus récents d'abord et on s'arrête dès qu'ils sont antérieurs.
     * Une série de mille chapitres coûtait quinze requêtes à chaque passage,
     * six fois par jour, pour découvrir un seul chapitre — elle en coûte une.
     */
    const since = options.since ? new Date(options.since) : null;

    while (units.length < max) {
      const params = new URLSearchParams({ limit: '100', offset: String(offset) });
      for (const language of languages) params.append('translatedLanguage[]', language);
      for (const rating of ['safe', 'suggestive', 'erotica']) {
        params.append('contentRating[]', rating);
      }
      if (since) {
        params.append('order[publishAt]', 'desc');
        // Format attendu par MangaDex : ISO sans millisecondes ni fuseau.
        params.append('publishAtSince', since.toISOString().slice(0, 19));
      } else {
        params.append('order[chapter]', 'asc');
        params.append('order[volume]', 'asc');
      }
      params.append('includeExternalUrl', '1');

      const response = await this.client.request<MdList<MdChapter>>(
        `/manga/${providerId}/feed?${params.toString()}`,
        {
          cacheKey: cacheKeyOf('feed', {
            id: providerId,
            offset,
            languages,
            ...(since ? { since: since.toISOString().slice(0, 13) } : {}),
          }),
          cacheTtl: CACHE_TTL.units,
          nullOn404: true,
          ...(options.signal ? { signal: options.signal } : {}),
        },
      );

      const data = response?.data ?? [];
      for (const chapter of data) {
        const external = chapter.attributes.externalUrl ?? null;
        const platform = external ? resolvePlatformByUrl(external) : undefined;
        units.push({
          kind: 'chapter',
          number: parseNumber(chapter.attributes.chapter),
          season: parseNumber(chapter.attributes.volume)
            ? Math.trunc(parseNumber(chapter.attributes.volume) as number)
            : null,
          title: chapter.attributes.title?.trim() || null,
          language: chapter.attributes.translatedLanguage ?? null,
          publishedAt: toIso(chapter.attributes.readableAt ?? chapter.attributes.publishAt ?? null),
          runtime: null,
          externalUrl: external ?? `https://mangadex.org/chapter/${chapter.id}`,
          isOfficial: Boolean(external && platform?.official),
          source: this.id,
        });
      }

      const total = response?.total ?? 0;
      offset += 100;
      if (data.length === 0 || offset >= total) break;
    }

    return dedupeChapters(units, languages);
  }

  /**
   * Liens officiels dérivés de `attributes.links`. Les clés sont documentées
   * par MangaDex : `engtl` (licence anglaise), `raw` (édition d'origine),
   * `bw` / `amz` / `ebj` / `cdj` (achat légal), le reste étant informatif.
   */
  async links(providerId: string): Promise<OfficialLink[]> {
    const response = await this.client.request<MdSingle<MdManga>>(`/manga/${providerId}`, {
      cacheKey: cacheKeyOf('links', { id: providerId }),
      cacheTtl: CACHE_TTL.links,
      nullOn404: true,
    });
    const attributes = response?.data.attributes;
    if (!attributes) return [];

    const links: OfficialLink[] = [];
    const raw = attributes.links ?? {};

    for (const [key, value] of Object.entries(raw)) {
      const url = expandLink(key, value);
      if (!url) continue;
      const meta = LINK_KEYS[key];
      if (!meta) continue;

      const platform = resolvePlatformByUrl(url);
      links.push({
        platform: platform?.id ?? key,
        platformLabel: platform?.label ?? meta.label,
        kind: platform?.kind ?? meta.kind,
        url,
        language: meta.language,
        region: meta.region,
        monetization: platform?.monetization ?? meta.monetization,
        confidence: 'exact',
        official: meta.official,
        source: this.id,
        logoUrl: null,
      });
    }

    // Un chapitre officiel hébergé ailleurs (MANGA Plus…) vaut un lien de lecture
    // direct : on remonte le plus récent trouvé dans le flux.
    const officialChapter = (await this.units(providerId, 'manga', { limit: 100 })).find(
      (unit) => unit.isOfficial && unit.externalUrl,
    );
    if (officialChapter?.externalUrl) {
      const platform = resolvePlatformByUrl(officialChapter.externalUrl);
      if (platform && !links.some((link) => link.platform === platform.id)) {
        links.push({
          platform: platform.id,
          platformLabel: platform.label,
          kind: 'read',
          url: officialChapter.externalUrl,
          language: officialChapter.language,
          region: null,
          monetization: platform.monetization,
          confidence: 'exact',
          official: true,
          source: this.id,
          logoUrl: null,
        });
      }
    }

    links.push({
      platform: 'mangadex',
      platformLabel: 'MangaDex',
      kind: 'info',
      url: `https://mangadex.org/title/${providerId}`,
      language: null,
      region: null,
      monetization: 'free',
      confidence: 'exact',
      official: false,
      source: this.id,
      logoUrl: null,
    });

    return links;
  }

  async health(): Promise<ProviderHealthReport> {
    try {
      await this.client.request<MdList<MdManga>>('/manga?limit=1', {
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

  /** Note moyenne : endpoint séparé, appelé seulement quand on en a besoin. */
  async rating(providerId: string): Promise<number | null> {
    const response = await this.client.request<MdStatistics>(`/statistics/manga/${providerId}`, {
      cacheKey: cacheKeyOf('stats', { id: providerId }),
      cacheTtl: CACHE_TTL.details,
      nullOn404: true,
    });
    const stats = response?.statistics?.[providerId]?.rating;
    return stats?.bayesian ?? stats?.average ?? null;
  }

  private toWork(manga: MdManga): ProviderWork {
    const titles = buildTitles(manga);
    const cover = (manga.relationships ?? []).find((rel) => rel.type === 'cover_art');
    const fileName = cover?.attributes?.fileName;

    return {
      provider: this.id,
      providerId: manga.id,
      kind: 'manga',
      title: titles.fr ?? titles.en ?? titles.romaji ?? titles.native ?? 'Sans titre',
      titles,
      coverUrl: fileName ? `${COVERS_URL}/${manga.id}/${fileName}.512.jpg` : null,
      year: manga.attributes.year ?? null,
      releaseStatus: mapStatus(manga.attributes.status),
      score: null,
      totalUnits: parseNumber(manga.attributes.lastChapter),
      externals: buildExternals(manga),
    };
  }
}

/* --- Fonctions utilitaires ---------------------------------------------- */

function buildTitles(manga: MdManga): Titles {
  const titles: Record<string, string> = {};
  for (const [lang, value] of Object.entries(manga.attributes.title ?? {})) {
    titles[normalizeLang(lang)] = value;
  }
  for (const alt of manga.attributes.altTitles ?? []) {
    for (const [lang, value] of Object.entries(alt)) {
      const key = normalizeLang(lang);
      if (!titles[key]) titles[key] = value;
    }
  }
  return cleanTitles(titles);
}

/** MangaDex utilise `ja-ro` pour le romaji et `ja` pour le japonais natif. */
function normalizeLang(lang: string): string {
  if (lang === 'ja-ro') return 'romaji';
  if (lang === 'ja') return 'native';
  if (lang === 'zh-hk') return 'zh';
  return lang;
}

function buildExternals(manga: MdManga): ExternalRef[] {
  const externals: ExternalRef[] = [
    {
      provider: 'mangadex',
      providerId: manga.id,
      url: `https://mangadex.org/title/${manga.id}`,
    },
  ];
  const links = manga.attributes.links ?? {};
  // Les identifiants croisés fournis par MangaDex évitent une réconciliation
  // par similarité de titre lors de la fusion avec les résultats Jikan.
  if (links.mal) {
    externals.push({
      provider: 'jikan',
      providerId: links.mal,
      url: `https://myanimelist.net/manga/${links.mal}`,
    });
  }
  if (links.al) {
    externals.push({
      provider: 'anilist',
      providerId: links.al,
      url: `https://anilist.co/manga/${links.al}`,
    });
  }
  if (links.kt) {
    externals.push({
      provider: 'kitsu',
      providerId: links.kt,
      url: `https://kitsu.app/manga/${links.kt}`,
    });
  }
  return externals;
}

interface LinkKeyMeta {
  label: string;
  kind: OfficialLink['kind'];
  monetization: OfficialLink['monetization'];
  language: string | null;
  region: string | null;
  official: boolean;
}

/** Signification des clés de `attributes.links` (documentation MangaDex). */
const LINK_KEYS: Record<string, LinkKeyMeta> = {
  engtl: {
    label: 'Édition officielle anglaise',
    kind: 'read',
    monetization: 'unknown',
    language: 'en',
    region: 'US',
    official: true,
  },
  raw: {
    label: 'Édition originale',
    kind: 'read',
    monetization: 'unknown',
    language: 'ja',
    region: 'JP',
    official: true,
  },
  bw: {
    label: 'BOOK☆WALKER',
    kind: 'buy',
    monetization: 'buy',
    language: 'ja',
    region: 'JP',
    official: true,
  },
  amz: {
    label: 'Amazon',
    kind: 'buy',
    monetization: 'buy',
    language: null,
    region: null,
    official: true,
  },
  ebj: {
    label: 'ebookjapan',
    kind: 'buy',
    monetization: 'buy',
    language: 'ja',
    region: 'JP',
    official: true,
  },
  cdj: {
    label: 'CDJapan',
    kind: 'buy',
    monetization: 'buy',
    language: 'ja',
    region: 'JP',
    official: true,
  },
};

/** Certaines clés stockent un identifiant partiel plutôt qu'une URL complète. */
function expandLink(key: string, value: string): string | null {
  if (!value) return null;
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  switch (key) {
    case 'bw':
      return `https://bookwalker.jp/${value}`;
    case 'mal':
      return `https://myanimelist.net/manga/${value}`;
    case 'al':
      return `https://anilist.co/manga/${value}`;
    case 'ap':
      return `https://www.anime-planet.com/manga/${value}`;
    case 'mu':
      return `https://www.mangaupdates.com/series/${value}`;
    case 'nu':
      return `https://www.novelupdates.com/series/${value}`;
    case 'kt':
      return `https://kitsu.app/manga/${value}`;
    default:
      return null;
  }
}

/**
 * Un même chapitre existe souvent en plusieurs traductions et par plusieurs
 * groupes. On n'en garde qu'une par numéro, en privilégiant la langue la plus
 * haut placée dans les préférences puis une source officielle.
 */
function dedupeChapters(units: ProviderUnit[], languages: string[]): ProviderUnit[] {
  const best = new Map<string, ProviderUnit>();

  for (const unit of units) {
    const key = unit.number == null ? `t:${unit.title ?? Math.random()}` : `n:${unit.number}`;
    const current = best.get(key);
    if (!current) {
      best.set(key, unit);
      continue;
    }
    if (rank(unit, languages) < rank(current, languages)) best.set(key, unit);
  }

  return [...best.values()].sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
}

function rank(unit: ProviderUnit, languages: string[]): number {
  const languageRank = unit.language ? languages.indexOf(unit.language) : -1;
  return (languageRank === -1 ? languages.length : languageRank) * 10 + (unit.isOfficial ? 0 : 1);
}

function mapStatus(status: string | null | undefined): ReleaseStatus {
  switch (status) {
    case 'ongoing':
      return 'ongoing';
    case 'completed':
      return 'finished';
    case 'hiatus':
      return 'hiatus';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'unknown';
  }
}
