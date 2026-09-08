import { useMemo, useState } from 'react';
import { Check, ChevronDown, ExternalLink } from 'lucide-react';
import type { Unit } from '@scanlib/shared';
import { formatDate, unitLabel } from '../lib/format';
import { useSession } from '../hooks/useSession';
import { Badge, Button, cn, selectClass } from './ui';

const PAGE_SIZE = 100;

/**
 * Liste des chapitres ou épisodes.
 *
 * Les longues séries dépassent le millier de chapitres : on affiche par
 * tranches et on part de la fin, là où se trouve la progression en cours.
 */
export function UnitList({
  units,
  completedIds,
  onToggle,
  onMarkUpTo,
  busy,
}: {
  units: Unit[];
  completedIds: Set<string>;
  onToggle: (unit: Unit, completed: boolean) => void;
  onMarkUpTo: (unit: Unit) => void;
  busy?: boolean;
}) {
  const { language } = useSession();
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [ascending, setAscending] = useState(true);

  const ordered = useMemo(() => {
    const sorted = [...units];
    return ascending ? sorted : sorted.reverse();
  }, [units, ascending]);

  const shown = ordered.slice(0, visible);
  const nextUnit = units.find((unit) => !completedIds.has(unit.id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-sm text-[var(--text-muted)]">
          {completedIds.size} / {units.length}
        </p>

        {/* Combien afficher d'un coup : une longue série se parcourt mal cent
            par cent, mais tout charger d'emblée ralentit l'affichage. */}
        <select
          value={pageSize}
          onChange={(event) => {
            const size = Number(event.target.value);
            setPageSize(size);
            setVisible(size);
          }}
          aria-label="Nombre affiché"
          className={cn(selectClass, 'h-9 min-h-0 py-0 text-xs')}
        >
          {[50, 100, 250, 500].map((size) => (
            <option key={size} value={size}>
              {size} par page
            </option>
          ))}
          <option value={100000}>Tout afficher</option>
        </select>

        <Button
          variant="ghost"
          onClick={() => setAscending((value) => !value)}
          icon={<ChevronDown size={15} className={ascending ? '' : 'rotate-180'} />}
        >
          {ascending ? 'Croissant' : 'Décroissant'}
        </Button>
      </div>

      <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)]">
        {shown.map((unit) => {
          const done = completedIds.has(unit.id);
          const isNext = nextUnit?.id === unit.id;
          const unreleased = unit.publishedAt != null && new Date(unit.publishedAt) > new Date();

          return (
            <li
              key={unit.id}
              className={cn(
                'flex items-center gap-3 px-3 py-2',
                isNext && !done ? 'bg-[var(--color-accent)]/8' : '',
              )}
            >
              <button
                type="button"
                role="checkbox"
                aria-checked={done}
                aria-label={`${unitLabel(unit, language)} — ${done ? 'terminé' : 'à voir'}`}
                disabled={busy}
                onClick={() => onToggle(unit, !done)}
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-md border transition-colors',
                  done
                    ? 'border-[var(--color-success)] bg-[var(--color-success)] text-white'
                    : 'border-[var(--border)] hover:border-[var(--color-accent)]',
                )}
              >
                {done ? <Check size={14} /> : null}
              </button>

              <div className="min-w-0 flex-1">
                <p className={cn('truncate text-sm', done ? 'text-[var(--text-muted)]' : '')}>
                  <span className="font-medium">{unitLabel(unit, language)}</span>
                  {unit.title ? <span className="ml-2">{unit.title}</span> : null}
                </p>
                <div className="mt-0.5 flex items-center gap-2">
                  {unit.publishedAt ? (
                    <span className="text-[11px] text-[var(--text-muted)]">
                      {formatDate(unit.publishedAt, language)}
                    </span>
                  ) : null}
                  {unit.language ? (
                    <span className="text-[11px] text-[var(--text-muted)]">
                      {unit.language.toUpperCase()}
                    </span>
                  ) : null}
                  {unit.isOfficial ? <Badge color="var(--color-success)">Officiel</Badge> : null}
                  {unreleased ? <Badge color="var(--color-warning)">À paraître</Badge> : null}
                </div>
              </div>

              {!done ? (
                <button
                  type="button"
                  onClick={() => onMarkUpTo(unit)}
                  disabled={busy}
                  className="hidden text-[11px] text-[var(--text-muted)] hover:text-[var(--text)] sm:block"
                >
                  Marquer jusqu&apos;ici
                </button>
              ) : null}

              {unit.externalUrl ? (
                <a
                  href={unit.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Ouvrir"
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                >
                  <ExternalLink size={15} />
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>

      {visible < ordered.length ? (
        <Button className="w-full" onClick={() => setVisible((value) => value + pageSize)}>
          Afficher {Math.min(pageSize, ordered.length - visible)} de plus
        </Button>
      ) : null}
    </div>
  );
}
