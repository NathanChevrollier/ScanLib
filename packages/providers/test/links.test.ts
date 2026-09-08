import { describe, expect, it } from 'vitest';
import { MemoryCache } from '../src/http/rate-limited-client.js';
import { MangaDexProvider } from '../src/adapters/mangadex.js';
import { JikanProvider } from '../src/adapters/jikan.js';
import { OfficialLinkResolver } from '../src/links/resolver.js';
import { ProviderRegistry } from '../src/registry.js';
import {
  platformUrl,
  resolvePlatform,
  resolvePlatformByUrl,
  suggestedPlatforms,
} from '../src/links/platforms.js';
import type { ProviderConfig } from '../src/types.js';

/**
 * Réponses réduites, calquées sur des retours réels des API — c'est le format
 * exact qui compte ici, pas le volume de données.
 */
const mangadexManga = {
  result: 'ok',
  data: {
    id: 'a1c7c817-4e59-43b7-9365-09675a149a6f',
    type: 'manga',
    attributes: {
      title: { en: 'One Piece' },
      altTitles: [{ 'ja-ro': 'One Piece' }, { fr: 'One Piece' }, { ja: 'ワンピース' }],
      description: { en: 'Gol D. Roger…', fr: 'Gol D. Roger…' },
      links: {
        al: '30013',
        mal: '13',
        raw: 'https://shonenjumpplus.com/episode/13932016480028799982',
        engtl: 'https://www.viz.com/shonenjump/chapters/one-piece',
        bw: 'series/113268',
        amz: 'https://www.amazon.co.jp/gp/product/B074CF5JP3',
      },
      status: 'ongoing',
      year: 1999,
      lastChapter: '1100',
      availableTranslatedLanguages: ['fr', 'en'],
      updatedAt: '2026-01-01T00:00:00+00:00',
    },
    relationships: [
      { id: 'cover', type: 'cover_art', attributes: { fileName: 'cover.jpg' } },
      { id: 'author', type: 'author', attributes: { name: 'Oda Eiichiro' } },
    ],
  },
};

const mangadexFeed = {
  result: 'ok',
  data: [
    {
      id: 'chapter-1',
      attributes: {
        chapter: '1100',
        title: 'Le début',
        translatedLanguage: 'fr',
        externalUrl: null,
        publishAt: '2026-01-01T00:00:00+00:00',
        readableAt: '2026-01-01T00:00:00+00:00',
        pages: 20,
      },
    },
    {
      id: 'chapter-2',
      attributes: {
        chapter: '1101',
        title: null,
        translatedLanguage: 'en',
        externalUrl: 'https://mangaplus.shueisha.co.jp/viewer/1017899',
        publishAt: '2026-01-08T00:00:00+00:00',
        readableAt: '2026-01-08T00:00:00+00:00',
        pages: 0,
      },
    },
  ],
  total: 2,
};

function configWith(handler: (url: string) => unknown): ProviderConfig {
  return {
    userAgent: 'ScanLib/test',
    enableAnilist: false,
    languages: ['fr', 'en'],
    regions: ['FR', 'US'],
    cache: new MemoryCache(),
    fetchImpl: (async (input: string | URL | Request) => {
      const url = String(input);
      const payload = handler(url);
      return new Response(JSON.stringify(payload ?? {}), {
        status: payload ? 200 : 404,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch,
  };
}

describe('registre de plateformes', () => {
  it('reconnaît une plateforme malgré les suffixes de TMDB', () => {
    expect(resolvePlatform('Crunchyroll Amazon Channel')?.id).toBe('crunchyroll');
    expect(resolvePlatform('Animation Digital Network')?.id).toBe('adn');
    expect(resolvePlatform('Netflix basic with Ads')?.id).toBe('netflix');
  });

  it('reconnaît une plateforme depuis une URL de lecture officielle', () => {
    expect(resolvePlatformByUrl('https://www.viz.com/shonenjump/chapters/one-piece')?.id).toBe(
      'viz',
    );
    expect(resolvePlatformByUrl('https://mangaplus.shueisha.co.jp/viewer/1017899')?.id).toBe(
      'mangaplus',
    );
    expect(resolvePlatformByUrl('https://shonenjumpplus.com/episode/139')?.id).toBe(
      'shonenjumpplus',
    );
  });

  it('propose les plateformes de lecture françaises pour les scans', () => {
    const ids = suggestedPlatforms('manga', ['fr'], ['FR']).map((platform) => platform.id);
    expect(ids).toContain('webtoon');
    expect(ids).toContain('delitoon');
    expect(ids).toContain('izneo');
  });

  it('écarte les plateformes dont la recherche n’a pas pu être vérifiée', () => {
    // ADN, Mangas.io, Glénat et consorts sont des applications JavaScript sans
    // URL de recherche exploitable : mieux vaut ne rien proposer qu'un lien qui
    // tombe à côté. Elles restent reconnues quand une API y renvoie.
    const anime = suggestedPlatforms('anime', ['fr'], ['FR']).map((platform) => platform.id);
    expect(anime).not.toContain('adn');
    expect(anime).toContain('crunchyroll');

    const manga = suggestedPlatforms('manga', ['fr'], ['FR']).map((platform) => platform.id);
    expect(manga).not.toContain('mangas-io');
    expect(manga).not.toContain('glenat');

    expect(resolvePlatform('Animation Digital Network')?.id).toBe('adn');
  });

  it('classe la lecture avant la librairie', () => {
    const platforms = suggestedPlatforms('manga', ['fr'], ['FR']);
    const premierAchat = platforms.findIndex((platform) => platform.kind === 'buy');
    const derniereLecture = platforms.map((p) => p.kind).lastIndexOf('read');
    expect(derniereLecture).toBeLessThan(premierAchat);
  });

  it("n'inclut pas les bases de données dans les suggestions", () => {
    const ids = suggestedPlatforms('anime', ['fr', 'en'], ['FR']).map((platform) => platform.id);
    expect(ids).not.toContain('myanimelist');
    expect(ids).not.toContain('nautiljon');
  });

  it('ne propose que des adresses réellement atteignables', () => {
    // Chaque plateforme suggérée doit fournir soit une recherche vérifiée, soit
    // une page de catalogue — jamais une URL inventée.
    for (const kind of ['manga', 'anime', 'tv', 'movie'] as const) {
      for (const platform of suggestedPlatforms(kind, [], [])) {
        const target = platformUrl(platform, 'One Piece');
        expect(target).not.toBeNull();
        expect(target!.url).toMatch(/^https:\/\//);
      }
    }
  });
});

describe('MangaDex', () => {
  const provider = new MangaDexProvider(
    configWith((url) => {
      if (url.includes('/feed')) return mangadexFeed;
      if (url.includes('/manga/')) return mangadexManga;
      return null;
    }),
  );

  it('traduit les clés `links` en liens officiels typés', async () => {
    const links = await provider.links('a1c7c817-4e59-43b7-9365-09675a149a6f');
    const byPlatform = new Map(links.map((link) => [link.platform, link]));

    expect(byPlatform.get('viz')).toMatchObject({ kind: 'read', official: true, language: 'en' });
    expect(byPlatform.get('shonenjumpplus')).toMatchObject({ kind: 'read', language: 'ja' });
    expect(byPlatform.get('bookwalker')?.url).toBe('https://bookwalker.jp/series/113268');
    expect(byPlatform.get('mangadex')?.kind).toBe('info');
  });

  it('remonte un chapitre hébergé chez un éditeur comme lecture officielle', async () => {
    const links = await provider.links('a1c7c817-4e59-43b7-9365-09675a149a6f');
    const mangaplus = links.find((link) => link.platform === 'mangaplus');
    expect(mangaplus).toMatchObject({ kind: 'read', official: true, confidence: 'exact' });
  });

  it('marque les chapitres officiels et garde une seule langue par numéro', async () => {
    const units = await provider.units('a1c7c817-4e59-43b7-9365-09675a149a6f', 'manga', {
      languages: ['fr', 'en'],
    });
    expect(units).toHaveLength(2);
    expect(units[0]).toMatchObject({ number: 1100, language: 'fr', isOfficial: false });
    expect(units[1]).toMatchObject({ number: 1101, isOfficial: true });
  });

  it('expose les identifiants croisés pour le rapprochement des œuvres', async () => {
    const details = await provider.details('a1c7c817-4e59-43b7-9365-09675a149a6f');
    const providers = details?.externals.map((external) => external.provider);
    expect(providers).toContain('jikan');
    expect(providers).toContain('anilist');
  });
});

describe('OfficialLinkResolver', () => {
  it('préfère le lien direct à la recherche et classe les officiels en tête', async () => {
    const registry = new ProviderRegistry(
      configWith((url) => {
        if (url.includes('api.jikan.moe')) {
          return {
            data: {
              mal_id: 21,
              title: 'One Piece',
              titles: [{ type: 'Default', title: 'One Piece' }],
              status: 'Currently Airing',
              streaming: [
                { name: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/GRMG8ZQZR' },
              ],
              external: [],
            },
          };
        }
        return null;
      }),
    );

    const resolver = new OfficialLinkResolver(registry);
    const { links } = await resolver.resolve(
      {
        kind: 'anime',
        title: 'One Piece',
        titles: { en: 'One Piece' },
        externals: [{ provider: 'jikan', providerId: '21' }],
      },
      { languages: ['fr', 'en'], regions: ['FR'], officialOnly: true },
    );

    const crunchyroll = links.filter((link) => link.platform === 'crunchyroll');
    expect(crunchyroll).toHaveLength(1);
    expect(crunchyroll[0]).toMatchObject({
      confidence: 'exact',
      url: 'https://www.crunchyroll.com/series/GRMG8ZQZR',
    });
    // Les plateformes vérifiées complètent la liste, et rien d'autre.
    expect(links.some((link) => link.platform === 'arte' && link.confidence === 'search')).toBe(
      true,
    );
    expect(links.every((link) => link.confidence !== 'site')).toBe(true);
  });

  it('place les sources personnalisées avant le registre livré', async () => {
    const registry = new ProviderRegistry(configWith(() => null));
    const resolver = new OfficialLinkResolver(registry);

    const { links } = await resolver.resolve(
      { kind: 'anime', title: 'Frieren', titles: { fr: 'Frieren' }, externals: [] },
      {
        languages: ['fr'],
        regions: ['FR'],
        officialOnly: false,
        customPlatforms: [
          {
            id: 'ma-source',
            label: 'Ma source',
            kind: 'stream',
            urlTemplate: 'https://exemple.fr/recherche?q={titre}',
            language: 'fr',
            worksFor: [],
          },
        ],
      },
    );

    expect(links[0]?.platformLabel).toBe('Ma source');
    expect(links[0]?.url).toBe('https://exemple.fr/recherche?q=Frieren');
  });

  it('cherche avec le titre de la langue préférée', async () => {
    const registry = new ProviderRegistry(configWith(() => null));
    const resolver = new OfficialLinkResolver(registry);

    const { links } = await resolver.resolve(
      {
        kind: 'manga',
        title: 'Attack on Titan',
        titles: { fr: "L'Attaque des Titans", en: 'Attack on Titan' },
        externals: [],
      },
      { languages: ['fr'], regions: ['FR'] },
    );

    const izneo = links.find((link) => link.platform === 'izneo');
    expect(izneo?.url).toContain(encodeURIComponent("L'Attaque des Titans"));
  });

  it('remonte les plateformes possédées en tête de liste', async () => {
    const registry = new ProviderRegistry(configWith(() => null));
    const resolver = new OfficialLinkResolver(registry);

    const { links } = await resolver.resolve(
      { kind: 'manga', title: 'Test', titles: { fr: 'Test' }, externals: [] },
      { languages: ['fr'], regions: ['FR'], ownedPlatforms: ['izneo'] },
    );

    expect(links[0]?.platform).toBe('izneo');
  });
});

describe('Jikan', () => {
  it('ne retient que les liens externes menant à une lecture officielle', async () => {
    const provider = new JikanProvider(
      configWith(() => ({
        data: {
          mal_id: 13,
          title: 'One Piece',
          status: 'Publishing',
          streaming: [],
          external: [
            { name: 'Wikipedia', url: 'https://fr.wikipedia.org/wiki/One_Piece' },
            { name: 'Manga Plus', url: 'https://mangaplus.shueisha.co.jp/titles/100020' },
          ],
        },
      })),
    );

    const links = await provider.links('13', 'manga');
    expect(links.map((link) => link.platform)).toEqual(['mangaplus']);
  });
});
