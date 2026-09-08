import { describe, expect, it } from 'vitest';
import { rankWorks, scoreWork } from '../src/ranking.js';
import type { ProviderWork } from '../src/types.js';

function work(title: string, extra: Partial<ProviderWork> = {}): ProviderWork {
  return {
    provider: 'mangadex',
    providerId: title,
    kind: 'manga',
    title,
    titles: { en: title },
    coverUrl: null,
    year: null,
    releaseStatus: 'unknown',
    score: null,
    totalUnits: null,
    externals: [],
    ...extra,
  };
}

describe('pertinence de la recherche', () => {
  it('place la série principale avant ses dérivés', () => {
    const ranked = rankWorks(
      [
        work('One Piece Doujinshi Collection'),
        work('One Piece Party'),
        work('One Piece', { score: 9.2, totalUnits: 1100, coverUrl: 'x', year: 1997 }),
        work('One Piece Color Walk Artbook'),
      ],
      'One Piece',
    );

    expect(ranked[0]?.title).toBe('One Piece');
  });

  it('privilégie la correspondance exacte sur un titre plus long', () => {
    expect(scoreWork(work('Frieren'), 'Frieren')).toBeGreaterThan(
      scoreWork(work('Frieren: Beyond Journey’s End — Anthology'), 'Frieren'),
    );
  });

  it('départage deux titres identiques par la notoriété', () => {
    const populaire = scoreWork(work('Berserk', { score: 9.4 }), 'Berserk');
    const inconnu = scoreWork(work('Berserk'), 'Berserk');
    expect(populaire).toBeGreaterThan(inconnu);
  });

  it('retrouve une œuvre depuis son titre français', () => {
    const ranked = rankWorks(
      [
        work('Naruto', { titles: { en: 'Naruto' } }),
        work('Attack on Titan', {
          titles: { en: 'Attack on Titan', fr: "L'Attaque des Titans" },
        }),
      ],
      'attaque des titans',
    );

    expect(ranked[0]?.title).toBe('Attack on Titan');
  });
});
