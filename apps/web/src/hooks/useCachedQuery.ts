import { useEffect, useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { cacheGet, cacheSet } from '../lib/offline';

/**
 * Complète une requête réseau par une copie persistée dans IndexedDB.
 *
 * Le cache de TanStack Query vit en mémoire : il disparaît au rechargement,
 * c'est-à-dire précisément quand on rouvre l'application installée sans réseau.
 * On conserve donc la dernière réponse connue sur disque et on l'utilise comme
 * repli tant que le serveur est injoignable.
 *
 * Retourne les données à afficher, et si elles proviennent du cache local — ce
 * qui permet à l'écran de signaler des informations potentiellement datées.
 */
export function useCachedQuery<T>(
  cacheKey: string,
  query: Pick<UseQueryResult<T>, 'data' | 'isError'>,
): { data: T | undefined; fromCache: boolean } {
  const [fallback, setFallback] = useState<T | undefined>(undefined);

  useEffect(() => {
    if (query.data !== undefined) {
      void cacheSet(cacheKey, query.data);
      setFallback(undefined);
      return;
    }
    // Lecture dès qu'aucune donnée fraîche n'est disponible — requête en cours,
    // en échec, ou pas encore déclenchée. L'écran s'affiche immédiatement avec
    // la dernière version connue, et le réseau la remplace quand il répond.
    void cacheGet<T>(cacheKey).then((cached) => {
      if (cached != null) setFallback((current) => current ?? cached);
    });
  }, [cacheKey, query.data, query.isError]);

  return {
    data: query.data ?? fallback,
    fromCache: query.data === undefined && fallback !== undefined,
  };
}
