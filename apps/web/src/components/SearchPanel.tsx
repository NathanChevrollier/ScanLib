import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Search } from 'lucide-react';
import type { SearchResult, WorkKind } from '@scanlib/shared';
import { workKindLabels, workKinds } from '@scanlib/shared';
import { api } from '../lib/api';
import { kindColors } from '../lib/format';
import { useSession } from '../hooks/useSession';
import { ResultCard } from './WorkCard';
import { Button, ChipGroup, EmptyState, ErrorState, LoadingBlock, Spinner, inputClass } from './ui';

/**
 * Panneau de recherche partagé entre la page dédiée et la palette ⌘K.
 *
 * La requête part après 350 ms sans frappe : chaque appel mobilise plusieurs
 * API externes limitées en débit, il ne faut pas en déclencher à chaque touche.
 */
/** Nombre de résultats par page — assez pour remplir un écran sans surcharger. */
const PAGE_SIZE = 20;

export function SearchPanel({
  autoFocus,
  onNavigate,
}: {
  autoFocus?: boolean;
  onNavigate?: () => void;
}) {
  const { language } = useSession();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [kinds, setKinds] = useState<WorkKind[]>([]);
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    // Toute nouvelle frappe ramène à la première page.
    setPage(0);
    // Le serveur met le résultat fusionné en cache : une requête de plus ne
    // coûte presque rien, alors que l'attente se voyait à chaque frappe.
    const timer = setTimeout(() => setDebounced(term.trim()), 150);
    return () => clearTimeout(timer);
  }, [term]);

  const searchArgs = (offset: number) => ({
    q: debounced,
    kinds: kinds.length ? kinds : undefined,
    limit: PAGE_SIZE,
    offset,
  });

  const search = useQuery({
    queryKey: ['search', debounced, kinds, page],
    queryFn: () => api.search(searchArgs(page * PAGE_SIZE)),
    enabled: debounced.length >= 2,
    // Revenir sur un terme déjà tapé ne repasse pas par le réseau.
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    // Les résultats précédents restent affichés pendant la frappe : l'écran ne
    // clignote plus entre chaque requête, et la recherche paraît instantanée.
    placeholderData: keepPreviousData,
  });

  // La page suivante est chargée pendant que l'utilisateur lit la première :
  // le bouton « Suivants » répond alors sans attente.
  useEffect(() => {
    if (!search.data?.hasMore) return;
    void queryClient.prefetchQuery({
      queryKey: ['search', debounced, kinds, page + 1],
      queryFn: () => api.search(searchArgs((page + 1) * PAGE_SIZE)),
      staleTime: 10 * 60_000,
    });
  }, [search.data?.hasMore, debounced, kinds, page, queryClient]);

  const add = useMutation({
    mutationFn: (result: SearchResult) =>
      api.addToLibrary({
        provider: result.provider,
        providerId:
          result.externals.find((external) => external.provider === result.provider)?.providerId ??
          '',
        kind: result.kind,
        status: 'planned',
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['library'] });
      await queryClient.invalidateQueries({ queryKey: ['search'] });
      await queryClient.invalidateQueries({ queryKey: ['queue'] });
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search
          size={18}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-muted)]"
        />
        <input
          ref={inputRef}
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Un scan, un animé, une série, un film…"
          aria-label="Rechercher"
          className={`${inputClass} pl-10`}
        />
        {/* Indicateur discret : les résultats précédents restent lisibles. */}
        {search.isFetching ? (
          <Spinner className="absolute top-1/2 right-3 -translate-y-1/2 size-4" />
        ) : null}
      </div>

      <ChipGroup
        options={workKinds.map((kind) => ({
          value: kind,
          label: workKindLabels[kind][language],
        }))}
        selected={kinds}
        onChange={setKinds}
        color={(kind) => kindColors[kind]}
      />

      {search.data?.degraded.length ? (
        <p className="flex items-center gap-2 rounded-lg bg-[var(--color-warning)]/10 px-3 py-2 text-xs text-[var(--color-warning)]">
          <AlertTriangle size={14} />
          {search.data.degraded.map((item) => item.provider).join(', ')} indisponible
          {search.data.degraded.length > 1 ? 's' : ''} — résultats partiels.
        </p>
      ) : null}

      <div className="flex-1 overflow-y-auto">
        {debounced.length < 2 ? (
          <EmptyState
            icon={<Search size={28} />}
            title="Cherchez par titre"
            description="Scans, animés, séries et films sont interrogés en même temps, en français comme en anglais."
          />
        ) : search.isPending ? (
          <LoadingBlock />
        ) : search.isError ? (
          <ErrorState message={(search.error as Error).message} onRetry={() => search.refetch()} />
        ) : search.data.results.length === 0 ? (
          <EmptyState title="Aucun résultat" description="Essayez le titre original ou anglais." />
        ) : (
          <div className="space-y-3">
            <ul className="space-y-3">
              {search.data.results.map((result) => (
                <li key={`${result.provider}:${result.id}`} onClick={onNavigate}>
                  <ResultCard
                    result={result}
                    onAdd={(item) => add.mutate(item)}
                    pending={add.isPending}
                  />
                </li>
              ))}
            </ul>

            {/* Une œuvre mal classée restait introuvable : la pagination permet
                d'aller la chercher au-delà des vingt premiers résultats. */}
            {page > 0 || search.data.hasMore ? (
              <div className="flex items-center justify-between gap-2 pt-1">
                <Button disabled={page === 0} onClick={() => setPage((value) => value - 1)}>
                  Précédents
                </Button>
                <span className="text-xs text-[var(--text-muted)]">Page {page + 1}</span>
                <Button
                  disabled={!search.data.hasMore}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Suivants
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
