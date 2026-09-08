import { formatDistanceToNowStrict, format, isToday, isTomorrow } from 'date-fns';
import { enGB, fr } from 'date-fns/locale';
import type { Unit, WorkKind } from '@scanlib/shared';
import type { UiLanguage } from './i18n';

const locales = { fr, en: enGB };

export function formatDate(value: string | Date, language: UiLanguage = 'fr'): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return format(date, language === 'fr' ? 'd MMM yyyy' : 'd MMM yyyy', {
    locale: locales[language],
  });
}

/** « Aujourd'hui », « Demain », puis la date courte. */
export function formatRelativeDay(value: string | Date, language: UiLanguage = 'fr'): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (isToday(date)) return language === 'fr' ? "Aujourd'hui" : 'Today';
  if (isTomorrow(date)) return language === 'fr' ? 'Demain' : 'Tomorrow';
  return format(date, language === 'fr' ? 'EEEE d MMMM' : 'EEEE d MMMM', {
    locale: locales[language],
  });
}

export function formatAgo(value: string | Date, language: UiLanguage = 'fr'): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return formatDistanceToNowStrict(date, { addSuffix: true, locale: locales[language] });
}

/** 1 380 minutes → « 23 h ». Au-delà de 48 h, on bascule en jours. */
export function formatMinutes(minutes: number, language: UiLanguage = 'fr'): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return language === 'fr' ? `${hours} h` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return language === 'fr' ? `${days} j ${rest} h` : `${days}d ${rest}h`;
}

export function formatNumber(value: number, language: UiLanguage = 'fr'): string {
  return new Intl.NumberFormat(language === 'fr' ? 'fr-FR' : 'en-GB').format(value);
}

/** Libellé court d'une unité : « Ch. 1050 », « S2 E12 ». */
export function unitLabel(unit: Unit, language: UiLanguage = 'fr'): string {
  if (unit.kind === 'chapter') {
    const prefix = language === 'fr' ? 'Ch.' : 'Ch.';
    return unit.number != null ? `${prefix} ${unit.number}` : (unit.title ?? prefix);
  }
  const season = unit.season != null && unit.season > 0 ? `S${unit.season} ` : '';
  return unit.number != null ? `${season}E${unit.number}` : (unit.title ?? 'Épisode');
}

export const kindColors: Record<WorkKind, string> = {
  manga: 'var(--color-manga)',
  anime: 'var(--color-anime)',
  tv: 'var(--color-tv)',
  movie: 'var(--color-movie)',
};

/** Pourcentage borné, pour les barres de progression. */
export function percent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}
