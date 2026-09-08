import { useState } from 'react';
import type { WorkKind } from '@scanlib/shared';
import { workKindLabels } from '@scanlib/shared';
import { useSession } from '../hooks/useSession';
import { cn } from './ui';

/**
 * Graphiques dessinés en SVG à la main.
 *
 * Trois formes seulement, chacune choisie pour la question posée : une heatmap
 * pour la régularité dans le temps, des barres horizontales pour comparer des
 * grandeurs nommées, une barre empilée pour une composition. Aucune ne demande
 * de bibliothèque, et chacune reste lisible en thème clair comme sombre.
 *
 * Les couleurs viennent de tokens validés (bande de luminosité, séparation
 * perceptive en vision déficiente, contraste sur le fond) — voir index.css.
 */

/* -------------------------------------------------------------------------
 * Tuile de chiffre clé
 * ---------------------------------------------------------------------- */

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] px-4 py-3">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{hint}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Heatmap d'activité
 * ---------------------------------------------------------------------- */

/**
 * Clé « YYYY-MM-DD » en heure locale. `toISOString` bascule en UTC et décale
 * d'un jour toute activité de fin de soirée pour les fuseaux à l'est.
 */
function localKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

const CELL = 12;
const GAP = 3;
const WEEKS = 53;

/**
 * Une case par jour sur un an. L'intensité suit une rampe d'une seule teinte ;
 * les jours sans activité gardent la couleur du fond, ce qui distingue « rien »
 * d'une valeur faible sans les faire concourir visuellement.
 */
export function ActivityHeatmap({ data }: { data: { date: string; count: number }[] }) {
  const { language } = useSession();
  const [hover, setHover] = useState<{ date: string; count: number; x: number; y: number } | null>(
    null,
  );

  const counts = new Map(data.map((row) => [row.date, row.count]));
  const max = Math.max(1, ...data.map((row) => row.count));

  // Minuit local : les dates renvoyées par l'API sont des jours, pas des
  // instants, et comparer des heures ferait sauter ou dupliquer une colonne.
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = new Date(today);
  start.setDate(start.getDate() - (WEEKS * 7 - 1));
  // Chaque colonne est une semaine : on recule jusqu'au lundi précédent. La
  // grille couvre donc un peu plus d'un an, et se termine bien sur aujourd'hui.
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));

  const totalDays = Math.round((today.getTime() - start.getTime()) / 86_400_000) + 1;

  const cells: { date: string; count: number; week: number; day: number }[] = [];
  for (let index = 0; index < totalDays; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    cells.push({
      date: localKey(date),
      count: counts.get(localKey(date)) ?? 0,
      week: Math.floor(index / 7),
      day: index % 7,
    });
  }

  const level = (count: number): string => {
    if (count === 0) return 'var(--heat-empty)';
    const ratio = count / max;
    if (ratio <= 0.25) return 'var(--heat-1)';
    if (ratio <= 0.5) return 'var(--heat-2)';
    if (ratio <= 0.75) return 'var(--heat-3)';
    return 'var(--heat-4)';
  };

  const width = Math.ceil(totalDays / 7) * (CELL + GAP);
  const height = 7 * (CELL + GAP);

  return (
    <div className="relative">
      <div className="overflow-x-auto pb-2 no-scrollbar">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Activité quotidienne sur les ${WEEKS} dernières semaines`}
        >
          {cells.map((cell) => (
            <rect
              key={cell.date}
              x={cell.week * (CELL + GAP)}
              y={cell.day * (CELL + GAP)}
              width={CELL}
              height={CELL}
              rx={3}
              fill={level(cell.count)}
              onMouseEnter={() =>
                setHover({
                  date: cell.date,
                  count: cell.count,
                  x: cell.week * (CELL + GAP),
                  y: cell.day * (CELL + GAP),
                })
              }
              onMouseLeave={() => setHover(null)}
            >
              <title>
                {new Date(cell.date).toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-GB')} —{' '}
                {cell.count}
              </title>
            </rect>
          ))}
        </svg>
      </div>

      {hover ? (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1 text-[11px] shadow-lg"
          style={{ left: Math.min(hover.x, width - 140), top: hover.y + 20 }}
        >
          <strong>{hover.count}</strong> unité{hover.count > 1 ? 's' : ''} ·{' '}
          {new Date(hover.date).toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-GB')}
        </div>
      ) : null}

      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
        <span>Moins</span>
        {['var(--heat-empty)', 'var(--heat-1)', 'var(--heat-2)', 'var(--heat-3)', 'var(--heat-4)'].map(
          (color) => (
            <span
              key={color}
              className="size-3 rounded-[3px]"
              style={{ backgroundColor: color }}
              aria-hidden
            />
          ),
        )}
        <span>Plus</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Barres horizontales
 * ---------------------------------------------------------------------- */

/**
 * Comparaison de grandeurs nommées : les libellés sont posés à gauche, la
 * valeur en bout de barre. Une seule série, donc une seule teinte et pas de
 * légende — le titre du bloc suffit à dire ce qui est mesuré.
 */
export function BarList({
  items,
  color = 'var(--color-accent)',
  emptyLabel = 'Pas encore de données',
}: {
  items: { label: string; value: number }[];
  color?: string;
  emptyLabel?: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">{emptyLabel}</p>;
  }
  const max = Math.max(...items.map((item) => item.value));

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.label} className="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-2">
          <span className="truncate text-xs text-[var(--text-muted)]" title={item.label}>
            {item.label}
          </span>
          <span className="h-3 rounded-full bg-[var(--surface-hover)]">
            <span
              className="block h-3 rounded-full transition-[width] duration-500"
              style={{
                width: `${Math.max(2, (item.value / max) * 100)}%`,
                backgroundColor: color,
              }}
            />
          </span>
          <span className="text-right text-xs tabular-nums">{item.value}</span>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------
 * Composition par type
 * ---------------------------------------------------------------------- */

const kindChartColors: Record<WorkKind, string> = {
  manga: 'var(--color-chart-manga)',
  anime: 'var(--color-chart-anime)',
  tv: 'var(--color-chart-tv)',
  movie: 'var(--color-chart-movie)',
};

/**
 * Barre empilée : quatre catégories au plus, une légende toujours présente et
 * les valeurs écrites en clair — l'identité ne repose jamais sur la seule
 * couleur. Un filet de fond sépare les segments.
 */
export function KindComposition({ byKind }: { byKind: Record<string, number> }) {
  const { language } = useSession();
  const entries = (Object.keys(kindChartColors) as WorkKind[])
    .map((kind) => ({ kind, value: byKind[kind] ?? 0 }))
    .filter((entry) => entry.value > 0);

  const total = entries.reduce((sum, entry) => sum + entry.value, 0);
  if (total === 0) return <p className="text-sm text-[var(--text-muted)]">Bibliothèque vide.</p>;

  return (
    <div className="space-y-3">
      <div className="flex h-4 gap-0.5 overflow-hidden rounded-full">
        {entries.map((entry) => (
          <div
            key={entry.kind}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${(entry.value / total) * 100}%`,
              backgroundColor: kindChartColors[entry.kind],
            }}
            title={`${workKindLabels[entry.kind][language]} : ${entry.value}`}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {entries.map((entry) => (
          <li key={entry.kind} className="flex items-center gap-1.5 text-xs">
            <span
              className="size-2.5 rounded-[3px]"
              style={{ backgroundColor: kindChartColors[entry.kind] }}
              aria-hidden
            />
            <span>{workKindLabels[entry.kind][language]}</span>
            <span className="tabular-nums text-[var(--text-muted)]">{entry.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Distribution des notes
 * ---------------------------------------------------------------------- */

export function ScoreDistribution({ data }: { data: { score: number; count: number }[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">Aucune note pour l’instant.</p>;
  }
  const max = Math.max(...data.map((item) => item.count));
  const byScore = new Map(data.map((item) => [item.score, item.count]));

  return (
    <div className="flex h-32 items-end gap-1.5">
      {Array.from({ length: 10 }, (_, index) => index + 1).map((score) => {
        const count = byScore.get(score) ?? 0;
        return (
          <div key={score} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[10px] tabular-nums text-[var(--text-muted)]">
              {count > 0 ? count : ''}
            </span>
            <div
              className={cn('w-full rounded-t-[4px] transition-[height] duration-500')}
              style={{
                height: `${count === 0 ? 2 : Math.max(6, (count / max) * 90)}px`,
                backgroundColor: count === 0 ? 'var(--surface-hover)' : 'var(--color-accent)',
              }}
              title={`${count} œuvre(s) notée(s) ${score}/10`}
            />
            <span className="text-[10px] tabular-nums text-[var(--text-muted)]">{score}</span>
          </div>
        );
      })}
    </div>
  );
}
