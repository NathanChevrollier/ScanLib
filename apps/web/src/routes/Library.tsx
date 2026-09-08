import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, Library as LibraryIcon, SlidersHorizontal } from 'lucide-react';
import type { LibraryItem, LibrarySort, LibraryStatus, WorkKind } from '@scanlib/shared';
import { libraryStatusColors, libraryStatusLabels, libraryStatuses, workKindLabels, workKinds } from '@scanlib/shared';
import { api } from '../lib/api';
import { kindColors } from '../lib/format';
import { useCachedQuery } from '../hooks/useCachedQuery';
import { useSession } from '../hooks/useSession';
import { BulkActions } from '../components/BulkActions';
import { LibraryCard } from '../components/WorkCard';
import {
  Button,
  ChipGroup,
  EmptyState,
  ErrorState,
  LoadingBlock,
  cn,
  inputClass,
  selectClass,
} from '../components/ui';

const sorts: { value: LibrarySort; label: string }[] = [
  { value: 'updated', label: 'Activité récente' },
  { value: 'binge', label: 'Prêt à enchaîner' },
  { value: 'title', label: 'Titre' },
  { value: 'score', label: 'Ma note' },
  { value: 'progress', label: 'Progression' },
  { value: 'added', label: 'Date d’ajout' },
  { value: 'priority', label: 'Priorité' },
];

/** Filtres conservés d'une visite à l'autre : on revient rarement sur autre chose. */
const FILTERS_KEY = 'scanlib:library-filters';

interface Filters {
  status: LibraryStatus[];
  kinds: WorkKind[];
  sort: LibrarySort;
  search: string;
}

export function LibraryPage() {
  const { language, t } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<Filters>(() => {
    try {
      const stored = localStorage.getItem(FILTERS_KEY);
      if (stored) return { ...(JSON.parse(stored) as Filters), search: '' };
    } catch {
      /* premier lancement ou stockage indisponible */
    }
    return { status: [], kinds: [], sort: 'updated', search: '' };
  });
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    const { search: _ignored, ...persisted } = filters;
    localStorage.setItem(FILTERS_KEY, JSON.stringify(persisted));
  }, [filters]);

  /** Avancer d'une unité sans quitter la bibliothèque. */
  const advance = useMutation({
    mutationFn: (item: LibraryItem) => api.setProgress([item.nextUnit!.id], true),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['library'] });
      await queryClient.invalidateQueries({ queryKey: ['queue'] });
    },
  });

  const query = useQuery({
    queryKey: ['library', filters],
    queryFn: () =>
      api.library({
        status: filters.status.length ? filters.status : undefined,
        kinds: filters.kinds.length ? filters.kinds : undefined,
        search: filters.search || undefined,
        sort: filters.sort,
        limit: 120,
      }),
    staleTime: 60_000,
  });

  // La dernière bibliothèque consultée reste lisible hors connexion.
  const cached = useCachedQuery('library:last', query);
  const items = cached.data?.items ?? [];

  const activeFilterCount = filters.status.length + filters.kinds.length;

  const grouped = useMemo(() => {
    const withNew = items.filter((item) => item.hasNewUnits);
    const rest = items.filter((item) => !item.hasNewUnits);
    return { withNew, rest };
  }, [items]);

  const toggleSelect = (item: LibraryItem) => {
    setSelected((current) =>
      current.includes(item.work.id)
        ? current.filter((id) => id !== item.work.id)
        : [...current, item.work.id],
    );
  };

  const openNextUnit = (item: LibraryItem) => {
    // Le lien choisi par l'utilisateur pour cette œuvre passe devant celui du
    // chapitre ; sans aucun lien, on ouvre la fiche.
    const url =
      item.entry.primaryLinks[language] ??
      item.entry.primaryLinks.fr ??
      item.entry.primaryLinks.en ??
      item.nextUnit?.externalUrl;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
    else navigate(`/work/${item.work.id}`);
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-xl font-semibold">{t('nav.library')}</h1>
        <input
          type="search"
          value={filters.search}
          onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          placeholder="Filtrer par titre"
          className={cn(inputClass, 'w-full sm:w-56')}
          aria-label="Filtrer la bibliothèque"
        />
        <select
          value={filters.sort}
          onChange={(event) =>
            setFilters({ ...filters, sort: event.target.value as LibrarySort })
          }
          className={selectClass}
          aria-label={t('library.sort')}
        >
          {sorts.map((sort) => (
            <option key={sort.value} value={sort.value}>
              {sort.label}
            </option>
          ))}
        </select>
        <Button
          icon={<SlidersHorizontal size={16} />}
          onClick={() => setShowFilters((value) => !value)}
        >
          {t('library.filters')}
          {activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </Button>
      </header>

      <BulkActions selected={selected} onClear={() => setSelected([])} />

      {showFilters ? (
        <div className="space-y-3 rounded-[var(--radius-card)] border border-[var(--border)] p-4">
          <ChipGroup
            options={libraryStatuses.map((status) => ({
              value: status,
              label: libraryStatusLabels[status][language],
            }))}
            selected={filters.status}
            onChange={(status) => setFilters({ ...filters, status })}
            color={(status) => libraryStatusColors[status]}
          />
          <ChipGroup
            options={workKinds.map((kind) => ({
              value: kind,
              label: workKindLabels[kind][language],
            }))}
            selected={filters.kinds}
            onChange={(kinds) => setFilters({ ...filters, kinds })}
            color={(kind) => kindColors[kind]}
          />
        </div>
      ) : null}

      {query.isPending && items.length === 0 ? (
        <LoadingBlock />
      ) : query.isError && items.length === 0 ? (
        <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<LibraryIcon size={28} />}
          title="Bibliothèque vide"
          description={t('library.empty')}
          action={
            <Button variant="primary" icon={<LayoutGrid size={16} />} onClick={() => navigate('/search')}>
              {t('common.search')}
            </Button>
          }
        />
      ) : (
        <div className="space-y-8">
          {grouped.withNew.length > 0 ? (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-[var(--color-success)]">
                {t('library.newUnits')} · {grouped.withNew.length}
              </h2>
              <Grid
                items={grouped.withNew}
                onContinue={openNextUnit}
                onAdvance={(item) => advance.mutate(item)}
                onToggleSelect={toggleSelect}
                selectedIds={selected}
                busy={advance.isPending}
              />
            </section>
          ) : null}

          <section>
            {grouped.withNew.length > 0 ? (
              <h2 className="mb-3 text-sm font-semibold text-[var(--text-muted)]">
                {grouped.rest.length} {t('library.count')}
              </h2>
            ) : null}
            <Grid
              items={grouped.rest}
              onContinue={openNextUnit}
              onAdvance={(item) => advance.mutate(item)}
              onToggleSelect={toggleSelect}
              selectedIds={selected}
              busy={advance.isPending}
            />
          </section>
        </div>
      )}
    </div>
  );
}

function Grid({
  items,
  onContinue,
  onAdvance,
  onToggleSelect,
  selectedIds,
  busy,
}: {
  items: LibraryItem[];
  onContinue: (item: LibraryItem) => void;
  onAdvance: (item: LibraryItem) => void;
  onToggleSelect: (item: LibraryItem) => void;
  selectedIds: string[];
  busy: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-10">
      {items.map((item) => (
        <LibraryCard
          key={item.entry.id}
          item={item}
          onContinue={onContinue}
          onAdvance={onAdvance}
          onToggleSelect={onToggleSelect}
          selected={selectedIds.includes(item.work.id)}
          busy={busy}
        />
      ))}
    </div>
  );
}
