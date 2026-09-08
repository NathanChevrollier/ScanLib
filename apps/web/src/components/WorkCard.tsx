import { Link } from 'react-router-dom';
import { BookOpen, Check, Play, Plus, Sparkles } from 'lucide-react';
import type { LibraryItem, SearchResult, WorkKind, WorkSummary } from '@scanlib/shared';
import { libraryStatusColors, libraryStatusLabels, workKindLabels } from '@scanlib/shared';
import { kindColors, percent, unitLabel } from '../lib/format';
import { useSession } from '../hooks/useSession';
import { Badge, ProgressBar, cn } from './ui';

/** Jaquette avec repli typographique quand la source n'en fournit pas. */
export function Cover({
  work,
  className,
}: {
  work: Pick<WorkSummary, 'coverUrl' | 'title' | 'kind'>;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative aspect-2/3 w-full overflow-hidden rounded-lg bg-[var(--surface-hover)]',
        className,
      )}
    >
      {work.coverUrl ? (
        <img
          src={work.coverUrl}
          alt=""
          loading="lazy"
          decoding="async"
          /* MangaDex et MyAnimeList refusent les référents tiers sur leurs CDN. */
          referrerPolicy="no-referrer"
          className="size-full object-cover"
        />
      ) : (
        <div className="flex size-full items-center justify-center p-2 text-center text-xs text-[var(--text-muted)]">
          {work.title}
        </div>
      )}
      <span
        className="absolute top-1.5 left-1.5 size-2 rounded-full ring-2 ring-black/30"
        style={{ backgroundColor: kindColors[work.kind] }}
        aria-hidden
      />
    </div>
  );
}

export function KindBadge({ kind }: { kind: WorkKind }) {
  const { language } = useSession();
  return <Badge color={kindColors[kind]}>{workKindLabels[kind][language]}</Badge>;
}

/**
 * Carte de bibliothèque : jaquette, progression, et le geste principal —
 * « Continuer » qui envoie directement vers la prochaine unité non consommée.
 */
export function LibraryCard({
  item,
  onContinue,
  onAdvance,
  onToggleSelect,
  selected,
  busy,
}: {
  item: LibraryItem;
  onContinue?: (item: LibraryItem) => void;
  /** Marque la prochaine unité comme terminée sans quitter la bibliothèque. */
  onAdvance?: (item: LibraryItem) => void;
  /** Sélection pour les actions groupées. */
  onToggleSelect?: (item: LibraryItem) => void;
  selected?: boolean;
  busy?: boolean;
}) {
  const { language } = useSession();
  const { entry, work } = item;
  const progress = percent(item.unitsCompleted, item.unitsTotal);

  return (
    <div className={cn('group relative', selected && 'rounded-lg ring-2 ring-[var(--color-accent)]')}>
      {/* Case de sélection : invisible au repos, révélée au survol ou dès qu'une
          sélection existe, pour ne pas encombrer la grille en permanence. */}
      {onToggleSelect ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={selected ?? false}
          aria-label={`Sélectionner ${work.title}`}
          onClick={(event) => {
            event.preventDefault();
            onToggleSelect(item);
          }}
          className={cn(
            'absolute top-1.5 right-1.5 z-10 flex size-6 items-center justify-center rounded-md border transition-opacity',
            selected
              ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white opacity-100'
              : 'border-white/40 bg-black/40 text-transparent opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          )}
        >
          <Check size={14} />
        </button>
      ) : null}

      <Link
        to={`/work/${work.id}`}
        className="block focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]"
      >
        <Cover work={work} />
        <div className="mt-2 space-y-1.5">
          <p className="line-clamp-2 text-sm leading-snug font-medium">{work.title}</p>
          <div className="flex items-center gap-1.5">
            <Badge color={libraryStatusColors[entry.status]}>
              {libraryStatusLabels[entry.status][language]}
            </Badge>
            {item.hasNewUnits ? (
              <Badge color="var(--color-success)">
                <Sparkles size={11} /> {item.unitsAvailable}
              </Badge>
            ) : null}
          </div>
          {item.unitsTotal > 0 ? (
            <div className="space-y-1">
              <ProgressBar value={progress} color={kindColors[work.kind]} />
              <p className="text-[11px] text-[var(--text-muted)]">
                {item.unitsCompleted} / {item.unitsTotal}
                {item.unitsAvailable > 0 ? ` · ${item.unitsAvailable} dispo.` : ''}
              </p>
            </div>
          ) : null}
        </div>
      </Link>

      {/* Boutons visibles en permanence : sur mobile il n'y a pas de survol, et
          ce sont de loin les actions les plus fréquentes depuis la bibliothèque —
          ouvrir la prochaine unité, ou simplement acter qu'on l'a terminée. */}
      {item.nextUnit ? (
        <div className="mt-2 flex gap-1">
          {onContinue ? (
            <button
              type="button"
              onClick={() => onContinue(item)}
              className={cn(
                'flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg',
                'bg-[var(--surface-hover)] px-2 text-xs font-medium transition-colors',
                'hover:bg-[var(--color-accent)] hover:text-white',
              )}
            >
              {work.kind === 'manga' ? <BookOpen size={13} /> : <Play size={13} />}
              {unitLabel(item.nextUnit, language)}
            </button>
          ) : null}

          {onAdvance ? (
            <button
              type="button"
              disabled={busy}
              aria-label={`Marquer ${unitLabel(item.nextUnit, language)} comme terminé`}
              title={`Marquer ${unitLabel(item.nextUnit, language)} comme terminé`}
              onClick={() => onAdvance(item)}
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-lg',
                'bg-[var(--surface-hover)] transition-colors disabled:opacity-50',
                'hover:bg-[var(--color-success)] hover:text-white',
              )}
            >
              <Plus size={15} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Carte de résultat de recherche, avec l'état « déjà suivi ». */
export function ResultCard({
  result,
  onAdd,
  pending,
}: {
  result: SearchResult;
  onAdd: (result: SearchResult) => void;
  pending?: boolean;
}) {
  const { language } = useSession();
  const inLibrary = result.libraryStatus != null;

  return (
    <div className="flex gap-3">
      <div className="w-16 shrink-0">
        <Cover work={result} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{result.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <KindBadge kind={result.kind} />
          {result.year ? (
            <span className="text-xs text-[var(--text-muted)]">{result.year}</span>
          ) : null}
          {result.score ? (
            <span className="text-xs text-[var(--text-muted)]">★ {result.score.toFixed(1)}</span>
          ) : null}
        </div>
        {result.titles.romaji && result.titles.romaji !== result.title ? (
          <p className="mt-1 truncate text-xs text-[var(--text-muted)]">{result.titles.romaji}</p>
        ) : null}
      </div>
      <div className="flex items-center">
        {inLibrary ? (
          <Badge color={libraryStatusColors[result.libraryStatus!]}>
            <Check size={11} /> {libraryStatusLabels[result.libraryStatus!][language]}
          </Badge>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => onAdd(result)}
            className="min-h-9 rounded-full bg-[var(--color-accent)] px-3 text-xs font-medium text-white disabled:opacity-50"
          >
            Ajouter
          </button>
        )}
      </div>
    </div>
  );
}
