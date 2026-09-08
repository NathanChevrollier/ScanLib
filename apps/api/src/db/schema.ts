import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { UserPreferences } from '@scanlib/shared';

/* -------------------------------------------------------------------------
 * Comptes
 * ---------------------------------------------------------------------- */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    role: text('role', { enum: ['admin', 'user'] })
      .notNull()
      .default('user'),
    preferences: jsonb('preferences').$type<UserPreferences>().notNull(),
    /** Dernière connexion réussie, affichée dans l'écran d'administration. */
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    /**
     * Compte suspendu : les identifiants restent valides mais la connexion est
     * refusée. Préféré à la suppression, qui efface bibliothèque et historique.
     */
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_key').on(table.email)],
);

/**
 * Tentatives de connexion, par adresse IP et par compte visé.
 *
 * Sans ce compteur, rien ne ralentit une attaque par force brute — et comme
 * argon2 est volontairement coûteux, chaque essai mobilise le processeur du
 * serveur : l'attaque devient aussi un déni de service. Le compteur vit en base
 * pour survivre aux redémarrages et rester valable si l'API tourne en plusieurs
 * exemplaires.
 */
export const authAttempts = pgTable(
  'auth_attempts',
  {
    /** `ip:1.2.3.4` ou `email:a@b.fr` — les deux sont comptés séparément. */
    key: text('key').primaryKey(),
    attempts: integer('attempts').notNull().default(0),
    blockedUntil: timestamp('blocked_until', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('auth_attempts_updated_idx').on(table.updatedAt)],
);

/**
 * Codes de secours pour reprendre la main sur un compte.
 *
 * Une instance auto-hébergée n'a pas forcément de serveur d'envoi d'e-mails :
 * plutôt qu'imposer une configuration SMTP, l'administrateur génère un code à
 * usage unique et le transmet comme il veut. Seule l'empreinte est stockée.
 */
export const recoveryCodes = pgTable(
  'recovery_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('recovery_codes_hash_key').on(table.codeHash),
    index('recovery_codes_user_idx').on(table.userId),
  ],
);

/**
 * Abonnements aux notifications poussées du navigateur.
 *
 * Un abonnement est propre à un appareil : le même compte peut en avoir
 * plusieurs, et un abonnement refusé par le service d'envoi est supprimé.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('push_subscriptions_endpoint_key').on(table.endpoint),
    index('push_subscriptions_user_idx').on(table.userId),
  ],
);

/** Inscription fermée : un compte ne se crée qu'avec un code ou via la CLI. */
export const invites = pgTable('invites', {
  code: text('code').primaryKey(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  usedBy: uuid('used_by').references(() => users.id, { onDelete: 'set null' }),
  usedAt: timestamp('used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Un enregistrement par jeton de rafraîchissement, pour pouvoir le révoquer. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    index('sessions_user_idx').on(table.userId),
    uniqueIndex('sessions_token_key').on(table.tokenHash),
  ],
);

/* -------------------------------------------------------------------------
 * Catalogue
 * ---------------------------------------------------------------------- */

export const works = pgTable(
  'works',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind', { enum: ['manga', 'anime', 'tv', 'movie'] }).notNull(),
    title: text('title').notNull(),
    titles: jsonb('titles').$type<Record<string, string>>().notNull().default({}),
    synopsis: jsonb('synopsis').$type<Record<string, string>>().notNull().default({}),
    coverUrl: text('cover_url'),
    bannerUrl: text('banner_url'),
    year: integer('year'),
    releaseStatus: text('release_status', {
      enum: ['ongoing', 'finished', 'upcoming', 'hiatus', 'cancelled', 'unknown'],
    })
      .notNull()
      .default('unknown'),
    score: real('score'),
    totalUnits: integer('total_units'),
    genres: text('genres').array().notNull().default([]),
    studios: text('studios').array().notNull().default([]),
    authors: text('authors').array().notNull().default([]),
    availableLanguages: text('available_languages').array().notNull().default([]),
    averageRuntime: integer('average_runtime'),
    startDate: timestamp('start_date', { withTimezone: true }),
    endDate: timestamp('end_date', { withTimezone: true }),
    /** Prochaine sortie connue — alimente le calendrier. */
    nextReleaseNumber: doublePrecision('next_release_number'),
    nextReleaseAt: timestamp('next_release_at', { withTimezone: true }),
    /** Dernier rafraîchissement des métadonnées par les jobs. */
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }),
    unitsRefreshedAt: timestamp('units_refreshed_at', { withTimezone: true }),
    linksRefreshedAt: timestamp('links_refreshed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('works_kind_idx').on(table.kind),
    index('works_next_release_idx').on(table.nextReleaseAt),
  ],
);

/** Une œuvre porte autant d'identifiants externes que de sources la décrivant. */
export const externalIds = pgTable(
  'external_ids',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    provider: text('provider', {
      enum: ['jikan', 'kitsu', 'mangadex', 'tmdb', 'anilist', 'tvmaze'],
    }).notNull(),
    providerId: text('provider_id').notNull(),
    url: text('url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('external_ids_provider_key').on(table.provider, table.providerId),
    index('external_ids_work_idx').on(table.workId),
  ],
);

export const units = pgTable(
  'units',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['chapter', 'episode'] }).notNull(),
    number: doublePrecision('number'),
    season: integer('season'),
    title: text('title'),
    language: text('language'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    runtime: integer('runtime'),
    externalUrl: text('external_url'),
    isOfficial: boolean('is_official').notNull().default(false),
    source: text('source').notNull(),
    /**
     * Clé de déduplication stable (`s1-e12`, `c1050`). Les colonnes `number` et
     * `season` étant nullables, un index unique dessus laisserait passer des
     * doublons — PostgreSQL considère chaque NULL comme distinct.
     */
    dedupeKey: text('dedupe_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('units_work_key').on(table.workId, table.dedupeKey),
    index('units_work_order_idx').on(table.workId, table.season, table.number),
    index('units_published_idx').on(table.publishedAt),
  ],
);

export const officialLinks = pgTable(
  'official_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    platformLabel: text('platform_label').notNull(),
    kind: text('kind', { enum: ['stream', 'read', 'buy', 'info'] }).notNull(),
    url: text('url').notNull(),
    language: text('language'),
    region: text('region'),
    monetization: text('monetization').notNull().default('unknown'),
    // Colonne `text` sans contrainte SQL : la liste ci-dessous n'est qu'une
    // garantie de typage, l'ajout d'une valeur ne demande pas de migration.
    confidence: text('confidence', { enum: ['exact', 'search', 'site'] }).notNull(),
    official: boolean('official').notNull().default(true),
    source: text('source').notNull(),
    logoUrl: text('logo_url'),
    /** Position dans le tri calculé par le résolveur. */
    rank: integer('rank').notNull().default(0),
    dedupeKey: text('dedupe_key').notNull(),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
    /** Renseigné quand la revalidation hebdomadaire tombe sur un lien mort. */
    brokenAt: timestamp('broken_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('official_links_work_key').on(table.workId, table.dedupeKey),
    index('official_links_work_idx').on(table.workId),
  ],
);

/* -------------------------------------------------------------------------
 * Bibliothèque
 * ---------------------------------------------------------------------- */

export const libraryEntries = pgTable(
  'library_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    status: text('status', {
      enum: ['planned', 'in_progress', 'on_hold', 'dropped', 'completed', 'revisiting'],
    })
      .notNull()
      .default('planned'),
    score: real('score'),
    favorite: boolean('favorite').notNull().default(false),
    /** Dernière unité terminée, recalculée à chaque changement de progression. */
    progress: doublePrecision('progress'),
    priority: integer('priority').notNull().default(0),
    notes: text('notes'),
    tags: text('tags').array().notNull().default([]),
    /** Liens choisis par l'utilisateur pour cette œuvre : un par langue. */
    primaryLinks: jsonb('primary_links')
      .$type<{ fr?: string | null; en?: string | null }>()
      .notNull()
      .default({}),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    revisitCount: integer('revisit_count').notNull().default(0),
    /** Positionné par le job `detect-new-units`, remis à zéro à la consultation. */
    hasNewUnits: boolean('has_new_units').notNull().default(false),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('library_entries_user_work_key').on(table.userId, table.workId),
    index('library_entries_user_status_idx').on(table.userId, table.status),
  ],
);

export const unitProgress = pgTable(
  'unit_progress',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.unitId] }),
    index('unit_progress_user_work_idx').on(table.userId, table.workId),
    index('unit_progress_completed_idx').on(table.userId, table.completedAt),
  ],
);

/**
 * Récurrences de sortie saisies par l'utilisateur.
 *
 * Les API annoncent au mieux *la prochaine* sortie, et rien du tout pour les
 * scans. Une récurrence décrit le rythme réel d'une série et le calendrier en
 * déroule les occurrences à la volée : rien n'est matérialisé en base, ce qui
 * rend la modification d'un rythme immédiate sur toute la fenêtre affichée.
 *
 * `workId` nul autorise l'événement libre décrit par son seul `label`.
 */
export const releaseSchedules = pgTable(
  'release_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workId: uuid('work_id').references(() => works.id, { onDelete: 'cascade' }),
    label: text('label'),
    frequency: text('frequency', { enum: ['once', 'daily', 'weekly', 'monthly'] }).notNull(),
    /** 0 = dimanche … 6 = samedi. Renseigné pour `weekly`. */
    weekday: integer('weekday'),
    /** 1–31, ramené au dernier jour des mois plus courts. Renseigné pour `monthly`. */
    dayOfMonth: integer('day_of_month'),
    /** Heure locale `HH:MM` — stockée en texte, l'heure de sortie ne dépend pas du jour. */
    timeOfDay: text('time_of_day').notNull().default('12:00'),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }),
    /** Numéro de l'unité attendue à la première occurrence. */
    startNumber: doublePrecision('start_number'),
    increment: doublePrecision('increment').notNull().default(1),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('release_schedules_user_idx').on(table.userId),
    index('release_schedules_work_idx').on(table.userId, table.workId),
  ],
);

export const activityLog = pgTable(
  'activity_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    workId: uuid('work_id').references(() => works.id, { onDelete: 'set null' }),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
    /** Nombre d'unités concernées — évite un COUNT sur les actions groupées. */
    amount: integer('amount').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('activity_log_user_date_idx').on(table.userId, table.createdAt)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['new_unit', 'release_soon', 'link_added', 'system'] }).notNull(),
    workId: uuid('work_id').references(() => works.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('notifications_user_idx').on(table.userId, table.createdAt)],
);

/* -------------------------------------------------------------------------
 * Cache des API externes
 * ---------------------------------------------------------------------- */

export const apiCache = pgTable(
  'api_cache',
  {
    key: text('key').primaryKey(),
    payload: jsonb('payload').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('api_cache_expires_idx').on(table.expiresAt)],
);

/**
 * Suivi des tâches planifiées : dernière exécution, durée, issue.
 *
 * Sans cette trace, une tâche qui échoue toutes les nuits ne se voit nulle
 * part — les journaux partent sur la sortie standard et personne ne les lit.
 */
export const jobRuns = pgTable(
  'job_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    job: text('job').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    success: boolean('success'),
    durationMs: integer('duration_ms'),
    result: jsonb('result').$type<Record<string, unknown>>(),
    error: text('error'),
  },
  (table) => [index('job_runs_job_idx').on(table.job, table.startedAt)],
);

export type UserRow = typeof users.$inferSelect;
export type WorkRow = typeof works.$inferSelect;
export type UnitRow = typeof units.$inferSelect;
export type LibraryEntryRow = typeof libraryEntries.$inferSelect;
export type OfficialLinkRow = typeof officialLinks.$inferSelect;
export type ReleaseScheduleRow = typeof releaseSchedules.$inferSelect;
