import { z } from 'zod';

/* -------------------------------------------------------------------------
 * Énumérations de base
 * ---------------------------------------------------------------------- */

/** Les quatre familles d'œuvres suivies par ScanLib. */
export const workKinds = ['manga', 'anime', 'tv', 'movie'] as const;
export const workKindSchema = z.enum(workKinds);
export type WorkKind = z.infer<typeof workKindSchema>;

/** Une « unité » est un chapitre (scan) ou un épisode (animé / série). */
export const unitKinds = ['chapter', 'episode'] as const;
export const unitKindSchema = z.enum(unitKinds);
export type UnitKind = z.infer<typeof unitKindSchema>;

/** Unité attendue pour chaque famille d'œuvre. Un film n'a qu'une seule unité. */
export function unitKindFor(kind: WorkKind): UnitKind {
  return kind === 'manga' ? 'chapter' : 'episode';
}

export const providerIds = ['jikan', 'kitsu', 'mangadex', 'tmdb', 'anilist', 'tvmaze'] as const;
export const providerIdSchema = z.enum(providerIds);
export type ProviderId = z.infer<typeof providerIdSchema>;

/** Statut de publication de l'œuvre elle-même (pas celui de l'utilisateur). */
export const releaseStatuses = [
  'ongoing',
  'finished',
  'upcoming',
  'hiatus',
  'cancelled',
  'unknown',
] as const;
export const releaseStatusSchema = z.enum(releaseStatuses);
export type ReleaseStatus = z.infer<typeof releaseStatusSchema>;

/** Statut posé par l'utilisateur sur une œuvre de sa bibliothèque. */
export const libraryStatuses = [
  'planned',
  'in_progress',
  'on_hold',
  'dropped',
  'completed',
  'revisiting',
] as const;
export const libraryStatusSchema = z.enum(libraryStatuses);
export type LibraryStatus = z.infer<typeof libraryStatusSchema>;

/* -------------------------------------------------------------------------
 * Liens officiels
 * ---------------------------------------------------------------------- */

export const linkKinds = ['stream', 'read', 'buy', 'info'] as const;
export const linkKindSchema = z.enum(linkKinds);
export type LinkKind = z.infer<typeof linkKindSchema>;

export const monetizations = ['free', 'ads', 'sub', 'rent', 'buy', 'unknown'] as const;
export const monetizationSchema = z.enum(monetizations);
export type Monetization = z.infer<typeof monetizationSchema>;

/**
 * `exact`  : l'URL mène directement à l'œuvre.
 * `search` : l'URL lance une recherche sur la plateforme — aucune API publique
 *            ne fournit de lien direct pour celle-ci.
 * `site`   : l'URL ouvre le catalogue de la plateforme. Certains services
 *            (ADN, Mangas.io, Disney+) sont des applications JavaScript sans
 *            URL de recherche stable : mieux vaut leur page d'accueil, qui
 *            fonctionne, qu'une adresse inventée qui tombe en 404.
 */
export const linkConfidences = ['exact', 'search', 'site'] as const;
export const linkConfidenceSchema = z.enum(linkConfidences);
export type LinkConfidence = z.infer<typeof linkConfidenceSchema>;

export const officialLinkSchema = z.object({
  /** Identifiant de plateforme normalisé : crunchyroll, adn, netflix, mangaplus… */
  platform: z.string(),
  platformLabel: z.string(),
  kind: linkKindSchema,
  url: z.string(),
  /** Langue du contenu proposé par ce lien (ISO 639-1). */
  language: z.string().nullable(),
  /** Pays de disponibilité (ISO 3166-1 alpha-2). */
  region: z.string().nullable(),
  monetization: monetizationSchema,
  confidence: linkConfidenceSchema,
  /** Source officielle (éditeur / plateforme licenciée) ou communautaire. */
  official: z.boolean(),
  /** Provider ayant fourni l'information — sert à l'attribution. */
  source: z.union([providerIdSchema, z.literal('registry')]),
  logoUrl: z.string().nullable().optional(),
});
export type OfficialLink = z.infer<typeof officialLinkSchema>;

/* -------------------------------------------------------------------------
 * Œuvres et unités
 * ---------------------------------------------------------------------- */

export const externalRefSchema = z.object({
  provider: providerIdSchema,
  providerId: z.string(),
  url: z.string().nullable().optional(),
});
export type ExternalRef = z.infer<typeof externalRefSchema>;

/** Titres indexés par code langue ISO 639-1, plus `romaji` et `native`. */
export const titlesSchema = z.record(z.string(), z.string());
export type Titles = z.infer<typeof titlesSchema>;

export const workSummarySchema = z.object({
  id: z.string(),
  kind: workKindSchema,
  title: z.string(),
  titles: titlesSchema,
  coverUrl: z.string().nullable(),
  year: z.number().int().nullable(),
  releaseStatus: releaseStatusSchema,
  score: z.number().nullable(),
  totalUnits: z.number().int().nullable(),
  externals: z.array(externalRefSchema),
});
export type WorkSummary = z.infer<typeof workSummarySchema>;

export const workDetailsSchema = workSummarySchema.extend({
  synopsis: z.record(z.string(), z.string()),
  genres: z.array(z.string()),
  bannerUrl: z.string().nullable(),
  /** Durée moyenne d'un épisode en minutes (null pour les scans). */
  averageRuntime: z.number().int().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  studios: z.array(z.string()),
  authors: z.array(z.string()),
  /** Langues dans lesquelles des chapitres / épisodes existent. */
  availableLanguages: z.array(z.string()),
  nextRelease: z.object({ number: z.number(), airingAt: z.string() }).nullable(),
  updatedAt: z.string().nullable(),
});
export type WorkDetails = z.infer<typeof workDetailsSchema>;

export const unitSchema = z.object({
  id: z.string(),
  workId: z.string(),
  kind: unitKindSchema,
  /** Numéro de chapitre / épisode. Décimal accepté (chapitre 10.5). */
  number: z.number().nullable(),
  season: z.number().int().nullable(),
  title: z.string().nullable(),
  language: z.string().nullable(),
  publishedAt: z.string().nullable(),
  runtime: z.number().int().nullable(),
  /** URL de lecture / visionnage quand la source en fournit une. */
  externalUrl: z.string().nullable(),
  /** True si l'URL pointe vers une source officielle (MangaPlus, Azuki…). */
  isOfficial: z.boolean(),
  source: providerIdSchema,
});
export type Unit = z.infer<typeof unitSchema>;

/* -------------------------------------------------------------------------
 * Bibliothèque utilisateur
 * ---------------------------------------------------------------------- */

/**
 * Liens principaux choisis par l'utilisateur pour une œuvre précise.
 *
 * Les liens automatiques mènent au catalogue d'une plateforme ; ceux-ci mènent
 * à *la page qu'on ouvre vraiment* pour lire ou regarder cette série-là. Un par
 * langue, et ils passent devant tout le reste.
 */
export const primaryLinksSchema = z.object({
  fr: z.string().nullable().default(null),
  en: z.string().nullable().default(null),
});
export type PrimaryLinks = z.infer<typeof primaryLinksSchema>;

export const libraryEntrySchema = z.object({
  id: z.string(),
  workId: z.string(),
  status: libraryStatusSchema,
  score: z.number().min(0).max(10).nullable(),
  favorite: z.boolean(),
  /** Numéro de la dernière unité terminée — maintenu par le serveur. */
  progress: z.number().nullable(),
  priority: z.number().int(),
  notes: z.string().nullable(),
  tags: z.array(z.string()),
  primaryLinks: primaryLinksSchema,
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  revisitCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LibraryEntry = z.infer<typeof libraryEntrySchema>;

/** Ligne de bibliothèque renvoyée par l'API : entrée + œuvre + compteurs. */
export const libraryItemSchema = z.object({
  entry: libraryEntrySchema,
  work: workSummarySchema,
  unitsTotal: z.number().int(),
  unitsCompleted: z.number().int(),
  /** Unités disponibles non consommées — alimente le tri « prêt à binge ». */
  unitsAvailable: z.number().int(),
  nextUnit: unitSchema.nullable(),
  hasNewUnits: z.boolean(),
});
export type LibraryItem = z.infer<typeof libraryItemSchema>;

/* -------------------------------------------------------------------------
 * Utilisateur
 * ---------------------------------------------------------------------- */

/**
 * Source ajoutée par l'utilisateur.
 *
 * Le registre livré ne contient que des plateformes vérifiées, mais chacun
 * suit ses propres sites : plutôt que de figer une liste dans le code, chaque
 * compte peut déclarer les siens. `{titre}` est remplacé par le titre de
 * l'œuvre au moment de construire le lien.
 */
export const customPlatformSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'Identifiant en minuscules, chiffres et tirets uniquement.'),
  label: z.string().min(1).max(60),
  kind: z.enum(['stream', 'read', 'buy']),
  urlTemplate: z
    .string()
    .min(8)
    .refine((value) => value.startsWith('https://') || value.startsWith('http://'), {
      message: "L'adresse doit commencer par http:// ou https://",
    })
    .refine((value) => value.includes('{titre}'), {
      message: "L'adresse doit contenir {titre}, remplacé par le titre recherché.",
    }),
  language: z.string().max(5).nullable().default(null),
  /** Familles concernées. Vide = toutes. */
  worksFor: z.array(workKindSchema).default([]),
});
export type CustomPlatform = z.infer<typeof customPlatformSchema>;

export const userPreferencesSchema = z.object({
  /** Langues préférées pour les liens, par ordre de préférence. */
  languages: z.array(z.string()).default(['fr', 'en']),
  /** Régions de disponibilité à interroger. */
  regions: z.array(z.string()).default(['FR', 'US']),
  /** Plateformes possédées : remontées en tête des liens. */
  ownedPlatforms: z.array(z.string()).default([]),
  /** N'afficher que les liens officiels. */
  officialOnly: z.boolean().default(true),
  /** Sources ajoutées par l'utilisateur, proposées en tête de liste. */
  customPlatforms: z.array(customPlatformSchema).max(30).default([]),
  uiLanguage: z.enum(['fr', 'en']).default('fr'),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
});
export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export const defaultPreferences: UserPreferences = userPreferencesSchema.parse({});

export const publicUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string(),
  role: z.enum(['admin', 'user']),
  preferences: userPreferencesSchema,
  createdAt: z.string(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

/* -------------------------------------------------------------------------
 * Notifications & activité
 * ---------------------------------------------------------------------- */

export const notificationSchema = z.object({
  id: z.string(),
  type: z.enum(['new_unit', 'release_soon', 'link_added', 'system']),
  workId: z.string().nullable(),
  title: z.string(),
  body: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const activityKinds = [
  'unit_completed',
  'unit_uncompleted',
  'status_changed',
  'work_added',
  'work_removed',
  'score_changed',
] as const;
export const activityKindSchema = z.enum(activityKinds);
export type ActivityKind = z.infer<typeof activityKindSchema>;
