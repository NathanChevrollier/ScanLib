import type {
  OfficialLink,
  ProviderId,
  Unit,
  WorkDetails,
  WorkKind,
  WorkSummary,
} from '@scanlib/shared';

/** Résultat brut d'un provider : pas encore d'identifiant ScanLib. */
export type ProviderWork = Omit<WorkSummary, 'id'> & {
  provider: ProviderId;
  providerId: string;
};

export type ProviderWorkDetails = Omit<WorkDetails, 'id'> & {
  provider: ProviderId;
  providerId: string;
};

export type ProviderUnit = Omit<Unit, 'id' | 'workId'>;

export type HealthState = 'ok' | 'degraded' | 'down' | 'disabled';

/**
 * Une sortie annoncée mais pas encore publiée. `schedule()` ne renvoie que la
 * prochaine ; il en faut plusieurs pour déduire une cadence.
 */
export interface UpcomingRelease {
  number: number;
  airingAt: string;
  title?: string | null;
}

export interface ProviderHealthReport {
  provider: ProviderId;
  status: HealthState;
  message: string | null;
  checkedAt: Date;
}

export interface SearchOptions {
  kinds?: WorkKind[];
  limit?: number;
  /** Langues préférées, utilisées quand le provider sait filtrer/traduire. */
  languages?: string[];
  signal?: AbortSignal;
}

export interface UnitsOptions {
  /** Langues des chapitres souhaitées (MangaDex). */
  languages?: string[];
  /** Nombre maximum d'unités à ramener (les longues séries dépassent 1000). */
  limit?: number;
  /**
   * Ne demander que les unités publiées après cette date.
   *
   * Sans ce repère, chaque vérification retélécharge l'intégralité du catalogue
   * d'une série — quinze requêtes pour One Piece, plusieurs fois par jour, pour
   * ne découvrir qu'un chapitre. Les sources qui ne savent pas filtrer par date
   * ignorent simplement l'option.
   */
  since?: string | Date | null;
  signal?: AbortSignal;
}

/**
 * Contrat commun à toutes les sources externes. Chaque implémentation est
 * responsable de sa propre traduction vers le modèle ScanLib ; le registre
 * ne connaît que cette interface, ce qui permet de désactiver ou remplacer
 * une source (AniList par exemple) sans toucher au reste du code.
 */
export interface MediaProvider {
  readonly id: ProviderId;
  readonly label: string;
  /** Familles d'œuvres que ce provider sait traiter. */
  readonly kinds: readonly WorkKind[];
  /** Une source désactivée par configuration reste instanciée mais inerte. */
  readonly enabled: boolean;

  search(query: string, options?: SearchOptions): Promise<ProviderWork[]>;
  details(providerId: string, kind: WorkKind): Promise<ProviderWorkDetails | null>;
  units?(providerId: string, kind: WorkKind, options?: UnitsOptions): Promise<ProviderUnit[]>;
  links?(providerId: string, kind: WorkKind, regions?: string[]): Promise<OfficialLink[]>;
  /** Suggestions à partir d'une œuvre — alimente l'écran Recommandations. */
  recommendations?(providerId: string, kind: WorkKind): Promise<ProviderWork[]>;
  /** Sorties prévues, utilisées par le job `airing-calendar`. */
  schedule?(providerId: string, kind: WorkKind): Promise<{ number: number; airingAt: string } | null>;
  /** Grille complète des sorties à venir — alimente le calendrier éditable. */
  upcoming?(providerId: string, kind: WorkKind): Promise<UpcomingRelease[]>;
  health(): Promise<ProviderHealthReport>;
}

/** Cache partagé, implémenté par l'API sur PostgreSQL (mémoire en tests). */
export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface ProviderConfig {
  userAgent: string;
  tmdbApiKey?: string | undefined;
  enableAnilist: boolean;
  languages: string[];
  regions: string[];
  cache: CacheStore;
  logger?: Logger;
  /** Injectable pour les tests (fixtures enregistrées). */
  fetchImpl?: typeof fetch;
}

/** Durées de cache par nature de requête, en secondes. */
export const CACHE_TTL = {
  search: 60 * 60,
  details: 60 * 60 * 24,
  units: 60 * 60 * 6,
  links: 60 * 60 * 24 * 7,
  schedule: 60 * 60 * 6,
  health: 60 * 5,
} as const;

export class ProviderError extends Error {
  constructor(
    public readonly provider: ProviderId,
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
