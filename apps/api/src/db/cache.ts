import { lt, sql } from 'drizzle-orm';
import type { CacheStore } from '@scanlib/providers';
import { db } from './client.js';
import { apiCache } from './schema.js';

/**
 * Cache des réponses d'API externes, stocké en base plutôt qu'en mémoire :
 * il survit aux redémarrages, il est partagé entre le serveur web et les
 * workers, et il permet de servir des données périmées si une source tombe.
 */
export class PostgresCache implements CacheStore {
  async get<T>(key: string): Promise<T | null> {
    const [row] = await db
      .select({ payload: apiCache.payload, expiresAt: apiCache.expiresAt })
      .from(apiCache)
      .where(sql`${apiCache.key} = ${key}`)
      .limit(1);

    if (!row) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;
    return row.payload as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    await db
      .insert(apiCache)
      .values({ key, payload: value as never, expiresAt })
      .onConflictDoUpdate({
        target: apiCache.key,
        set: { payload: value as never, expiresAt },
      });
  }

  async delete(key: string): Promise<void> {
    await db.delete(apiCache).where(sql`${apiCache.key} = ${key}`);
  }

  /** Appelé par le job `prune-cache`. */
  async prune(): Promise<number> {
    const deleted = await db
      .delete(apiCache)
      .where(lt(apiCache.expiresAt, new Date()))
      .returning({ key: apiCache.key });
    return deleted.length;
  }
}

export const cache = new PostgresCache();
