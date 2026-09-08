import type { ProviderId } from '@scanlib/shared';
import { ProviderError, type CacheStore, type Logger } from '../types.js';

export interface RateLimitOptions {
  /** Requêtes par seconde autorisées par le fournisseur. */
  requestsPerSecond: number;
  /** Nombre de requêtes simultanées. Jikan n'aime pas le parallélisme. */
  concurrency?: number;
  maxRetries?: number;
}

interface QueuedTask<T> {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

/**
 * File d'attente avec limitation de débit, partagée par toutes les requêtes
 * d'un même provider. Les API publiques utilisées ici sont strictes (Jikan :
 * 3 req/s, MangaDex : 5 req/s) et bannissent temporairement en cas d'abus ;
 * comme toutes les requêtes externes passent par le serveur, une seule file
 * par provider suffit à protéger l'ensemble des utilisateurs de l'instance.
 */
class RequestQueue {
  private readonly queue: QueuedTask<unknown>[] = [];
  private active = 0;
  private lastStart = 0;
  private readonly minInterval: number;
  private readonly concurrency: number;

  constructor(requestsPerSecond: number, concurrency: number) {
    this.minInterval = 1000 / requestsPerSecond;
    this.concurrency = concurrency;
  }

  push<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ run, resolve, reject } as QueuedTask<unknown>);
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.active >= this.concurrency) return;
    const task = this.queue.shift();
    if (!task) return;

    const wait = Math.max(0, this.lastStart + this.minInterval - Date.now());
    this.active += 1;
    this.lastStart = Date.now() + wait;

    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    try {
      task.resolve(await task.run());
    } catch (error) {
      task.reject(error);
    } finally {
      this.active -= 1;
      void this.drain();
    }
  }
}

const queues = new Map<ProviderId, RequestQueue>();

export interface RequestOptions {
  /** Clé de cache. Absente = pas de mise en cache. */
  cacheKey?: string;
  cacheTtl?: number;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
  /** Un 404 renvoie null au lieu de lever une erreur. */
  nullOn404?: boolean;
  /**
   * Nombre de réessais pour cette requête précise.
   *
   * Une recherche a un budget de quelques secondes : mieux vaut rendre la main
   * avec les résultats des autres sources que réessayer deux fois avec un délai
   * croissant. Les récupérations de fond, elles, gagnent à insister.
   */
  retries?: number;
}

/**
 * Client HTTP commun aux adapters : file d'attente par provider, cache
 * applicatif, réessais avec backoff exponentiel et respect de `Retry-After`.
 */
export class RateLimitedClient {
  private readonly queue: RequestQueue;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly provider: ProviderId,
    private readonly baseUrl: string,
    options: RateLimitOptions,
    private readonly cache: CacheStore,
    private readonly userAgent: string,
    private readonly logger?: Logger,
    fetchImpl?: typeof fetch,
  ) {
    let queue = queues.get(provider);
    if (!queue) {
      queue = new RequestQueue(options.requestsPerSecond, options.concurrency ?? 2);
      queues.set(provider, queue);
    }
    this.queue = queue;
    this.maxRetries = options.maxRetries ?? 3;
    this.fetchImpl = fetchImpl ?? globalThis.fetch;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T | null> {
    const { cacheKey, cacheTtl } = options;

    if (cacheKey) {
      const cached = await this.cache.get<T>(this.namespacedKey(cacheKey));
      if (cached !== null) {
        this.logger?.debug('cache hit', { provider: this.provider, cacheKey });
        return cached;
      }
    }

    const result = await this.queue.push(() => this.execute<T>(path, options));

    if (cacheKey && result !== null) {
      await this.cache.set(this.namespacedKey(cacheKey), result, cacheTtl ?? 3600);
    }
    return result;
  }

  private namespacedKey(key: string): string {
    return `${this.provider}:${key}`;
  }

  private async execute<T>(path: string, options: RequestOptions): Promise<T | null> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const maxRetries = options.retries ?? this.maxRetries;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await this.fetchImpl(url, {
          method: options.method ?? 'GET',
          headers: {
            Accept: 'application/json',
            'User-Agent': this.userAgent,
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...options.headers,
          },
          ...(options.body ? { body: JSON.stringify(options.body) } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        });

        if (response.status === 404 && options.nullOn404) return null;

        if (response.status === 429 || response.status >= 500) {
          const retryAfter = Number(response.headers.get('retry-after'));
          const delay = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : backoffDelay(attempt);
          lastError = new ProviderError(
            this.provider,
            `HTTP ${response.status} sur ${url}`,
            response.status,
            true,
          );
          if (attempt < maxRetries) {
            this.logger?.warn('nouvelle tentative', {
              provider: this.provider,
              status: response.status,
              delay,
              attempt,
            });
            await sleep(delay);
            continue;
          }
          throw lastError;
        }

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new ProviderError(
            this.provider,
            `HTTP ${response.status} sur ${url} — ${text.slice(0, 200)}`,
            response.status,
            false,
          );
        }

        return (await response.json()) as T;
      } catch (error) {
        lastError = error;
        // Erreurs réseau (DNS, socket) : on retente, les erreurs applicatives non.
        const retryable = !(error instanceof ProviderError) || error.retryable;
        if (!retryable || attempt >= maxRetries) break;
        await sleep(backoffDelay(attempt));
      }
    }

    if (lastError instanceof ProviderError) throw lastError;
    throw new ProviderError(
      this.provider,
      lastError instanceof Error ? lastError.message : 'Erreur réseau inconnue',
      undefined,
      true,
    );
  }
}

/** Backoff exponentiel avec bruit aléatoire pour éviter les rafales alignées. */
function backoffDelay(attempt: number): number {
  return Math.min(8000, 2 ** attempt * 500) + Math.random() * 250;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Cache mémoire — utilisé en tests et comme repli si la base est absente. */
export class MemoryCache implements CacheStore {
  private readonly store = new Map<string, { value: unknown; expiresAt: number }>();

  async get<T>(key: string): Promise<T | null> {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return hit.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

/** Sérialise des paramètres en clé de cache stable (ordre alphabétique). */
export function cacheKeyOf(prefix: string, params: Record<string, unknown>): string {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join('|') : String(value)}`);
  return `${prefix}?${parts.join('&')}`;
}
