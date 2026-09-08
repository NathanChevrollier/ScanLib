import Dexie, { type Table } from 'dexie';
import { api } from './api';

interface CacheRow {
  key: string;
  payload: unknown;
  updatedAt: number;
}

interface PendingProgress {
  id?: number;
  unitIds: string[];
  completed: boolean;
  createdAt: number;
}

/**
 * Base locale du navigateur.
 *
 * Deux usages : garder la dernière version des écrans consultés pour qu'ils
 * s'affichent hors connexion, et mettre en file les cases cochées quand le
 * réseau manque — typiquement dans le métro, le moment exact où l'on coche un
 * épisode qu'on vient de finir.
 */
class ScanLibDatabase extends Dexie {
  cache!: Table<CacheRow, string>;
  pendingProgress!: Table<PendingProgress, number>;

  constructor() {
    super('scanlib');
    this.version(1).stores({
      cache: 'key, updatedAt',
      pendingProgress: '++id, createdAt',
    });
  }
}

const db = new ScanLibDatabase();

/**
 * Ouverture au démarrage, et non à la première écriture.
 *
 * Dexie ouvre paresseusement : tant qu'aucune opération n'a eu lieu, la base ne
 * contient aucun magasin. Or la première écriture arrive justement quand le
 * réseau est coupé — le pire moment pour découvrir que le stockage est
 * indisponible (navigation privée, quota, base créée entre-temps par autre
 * chose). On ouvre donc tout de suite et on retient l'échec éventuel.
 */
let storageError: string | null = null;

export const storageReady: Promise<boolean> = db
  .open()
  .then(() => true)
  .catch((error: unknown) => {
    storageError = error instanceof Error ? error.message : String(error);
    console.warn('Stockage local indisponible :', storageError);
    return false;
  });

/** Le stockage local est-il exploitable ? Faux en navigation privée stricte. */
export function isStorageAvailable(): Promise<boolean> {
  return storageReady;
}

export async function cacheGet<T>(key: string, maxAgeMs = 7 * 86_400_000): Promise<T | null> {
  try {
    if (!(await storageReady)) return null;
    const row = await db.cache.get(key);
    if (!row || Date.now() - row.updatedAt > maxAgeMs) return null;
    return row.payload as T;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, payload: unknown): Promise<void> {
  try {
    if (!(await storageReady)) return;
    await db.cache.put({ key, payload, updatedAt: Date.now() });
  } catch {
    // Mode navigation privée ou quota atteint : le cache est un confort, pas
    // une fonctionnalité critique.
  }
}

/**
 * Met un marquage en attente. L'échec est propagé volontairement : perdre
 * silencieusement un épisode coché est pire qu'un message d'erreur.
 */
export async function queueProgress(unitIds: string[], completed: boolean): Promise<void> {
  if (!(await storageReady)) {
    throw new Error(
      `Action impossible hors connexion : le stockage local est indisponible${storageError ? ` (${storageError})` : ''}.`,
    );
  }
  await db.pendingProgress.add({ unitIds, completed, createdAt: Date.now() });
}

/**
 * Événement émis quand une action part en file : la coquille de l'application
 * met alors son indicateur à jour sans avoir à interroger la base en boucle.
 */
export const QUEUED_EVENT = 'scanlib:queued';

export function notifyQueued(): void {
  window.dispatchEvent(new Event(QUEUED_EVENT));
}

export async function pendingCount(): Promise<number> {
  try {
    if (!(await storageReady)) return 0;
    return await db.pendingProgress.count();
  } catch {
    return 0;
  }
}

/**
 * Rejoue les marquages en attente, dans l'ordre où ils ont été faits. Une
 * entrée qui échoue pour une raison définitive (unité supprimée côté serveur)
 * est abandonnée pour ne pas bloquer la file.
 */
export async function flushProgressQueue(): Promise<number> {
  if (!navigator.onLine || !(await storageReady)) return 0;

  const pending = await db.pendingProgress.orderBy('createdAt').toArray();
  let flushed = 0;

  for (const item of pending) {
    try {
      await api.setProgress(item.unitIds, item.completed);
      if (item.id != null) await db.pendingProgress.delete(item.id);
      flushed += 1;
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status && status >= 400 && status < 500 && status !== 401) {
        if (item.id != null) await db.pendingProgress.delete(item.id);
        continue;
      }
      break;
    }
  }

  return flushed;
}
