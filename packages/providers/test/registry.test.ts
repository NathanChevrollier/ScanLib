import { describe, expect, it } from 'vitest';
import { mergeWorks } from '../src/registry.js';
import { isSameWork, normalizeTitle, titleSimilarity } from '@scanlib/shared';
import type { ProviderWork } from '../src/types.js';

function work(partial: Partial<ProviderWork> & Pick<ProviderWork, 'provider' | 'providerId'>): ProviderWork {
  return {
    kind: 'anime',
    title: 'Titre',
    titles: {},
    coverUrl: null,
    year: null,
    releaseStatus: 'unknown',
    score: null,
    totalUnits: null,
    externals: [{ provider: partial.provider, providerId: partial.providerId }],
    ...partial,
  };
}

describe('normalisation des titres', () => {
  it('ignore accents, ponctuation, saisons et années', () => {
    expect(normalizeTitle('Shingeki no Kyojin: The Final Season (TV)')).toBe('shingeki no kyojin');
    expect(normalizeTitle("L'Attaque des Titans")).toBe('lattaque des titans');
    expect(normalizeTitle('Frieren – Season 2 – 2026')).toBe('frieren');
  });

  it('rapproche deux orthographes proches', () => {
    expect(titleSimilarity('Jujutsu Kaisen', 'Jujutsu Kaisen 2')).toBeGreaterThan(0.85);
    expect(titleSimilarity('One Piece', 'Naruto')).toBeLessThan(0.5);
  });
});

describe('rapprochement des œuvres', () => {
  it('refuse de fusionner deux familles différentes', () => {
    expect(
      isSameWork(
        { kind: 'manga', titles: { en: 'One Piece' }, year: 1999 },
        { kind: 'anime', titles: { en: 'One Piece' }, year: 1999 },
      ),
    ).toBe(false);
  });

  it('refuse de fusionner deux adaptations éloignées dans le temps', () => {
    expect(
      isSameWork(
        { kind: 'anime', titles: { en: 'Fullmetal Alchemist' }, year: 2003 },
        { kind: 'anime', titles: { en: 'Fullmetal Alchemist' }, year: 2009 },
      ),
    ).toBe(false);
  });
});

describe('fusion des résultats de recherche', () => {
  it('regroupe deux sources partageant un identifiant croisé', () => {
    const merged = mergeWorks([
      work({
        provider: 'mangadex',
        providerId: 'uuid',
        kind: 'manga',
        title: 'One Piece',
        titles: { en: 'One Piece' },
        externals: [
          { provider: 'mangadex', providerId: 'uuid' },
          { provider: 'jikan', providerId: '13' },
        ],
      }),
      work({
        provider: 'jikan',
        providerId: '13',
        kind: 'manga',
        title: 'One Piece',
        titles: { en: 'One Piece' },
        score: 9.2,
      }),
    ]);

    expect(merged).toHaveLength(1);
    // MangaDex prime sur Jikan pour les scans, mais la note vient de Jikan.
    expect(merged[0]?.provider).toBe('mangadex');
    expect(merged[0]?.score).toBe(9.2);
  });

  it('privilégie le titre français quand une source en fournit un', () => {
    const merged = mergeWorks([
      work({
        provider: 'jikan',
        providerId: '16498',
        title: 'Attack on Titan',
        titles: { en: 'Attack on Titan', romaji: 'Shingeki no Kyojin' },
        year: 2013,
      }),
      work({
        provider: 'kitsu',
        providerId: '7442',
        title: 'L’Attaque des Titans',
        titles: { fr: 'L’Attaque des Titans', en: 'Attack on Titan' },
        year: 2013,
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.title).toBe('L’Attaque des Titans');
    expect(merged[0]?.externals).toHaveLength(2);
  });

  it('ne fusionne pas deux œuvres différentes', () => {
    const merged = mergeWorks([
      work({ provider: 'jikan', providerId: '1', title: 'Naruto', titles: { en: 'Naruto' } }),
      work({ provider: 'jikan', providerId: '2', title: 'Bleach', titles: { en: 'Bleach' } }),
    ]);
    expect(merged).toHaveLength(2);
  });
});
