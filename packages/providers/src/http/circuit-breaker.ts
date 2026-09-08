import type { ProviderId } from '@scanlib/shared';
import type { CacheStore, Logger } from '../types.js';

/** Clé unique sous laquelle l'état des coupe-circuits est conservé. */
const STORE_KEY = 'circuit-breaker:state';

/**
 * Coupe-circuit par source externe.
 *
 * Sans lui, une API en panne coûte plusieurs secondes à *chaque* recherche : la
 * requête part, échoue, est réessayée deux fois avec un délai croissant, et
 * l'utilisateur attend. Or ces pannes durent des heures — l'API AniList est
 * coupée depuis des mois, Jikan répond régulièrement en 504.
 *
 * Après quelques échecs consécutifs, la source est écartée pendant un temps
 * croissant (1, 2, 4… minutes, plafonné à 15). Une seule requête est laissée
 * passer à l'expiration : si elle réussit, le circuit se referme aussitôt.
 * L'application redevient donc rapide en cas de panne, et se répare seule au
 * retour de la source.
 */
export class CircuitBreaker {
  private readonly failures = new Map<ProviderId, number>();
  private readonly openUntil = new Map<ProviderId, number>();

  constructor(
    private readonly threshold = 3,
    private readonly baseCooldownMs = 60_000,
    private readonly maxCooldownMs = 15 * 60_000,
    private readonly logger?: Logger,
    /**
     * Cache partagé, pour que l'état survive aux redémarrages. Sans lui, chaque
     * redéploiement relance des appels vers une source hors service — AniList
     * est coupée depuis des mois — et rallonge à nouveau les recherches le temps
     * de réapprendre.
     */
    private readonly store?: CacheStore,
  ) {
    void this.restore();
  }

  /** Recharge l'état connu au démarrage. */
  private async restore(): Promise<void> {
    if (!this.store) return;
    try {
      const saved = await this.store.get<Record<string, { failures: number; until: number }>>(
        STORE_KEY,
      );
      if (!saved) return;
      for (const [provider, state] of Object.entries(saved)) {
        if (state.until > Date.now()) {
          this.failures.set(provider as ProviderId, state.failures);
          this.openUntil.set(provider as ProviderId, state.until);
        }
      }
    } catch {
      // Le cache est un confort : son indisponibilité ne doit rien casser.
    }
  }

  private persist(): void {
    if (!this.store) return;
    const snapshot: Record<string, { failures: number; until: number }> = {};
    for (const [provider, until] of this.openUntil) {
      snapshot[provider] = { failures: this.failures.get(provider) ?? 0, until };
    }
    void this.store.set(STORE_KEY, snapshot, 3600).catch(() => undefined);
  }

  /** Le circuit est-il ouvert, c'est-à-dire la source doit-elle être ignorée ? */
  isOpen(provider: ProviderId): boolean {
    const until = this.openUntil.get(provider);
    if (until == null) return false;
    if (Date.now() >= until) {
      // Période écoulée : on laisse passer une requête de test.
      this.openUntil.delete(provider);
      return false;
    }
    return true;
  }

  recordSuccess(provider: ProviderId): void {
    if (this.failures.get(provider)) {
      this.logger?.info('source rétablie', { provider });
    }
    this.failures.delete(provider);
    this.openUntil.delete(provider);
    this.persist();
  }

  recordFailure(provider: ProviderId): void {
    const count = (this.failures.get(provider) ?? 0) + 1;
    this.failures.set(provider, count);

    if (count < this.threshold) return;

    const cooldown = Math.min(
      this.maxCooldownMs,
      this.baseCooldownMs * 2 ** (count - this.threshold),
    );
    this.openUntil.set(provider, Date.now() + cooldown);
    this.persist();
    this.logger?.warn('source écartée temporairement', {
      provider,
      échecs: count,
      minutes: Math.round(cooldown / 60_000),
    });
  }

  /** État lisible, exposé par `/api/health/providers`. */
  state(provider: ProviderId): { open: boolean; failures: number; retryAt: string | null } {
    const until = this.openUntil.get(provider);
    return {
      open: this.isOpen(provider),
      failures: this.failures.get(provider) ?? 0,
      retryAt: until ? new Date(until).toISOString() : null,
    };
  }

  reset(provider: ProviderId): void {
    this.failures.delete(provider);
    this.openUntil.delete(provider);
  }
}
