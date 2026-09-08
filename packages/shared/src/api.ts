import { z } from 'zod';
import {
  libraryItemSchema,
  libraryStatusSchema,
  notificationSchema,
  officialLinkSchema,
  providerIdSchema,
  publicUserSchema,
  unitSchema,
  userPreferencesSchema,
  workDetailsSchema,
  workKindSchema,
  workSummarySchema,
} from './domain.js';

/* -------------------------------------------------------------------------
 * Auth
 * ---------------------------------------------------------------------- */

export const loginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const registerInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10, 'Le mot de passe doit faire au moins 10 caractères.'),
  displayName: z.string().min(1).max(60),
  /** Requis tant que ALLOW_OPEN_REGISTRATION vaut false. */
  inviteCode: z.string().optional(),
});
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const sessionResponseSchema = z.object({ user: publicUserSchema });
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/** Exigences minimales d'un mot de passe, partagées par le front et l'API. */
export const passwordSchema = z
  .string()
  .min(10, 'Le mot de passe doit faire au moins 10 caractères.')
  .max(200);

export const changePasswordInputSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;

export const recoveryInputSchema = z.object({
  code: z.string().min(4),
  newPassword: passwordSchema,
});
export type RecoveryInput = z.infer<typeof recoveryInputSchema>;

export const updateProfileInputSchema = z.object({
  displayName: z.string().min(1).max(60).optional(),
  email: z.string().email().optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileInputSchema>;

export const deleteAccountInputSchema = z.object({ password: z.string().min(1) });
export type DeleteAccountInput = z.infer<typeof deleteAccountInputSchema>;

export const sessionSummarySchema = z.object({
  id: z.string(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  /** La session depuis laquelle la requête est faite : on ne la révoque pas. */
  current: z.boolean(),
});
export type SessionSummaryDto = z.infer<typeof sessionSummarySchema>;

/* -------------------------------------------------------------------------
 * Administration
 * ---------------------------------------------------------------------- */

export const adminUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: z.enum(['admin', 'user']),
  disabled: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
  worksCount: z.number().int(),
  sessionsCount: z.number().int(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminInviteSchema = z.object({
  code: z.string(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  usedBy: z.string().nullable(),
  usedAt: z.string().nullable(),
});
export type AdminInvite = z.infer<typeof adminInviteSchema>;

export const jobRunSchema = z.object({
  job: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  success: z.boolean().nullable(),
  durationMs: z.number().int().nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  error: z.string().nullable(),
});
export type JobRun = z.infer<typeof jobRunSchema>;

export const adminOverviewSchema = z.object({
  users: z.array(adminUserSchema),
  invites: z.array(adminInviteSchema),
  jobs: z.array(jobRunSchema),
});
export type AdminOverview = z.infer<typeof adminOverviewSchema>;

export const updateUserInputSchema = z.object({
  role: z.enum(['admin', 'user']).optional(),
  disabled: z.boolean().optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserInputSchema>;

/* -------------------------------------------------------------------------
 * Recherche
 * ---------------------------------------------------------------------- */

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  /** Familles d'œuvres à interroger. Vide = toutes. */
  kinds: z.array(workKindSchema).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /**
   * Décalage dans les résultats fusionnés. Les sources ne paginent pas de la
   * même façon : on demande plus large et on découpe après le classement, ce
   * qui garde un ordre de pertinence cohérent d'une page à l'autre.
   */
  offset: z.coerce.number().int().min(0).max(200).default(0),
  /** Ignore le cache serveur et réinterroge les providers. */
  refresh: z.boolean().optional(),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const searchResultSchema = workSummarySchema.extend({
  /** Provider ayant produit ce résultat. */
  provider: providerIdSchema,
  /** Renseigné si l'œuvre est déjà dans la bibliothèque de l'utilisateur. */
  libraryStatus: libraryStatusSchema.nullable(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchResponseSchema = z.object({
  results: z.array(searchResultSchema),
  /** Providers interrogés sans succès — affichés en bannière discrète. */
  degraded: z.array(z.object({ provider: providerIdSchema, reason: z.string() })),
  /** Reste-t-il des résultats au-delà de cette page ? */
  hasMore: z.boolean(),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

/* -------------------------------------------------------------------------
 * Œuvres
 * ---------------------------------------------------------------------- */

export const workResponseSchema = z.object({
  work: workDetailsSchema,
  entry: libraryItemSchema.shape.entry.nullable(),
});
export type WorkResponse = z.infer<typeof workResponseSchema>;

/** Rattachement manuel d'une source à une œuvre existante. */
export const attachSourceInputSchema = z.object({
  provider: providerIdSchema,
  providerId: z.string().min(1),
});
export type AttachSourceInput = z.infer<typeof attachSourceInputSchema>;

export const unitsResponseSchema = z.object({
  units: z.array(unitSchema),
  /** IDs des unités déjà terminées par l'utilisateur. */
  completedUnitIds: z.array(z.string()),
});
export type UnitsResponse = z.infer<typeof unitsResponseSchema>;

export const linksResponseSchema = z.object({
  links: z.array(officialLinkSchema),
  /** Mentions légales à afficher (JustWatch / TMDB). */
  attributions: z.array(z.string()),
  refreshedAt: z.string(),
});
export type LinksResponse = z.infer<typeof linksResponseSchema>;

/* -------------------------------------------------------------------------
 * Bibliothèque
 * ---------------------------------------------------------------------- */

export const librarySortSchema = z.enum([
  'updated',
  'title',
  'score',
  'progress',
  'added',
  'priority',
  'binge',
]);
export type LibrarySort = z.infer<typeof librarySortSchema>;

export const libraryQuerySchema = z.object({
  status: z.array(libraryStatusSchema).optional(),
  kinds: z.array(workKindSchema).optional(),
  genres: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  search: z.string().optional(),
  favorite: z.boolean().optional(),
  hasNewUnits: z.boolean().optional(),
  sort: librarySortSchema.default('updated'),
  order: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(200).default(60),
  offset: z.coerce.number().int().min(0).default(0),
});
export type LibraryQuery = z.infer<typeof libraryQuerySchema>;

export const libraryResponseSchema = z.object({
  items: z.array(libraryItemSchema),
  total: z.number().int(),
});
export type LibraryResponse = z.infer<typeof libraryResponseSchema>;

/**
 * Ajout à la bibliothèque, par référence externe (depuis une recherche) ou par
 * identifiant interne quand l'œuvre est déjà connue de l'instance — le cas
 * d'une fiche ouverte depuis un lien partagé ou une recommandation.
 */
export const addToLibraryInputSchema = z
  .object({
    workId: z.string().optional(),
    provider: providerIdSchema.optional(),
    providerId: z.string().optional(),
    kind: workKindSchema.optional(),
    status: libraryStatusSchema.default('planned'),
  })
  .refine(
    (input) => Boolean(input.workId) || Boolean(input.provider && input.providerId && input.kind),
    { message: 'Fournissez soit workId, soit provider, providerId et kind.' },
  );
export type AddToLibraryInput = z.infer<typeof addToLibraryInputSchema>;

export const updateEntryInputSchema = z.object({
  status: libraryStatusSchema.optional(),
  score: z.number().min(0).max(10).nullable().optional(),
  favorite: z.boolean().optional(),
  priority: z.number().int().min(0).max(5).optional(),
  notes: z.string().max(5000).nullable().optional(),
  tags: z.array(z.string().max(40)).max(30).optional(),
  primaryLinks: z
    .object({
      fr: z.string().url("L'adresse doit être une URL complète.").nullable(),
      en: z.string().url("L'adresse doit être une URL complète.").nullable(),
    })
    .partial()
    .optional(),
});
export type UpdateEntryInput = z.infer<typeof updateEntryInputSchema>;

/**
 * « J'en suis au chapitre N » : tout ce qui précède passe à terminé, tout ce
 * qui suit redevient à lire. C'est le geste attendu quand on reprend une série
 * suivie ailleurs, ou quand on corrige une case cochée par erreur.
 */
export const setProgressInputSchema = z.object({
  workId: z.string(),
  /** 0 remet la progression à zéro. */
  number: z.number().min(0),
});
export type SetProgressInput = z.infer<typeof setProgressInputSchema>;

/* -------------------------------------------------------------------------
 * Progression
 * ---------------------------------------------------------------------- */

export const progressInputSchema = z.object({
  /** Unités à (dé)marquer. */
  unitIds: z.array(z.string()).min(1).max(2000),
  completed: z.boolean(),
});
export type ProgressInput = z.infer<typeof progressInputSchema>;

/** « Marquer jusqu'ici » : toutes les unités <= number passent à terminé. */
export const progressUpToInputSchema = z.object({
  workId: z.string(),
  number: z.number(),
});
export type ProgressUpToInput = z.infer<typeof progressUpToInputSchema>;

export const progressResponseSchema = z.object({
  entry: libraryItemSchema.shape.entry,
  completedUnitIds: z.array(z.string()),
});
export type ProgressResponse = z.infer<typeof progressResponseSchema>;

/* -------------------------------------------------------------------------
 * Calendrier, statistiques, files d'attente
 * ---------------------------------------------------------------------- */

/**
 * D'où vient une ligne du calendrier :
 * `unit`     — une unité déjà indexée par une source (MangaDex, TMDB…) ;
 * `provider` — la « prochaine sortie » annoncée par une API (AniList, TVmaze) ;
 * `manual`   — une récurrence saisie ou corrigée par l'utilisateur.
 *
 * Seule une ligne `manual` se modifie depuis l'écran.
 */
export const calendarSources = ['unit', 'provider', 'manual'] as const;
export const calendarSourceSchema = z.enum(calendarSources);
export type CalendarSource = z.infer<typeof calendarSourceSchema>;

export const calendarEntrySchema = z.object({
  work: workSummarySchema.nullable(),
  unitNumber: z.number().nullable(),
  unitTitle: z.string().nullable(),
  releaseAt: z.string(),
  /** Déjà sorti mais pas encore consommé. */
  isAvailable: z.boolean(),
  source: calendarSourceSchema.default('unit'),
  /** Renseigné pour les lignes issues d'une récurrence manuelle. */
  scheduleId: z.string().nullable().default(null),
  /** Titre libre d'un événement sans œuvre rattachée. */
  label: z.string().nullable().default(null),
});
export type CalendarEntry = z.infer<typeof calendarEntrySchema>;

export const calendarResponseSchema = z.object({
  entries: z.array(calendarEntrySchema),
  from: z.string(),
  to: z.string(),
});
export type CalendarResponse = z.infer<typeof calendarResponseSchema>;

/* -------------------------------------------------------------------------
 * Récurrences de sortie saisies par l'utilisateur
 * ---------------------------------------------------------------------- */

/** `once` couvre l'événement isolé sans demander un second modèle de données. */
export const scheduleFrequencies = ['once', 'daily', 'weekly', 'monthly'] as const;
export const scheduleFrequencySchema = z.enum(scheduleFrequencies);
export type ScheduleFrequency = z.infer<typeof scheduleFrequencySchema>;

const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "L'heure doit être au format HH:MM.");

export const releaseScheduleSchema = z.object({
  id: z.string(),
  /** Nul pour un événement libre non rattaché à une œuvre suivie. */
  workId: z.string().nullable(),
  work: workSummarySchema.nullable(),
  label: z.string().nullable(),
  frequency: scheduleFrequencySchema,
  /** 0 = dimanche … 6 = samedi. Utilisé par `weekly`. */
  weekday: z.number().int().min(0).max(6).nullable(),
  /** 1–31, ramené au dernier jour du mois s'il est plus court. Utilisé par `monthly`. */
  dayOfMonth: z.number().int().min(1).max(31).nullable(),
  /** Heure locale de sortie, `HH:MM`. */
  timeOfDay: timeOfDaySchema,
  startAt: z.string(),
  endAt: z.string().nullable(),
  /** Numéro de l'unité attendue à la première occurrence. */
  startNumber: z.number().nullable(),
  /** Incrément de numérotation d'une occurrence à l'autre. */
  increment: z.number(),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ReleaseSchedule = z.infer<typeof releaseScheduleSchema>;

export const releaseScheduleInputSchema = z
  .object({
    workId: z.string().nullable().optional(),
    label: z.string().max(120).nullable().optional(),
    frequency: scheduleFrequencySchema,
    weekday: z.number().int().min(0).max(6).nullable().optional(),
    dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    timeOfDay: timeOfDaySchema.default('12:00'),
    startAt: z.string(),
    endAt: z.string().nullable().optional(),
    startNumber: z.number().nullable().optional(),
    increment: z.number().min(0).max(100).default(1),
    note: z.string().max(500).nullable().optional(),
  })
  .refine((input) => Boolean(input.workId) || Boolean(input.label), {
    message: 'Rattachez la sortie à une œuvre ou donnez-lui un titre.',
  })
  .refine((input) => input.frequency !== 'weekly' || input.weekday != null, {
    message: 'Choisissez le jour de la semaine.',
    path: ['weekday'],
  })
  .refine((input) => input.frequency !== 'monthly' || input.dayOfMonth != null, {
    message: 'Choisissez le jour du mois.',
    path: ['dayOfMonth'],
  });
export type ReleaseScheduleInput = z.infer<typeof releaseScheduleInputSchema>;

/** Mêmes champs, tous facultatifs — les contraintes croisées sont revalidées côté service. */
export const releaseScheduleUpdateSchema = z.object({
  label: z.string().max(120).nullable().optional(),
  frequency: scheduleFrequencySchema.optional(),
  weekday: z.number().int().min(0).max(6).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  timeOfDay: timeOfDaySchema.optional(),
  startAt: z.string().optional(),
  endAt: z.string().nullable().optional(),
  startNumber: z.number().nullable().optional(),
  increment: z.number().min(0).max(100).optional(),
  note: z.string().max(500).nullable().optional(),
});
export type ReleaseScheduleUpdate = z.infer<typeof releaseScheduleUpdateSchema>;

export const schedulesResponseSchema = z.object({
  schedules: z.array(releaseScheduleSchema),
});
export type SchedulesResponse = z.infer<typeof schedulesResponseSchema>;

/** Pré-remplissage du formulaire à partir de ce que les API savent déjà. */
export const scheduleSuggestionSchema = z.object({
  frequency: scheduleFrequencySchema,
  weekday: z.number().int().min(0).max(6).nullable(),
  dayOfMonth: z.number().int().min(1).max(31).nullable(),
  timeOfDay: timeOfDaySchema,
  startAt: z.string(),
  startNumber: z.number().nullable(),
  increment: z.number(),
  /** Phrase courte expliquant d'où vient la proposition. */
  reason: z.string(),
  /** `provider` si une API annonce la date, `inferred` si elle est déduite. */
  basis: z.enum(['provider', 'inferred', 'default']),
});
export type ScheduleSuggestion = z.infer<typeof scheduleSuggestionSchema>;

export const statsResponseSchema = z.object({
  totals: z.object({
    works: z.number().int(),
    byKind: z.record(z.string(), z.number()),
    byStatus: z.record(z.string(), z.number()),
    episodesWatched: z.number().int(),
    chaptersRead: z.number().int(),
    /** Estimation en minutes. */
    minutesWatched: z.number().int(),
    minutesRead: z.number().int(),
  }),
  /** Une case par jour : { date: 'YYYY-MM-DD', count } — heatmap façon GitHub. */
  heatmap: z.array(z.object({ date: z.string(), count: z.number().int() })),
  topGenres: z.array(z.object({ genre: z.string(), count: z.number().int() })),
  scoreDistribution: z.array(z.object({ score: z.number(), count: z.number().int() })),
  streak: z.object({ current: z.number().int(), longest: z.number().int() }),
  recentActivity: z.array(
    z.object({
      at: z.string(),
      kind: z.string(),
      workId: z.string().nullable(),
      workTitle: z.string().nullable(),
      detail: z.string().nullable(),
    }),
  ),
});
export type StatsResponse = z.infer<typeof statsResponseSchema>;

export const queueResponseSchema = z.object({
  /** Œuvres « planned » triées par priorité puis note. */
  toStart: z.array(libraryItemSchema),
  /** En cours avec des unités disponibles non consommées. */
  readyToBinge: z.array(libraryItemSchema),
  /** En cours sans activité depuis longtemps. */
  stalled: z.array(libraryItemSchema),
});
export type QueueResponse = z.infer<typeof queueResponseSchema>;

export const recommendationSchema = workSummarySchema.extend({
  provider: providerIdSchema,
  providerId: z.string(),
  /** Explication courte : « parce que vous avez aimé X ». */
  reason: z.string(),
});
export type Recommendation = z.infer<typeof recommendationSchema>;

/* -------------------------------------------------------------------------
 * Divers
 * ---------------------------------------------------------------------- */

export const providerHealthSchema = z.object({
  provider: providerIdSchema,
  status: z.enum(['ok', 'degraded', 'down', 'disabled']),
  message: z.string().nullable(),
  checkedAt: z.string(),
});
export type ProviderHealth = z.infer<typeof providerHealthSchema>;

export const notificationsResponseSchema = z.object({
  notifications: z.array(notificationSchema),
  unread: z.number().int(),
});
export type NotificationsResponse = z.infer<typeof notificationsResponseSchema>;

/** Abonnement transmis par le navigateur au moment de l'autorisation. */
export const pushSubscriptionInputSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInputSchema>;

export const updatePreferencesInputSchema = userPreferencesSchema.partial();
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesInputSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
