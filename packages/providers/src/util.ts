import type { Titles } from '@scanlib/shared';

export function uniq<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function compact<T>(values: (T | null | undefined)[]): T[] {
  return values.filter((value): value is T => value != null);
}

/** Retire les entrées vides d'un dictionnaire de titres. */
export function cleanTitles(titles: Record<string, string | null | undefined>): Titles {
  const result: Titles = {};
  for (const [lang, title] of Object.entries(titles)) {
    const trimmed = title?.trim();
    if (trimmed) result[lang] = trimmed;
  }
  return result;
}

/** Extrait une année depuis une date ISO partielle ou une chaîne libre. */
export function yearOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /(\d{4})/.exec(value);
  if (!match?.[1]) return null;
  const year = Number(match[1]);
  return year >= 1900 && year <= 2200 ? year : null;
}

/** Convertit une date quelconque en ISO, ou null si invalide. */
export function toIso(value: string | number | Date | null | undefined): string | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Parse un numéro de chapitre/épisode potentiellement décimal ou vide. */
export function parseNumber(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Extrait le nombre de minutes depuis un texte type « 24 min per ep ». */
export function minutesOf(duration: string | null | undefined): number | null {
  if (!duration) return null;
  const hours = /(\d+)\s*hr/.exec(duration);
  const minutes = /(\d+)\s*min/.exec(duration);
  const total = (hours?.[1] ? Number(hours[1]) * 60 : 0) + (minutes?.[1] ? Number(minutes[1]) : 0);
  return total > 0 ? total : null;
}
