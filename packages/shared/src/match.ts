import type { Titles, WorkKind } from './domain.js';

/**
 * Normalise un titre pour la comparaison inter-providers : minuscules, sans
 * accents, sans ponctuation, saisons et mentions de format retirées.
 * « Shingeki no Kyojin: The Final Season (TV) » → « shingeki no kyojin »
 */
export function normalizeTitle(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    // Marqueurs de déclinaison : les bases les écrivent différemment pour une
    // même œuvre (« Season 2 », « Saison 2 », « 2nd Season », « The Final Season »).
    .replace(/\b(the\s+)?(final|second|third)\b(?=\s|$)/g, ' ')
    .replace(/\b(tv|ova|ona|special|movie|film|saison|season|part|cour)\b\s*\d*/g, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Distance de Levenshtein, bornée par une matrice à deux lignes. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[b.length] ?? 0;
}

/** Similarité 0..1 entre deux titres déjà normalisés ou non. */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.92;
  const distance = levenshtein(na, nb);
  return 1 - distance / Math.max(na.length, nb.length);
}

/** Meilleure similarité entre deux jeux de titres multilingues. */
export function bestTitleSimilarity(a: Titles | string[], b: Titles | string[]): number {
  const listA = Array.isArray(a) ? a : Object.values(a);
  const listB = Array.isArray(b) ? b : Object.values(b);
  let best = 0;
  for (const ta of listA) {
    for (const tb of listB) {
      const score = titleSimilarity(ta, tb);
      if (score > best) best = score;
      if (best === 1) return 1;
    }
  }
  return best;
}

/** Seuil retenu pour fusionner deux œuvres sans identifiant croisé commun. */
export const MATCH_THRESHOLD = 0.86;

/**
 * Décide si deux candidats désignent la même œuvre : même famille, titres très
 * proches, et années compatibles (tolérance d'un an, les bases divergeant
 * souvent entre date de diffusion japonaise et sortie internationale).
 */
export function isSameWork(
  a: { kind: WorkKind; titles: Titles; year: number | null },
  b: { kind: WorkKind; titles: Titles; year: number | null },
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.year != null && b.year != null && Math.abs(a.year - b.year) > 1) return false;
  return bestTitleSimilarity(a.titles, b.titles) >= MATCH_THRESHOLD;
}

/** Choisit le titre à afficher selon les langues préférées de l'utilisateur. */
export function pickTitle(titles: Titles, languages: string[] = ['fr', 'en']): string {
  for (const lang of languages) {
    const value = titles[lang];
    if (value) return value;
  }
  return titles.en ?? titles.romaji ?? titles.native ?? Object.values(titles)[0] ?? 'Sans titre';
}
