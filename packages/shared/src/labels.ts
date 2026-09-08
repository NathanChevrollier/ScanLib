import type { LibraryStatus, ReleaseStatus, WorkKind, Monetization } from './domain.js';

type Bilingual = { fr: string; en: string };

export const workKindLabels: Record<WorkKind, Bilingual> = {
  manga: { fr: 'Scan / Manga', en: 'Manga' },
  anime: { fr: 'Animé', en: 'Anime' },
  tv: { fr: 'Série', en: 'TV series' },
  movie: { fr: 'Film', en: 'Movie' },
};

export const libraryStatusLabels: Record<LibraryStatus, Bilingual> = {
  planned: { fr: 'À commencer', en: 'Planned' },
  in_progress: { fr: 'En cours', en: 'In progress' },
  on_hold: { fr: 'En pause', en: 'On hold' },
  dropped: { fr: 'Abandonné', en: 'Dropped' },
  completed: { fr: 'Terminé', en: 'Completed' },
  revisiting: { fr: 'Relecture / Revisionnage', en: 'Revisiting' },
};

/** Couleur d'accent par statut, réutilisée par les badges et les graphiques. */
export const libraryStatusColors: Record<LibraryStatus, string> = {
  planned: '#8b8fa3',
  in_progress: '#3b82f6',
  on_hold: '#f59e0b',
  dropped: '#ef4444',
  completed: '#22c55e',
  revisiting: '#a855f7',
};

export const releaseStatusLabels: Record<ReleaseStatus, Bilingual> = {
  ongoing: { fr: 'En cours de publication', en: 'Ongoing' },
  finished: { fr: 'Terminé', en: 'Finished' },
  upcoming: { fr: 'À venir', en: 'Upcoming' },
  hiatus: { fr: 'En pause', en: 'Hiatus' },
  cancelled: { fr: 'Annulé', en: 'Cancelled' },
  unknown: { fr: 'Inconnu', en: 'Unknown' },
};

export const monetizationLabels: Record<Monetization, Bilingual> = {
  free: { fr: 'Gratuit', en: 'Free' },
  ads: { fr: 'Gratuit avec pub', en: 'Free with ads' },
  sub: { fr: 'Abonnement', en: 'Subscription' },
  rent: { fr: 'Location', en: 'Rent' },
  buy: { fr: 'Achat', en: 'Buy' },
  unknown: { fr: 'Disponibilité inconnue', en: 'Unknown' },
};

/** Statuts considérés comme « en cours » pour les files d'attente et le calendrier. */
export const activeStatuses: LibraryStatus[] = ['in_progress', 'revisiting'];

/**
 * Durées par défaut utilisées pour estimer le temps passé quand la source ne
 * donne pas de durée : 24 min pour un épisode d'animé, 45 pour une série,
 * 5 min pour un chapitre lu.
 */
export const estimatedRuntimeMinutes: Record<WorkKind, number> = {
  manga: 5,
  anime: 24,
  tv: 45,
  movie: 110,
};
