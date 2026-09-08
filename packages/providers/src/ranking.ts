import { normalizeTitle, titleSimilarity } from '@scanlib/shared';
import type { ProviderWork } from './types.js';

/**
 * Mots qui trahissent une œuvre dérivée. Chercher « One Piece » doit remonter
 * la série, pas ses trente doujinshi, artbooks et anthologies — c'est ce qui
 * rendait la recherche décevante.
 */
const DERIVATIVE_MARKERS =
  /\b(doujin(shi)?|anthology|artbook|art book|fanbook|databook|guidebook|parody|parodie|spin[- ]?off|colored|full colou?r|novel|light novel|恋|4[- ]?koma|omake|magazine|calendar|calendrier)\b/i;

/** Éditions alternatives : légitimes, mais rarement ce qu'on cherche en premier. */
const EDITION_MARKERS =
  /\b(remaster(ed)?|edition|édition|deluxe|perfect|omnibus|bunko|kanzenban|coffret|box)\b/i;

export interface RankedWork extends ProviderWork {
  /** Score de pertinence, conservé pour le tri et le débogage. */
  relevance: number;
}

/**
 * Note un résultat par rapport à la requête.
 *
 * Trois composantes : la correspondance du titre (dominante), la notoriété de
 * l'œuvre, et des pénalités pour les dérivés. Sans notoriété, une obscure
 * anthologie au titre exact passerait devant la série principale ; sans
 * pénalité, les doujinshi noieraient les vrais résultats.
 */
export function scoreWork(work: ProviderWork, query: string): number {
  const normalizedQuery = normalizeTitle(query);
  if (!normalizedQuery) return 0;

  const titles = Object.values(work.titles);
  if (work.title) titles.push(work.title);

  let best = 0;
  for (const title of titles) {
    const normalized = normalizeTitle(title);
    if (!normalized) continue;

    let score: number;
    if (normalized === normalizedQuery) score = 100;
    else if (normalized.startsWith(`${normalizedQuery} `)) score = 78;
    else if (normalized.startsWith(normalizedQuery)) score = 72;
    else if (normalized.includes(` ${normalizedQuery} `) || normalized.includes(`${normalizedQuery} `))
      score = 55;
    else score = titleSimilarity(normalized, normalizedQuery) * 50;

    // Un titre bien plus long que la requête est probablement une déclinaison.
    const extra = normalized.length - normalizedQuery.length;
    if (extra > 0) score -= Math.min(18, extra / 3);

    if (score > best) best = score;
  }

  // Notoriété : une note publique élevée signale l'œuvre de référence.
  if (work.score != null) best += Math.min(15, work.score * 1.5);
  // Une œuvre dont on connaît le nombre de chapitres est une vraie série suivie.
  if (work.totalUnits != null && work.totalUnits > 1) best += 4;
  if (work.coverUrl) best += 3;
  if (work.year != null) best += 2;

  const haystack = titles.join(' ');
  if (DERIVATIVE_MARKERS.test(haystack)) best -= 45;
  else if (EDITION_MARKERS.test(haystack)) best -= 12;

  return best;
}

/** Trie les résultats par pertinence décroissante. */
export function rankWorks(works: ProviderWork[], query: string): RankedWork[] {
  return works
    .map((work) => ({ ...work, relevance: scoreWork(work, query) }))
    .sort((a, b) => b.relevance - a.relevance);
}
