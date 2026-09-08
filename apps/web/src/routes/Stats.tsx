import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { libraryStatusColors, libraryStatusLabels, type LibraryStatus } from '@scanlib/shared';
import { api } from '../lib/api';
import { formatAgo, formatMinutes, formatNumber } from '../lib/format';
import { useSession } from '../hooks/useSession';
import {
  ActivityHeatmap,
  BarList,
  KindComposition,
  ScoreDistribution,
  StatTile,
} from '../components/charts';
import { Card, ErrorState, LoadingBlock, SectionTitle } from '../components/ui';

export function StatsPage() {
  const { language, t } = useSession();

  const stats = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.stats(),
    staleTime: 5 * 60_000,
  });

  if (stats.isPending) return <LoadingBlock />;
  if (stats.isError) {
    return <ErrorState message={(stats.error as Error).message} onRetry={() => stats.refetch()} />;
  }

  const { totals, heatmap, topGenres, scoreDistribution, streak, recentActivity } = stats.data;
  const totalMinutes = totals.minutesWatched + totals.minutesRead;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{t('nav.stats')}</h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={t('stats.watched')}
          value={formatNumber(totals.episodesWatched, language)}
          hint={formatMinutes(totals.minutesWatched, language)}
        />
        <StatTile
          label={t('stats.read')}
          value={formatNumber(totals.chaptersRead, language)}
          hint={formatMinutes(totals.minutesRead, language)}
        />
        <StatTile
          label={t('stats.time')}
          value={formatMinutes(totalMinutes, language)}
          hint="Estimation, durées réelles quand elles sont connues"
        />
        <StatTile
          label={t('stats.streak')}
          value={`${streak.current} j`}
          hint={`Record : ${streak.longest} jours`}
        />
      </div>

      <Card className="p-4">
        <SectionTitle
          title={t('stats.activity')}
          hint="Chaque case représente un jour et le nombre d’unités terminées."
        />
        <ActivityHeatmap data={heatmap} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card className="p-4">
          <SectionTitle title="Composition de la bibliothèque" />
          <KindComposition byKind={totals.byKind} />

          <div className="mt-5">
            <p className="mb-2 text-sm font-medium">Par statut</p>
            <ul className="space-y-1.5">
              {Object.entries(totals.byStatus).map(([status, count]) => (
                <li key={status} className="flex items-center gap-2 text-xs">
                  <span
                    className="size-2.5 rounded-[3px]"
                    style={{ backgroundColor: libraryStatusColors[status as LibraryStatus] }}
                    aria-hidden
                  />
                  <span className="flex-1">
                    {libraryStatusLabels[status as LibraryStatus]?.[language] ?? status}
                  </span>
                  <span className="tabular-nums text-[var(--text-muted)]">{count}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card className="p-4">
          <SectionTitle title={t('stats.genres')} />
          <BarList
            items={topGenres.map((genre) => ({ label: genre.genre, value: genre.count }))}
          />
        </Card>

        <Card className="p-4">
          <SectionTitle title={t('stats.scores')} hint="Vos notes, de 1 à 10." />
          <ScoreDistribution data={scoreDistribution} />
        </Card>

        <Card className="p-4">
          <SectionTitle title="Activité récente" />
          {recentActivity.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">Aucune activité enregistrée.</p>
          ) : (
            <ul className="space-y-2">
              {recentActivity.slice(0, 12).map((activity, index) => (
                <li key={`${activity.at}-${index}`} className="flex items-baseline gap-2 text-xs">
                  <span className="w-20 shrink-0 text-[var(--text-muted)]">
                    {formatAgo(activity.at, language)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {activity.workId ? (
                      <Link to={`/work/${activity.workId}`} className="hover:underline">
                        {activity.workTitle ?? 'Œuvre'}
                      </Link>
                    ) : (
                      (activity.workTitle ?? '—')
                    )}
                    {activity.detail ? (
                      <span className="text-[var(--text-muted)]"> · {activity.detail}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
