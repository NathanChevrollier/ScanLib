import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarClock, Heart, RefreshCw, Star, Trash2 } from 'lucide-react';
import type { LibraryStatus, Unit } from '@scanlib/shared';
import {
  libraryStatusColors,
  libraryStatusLabels,
  libraryStatuses,
  releaseStatusLabels,
} from '@scanlib/shared';
import { ApiError, api } from '../lib/api';
import { formatDate, kindColors, percent } from '../lib/format';
import { cacheSet, notifyQueued, queueProgress } from '../lib/offline';
import { useCachedQuery } from '../hooks/useCachedQuery';
import { useSession } from '../hooks/useSession';
import { Cover, KindBadge } from '../components/WorkCard';
import { LinkList } from '../components/LinkList';
import { PrimaryLinksEditor } from '../components/PrimaryLinks';
import { ProgressControl } from '../components/ProgressControl';
import { SourceManager } from '../components/SourceManager';
import { UnitList } from '../components/UnitList';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  IconButton,
  LoadingBlock,
  ProgressBar,
  SectionTitle,
  cn,
  selectClass,
} from '../components/ui';
import { ScheduleDialog } from '../components/ScheduleDialog';

type Tab = 'links' | 'units' | 'about';

export function WorkPage() {
  const { workId = '' } = useParams();
  const { language } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('links');
  const [scheduleOpen, setScheduleOpen] = useState(false);

  // Rouvrir le formulaire doit modifier le rythme existant, pas le dupliquer.
  const schedules = useQuery({
    queryKey: ['schedules'],
    queryFn: () => api.schedules(),
    staleTime: 10 * 60_000,
  });
  const workSchedule = (schedules.data?.schedules ?? []).find(
    (schedule) => schedule.workId === workId,
  );

  const work = useQuery({
    queryKey: ['work', workId],
    queryFn: () => api.work(workId),
  });

  const units = useQuery({
    queryKey: ['units', workId],
    queryFn: () => api.units(workId),
    enabled: Boolean(work.data),
  });

  const links = useQuery({
    queryKey: ['links', workId],
    queryFn: () => api.links(workId),
    enabled: Boolean(work.data),
    staleTime: 60 * 60_000,
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['work', workId] }),
      queryClient.invalidateQueries({ queryKey: ['units', workId] }),
      queryClient.invalidateQueries({ queryKey: ['library'] }),
      queryClient.invalidateQueries({ queryKey: ['queue'] }),
    ]);
  };

  const updateEntry = useMutation({
    mutationFn: (input: Parameters<typeof api.updateEntry>[1]) => api.updateEntry(workId, input),
    onSuccess: invalidate,
  });

  /**
   * Les marquages partent immédiatement ; hors connexion ils sont écrits dans
   * une file locale et rejoués au retour du réseau, la case restant cochée
   * entre-temps.
   *
   * `networkMode: 'always'` est indispensable : par défaut TanStack Query met
   * les mutations en pause quand le navigateur est hors ligne et ne les rejoue
   * qu'au retour du réseau — mais uniquement tant que l'onglet reste ouvert.
   * Or c'est précisément l'application fermée dans le métro qu'il faut couvrir,
   * d'où la file persistée en IndexedDB.
   */
  const progress = useMutation({
    networkMode: 'always',
    mutationFn: async ({ unitIds, completed }: { unitIds: string[]; completed: boolean }) => {
      if (!navigator.onLine) {
        await queueProgress(unitIds, completed);
        return null;
      }
      try {
        return await api.setProgress(unitIds, completed);
      } catch (error) {
        // `navigator.onLine` ment régulièrement — il reste à vrai après un
        // démarrage sans réseau. Seul l'échec de la requête est fiable : une
        // erreur applicative (ApiError) remonte, une coupure réseau est mise
        // en file comme si l'on savait déjà être hors ligne.
        if (error instanceof ApiError) throw error;
        await queueProgress(unitIds, completed);
        notifyQueued();
        return null;
      }
    },
    onMutate: async ({ unitIds, completed }) => {
      await queryClient.cancelQueries({ queryKey: ['units', workId] });
      const previous = queryClient.getQueryData(['units', workId]);
      const applied = queryClient.setQueryData(['units', workId], (current: typeof units.data) => {
        if (!current) return current;
        const set = new Set(current.completedUnitIds);
        for (const id of unitIds) {
          if (completed) set.add(id);
          else set.delete(id);
        }
        return { ...current, completedUnitIds: [...set] };
      });
      // La copie locale suit l'affichage : sans cela, un rechargement hors ligne
      // ferait réapparaître les cases décochées.
      if (applied) void cacheSet(`units:${workId}`, applied);
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(['units', workId], context.previous);
    },
    onSettled: invalidate,
  });

  /** Réglage direct : coche jusqu'au numéro donné et décoche au-delà. */
  const setProgress = useMutation({
    mutationFn: (number: number) => api.setProgressNumber(workId, number),
    onSuccess: async (result) => {
      queryClient.setQueryData(['units', workId], (current: typeof units.data) =>
        current ? { ...current, completedUnitIds: result.completedUnitIds } : current,
      );
      await invalidate();
    },
  });

  const markUpTo = useMutation({
    mutationFn: (unit: Unit) => api.markUpTo(workId, unit.number ?? 0),
    onSuccess: async (result) => {
      queryClient.setQueryData(['units', workId], (current: typeof units.data) =>
        current ? { ...current, completedUnitIds: result.completedUnitIds } : current,
      );
      await invalidate();
    },
  });

  const addToLibrary = useMutation({
    mutationFn: () => {
      const external = work.data!.work.externals[0]!;
      return api.addToLibrary({
        provider: external.provider,
        providerId: external.providerId,
        kind: work.data!.work.kind,
        status: 'planned',
      });
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: () => api.removeFromLibrary(workId),
    onSuccess: async () => {
      await invalidate();
      navigate('/');
    },
  });

  const refresh = useMutation({
    mutationFn: () => api.refreshWork(workId),
    onSuccess: async () => {
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: ['links', workId] });
    },
  });

  // Repli sur la copie locale : la fiche, ses chapitres et ses liens restent
  // consultables sans réseau, avec la progression déjà connue.
  const cachedWork = useCachedQuery(`work:${workId}`, work);
  const cachedUnits = useCachedQuery(`units:${workId}`, units);
  const cachedLinks = useCachedQuery(`links:${workId}`, links);

  const completedIds = useMemo(
    () => new Set(cachedUnits.data?.completedUnitIds ?? []),
    [cachedUnits.data?.completedUnitIds],
  );

  if (work.isPending && !cachedWork.data) return <LoadingBlock />;
  if (!cachedWork.data) {
    return <ErrorState message={(work.error as Error).message} onRetry={() => work.refetch()} />;
  }

  const { work: details, entry } = cachedWork.data;
  const unitList = cachedUnits.data?.units ?? [];
  const done = completedIds.size;
  /** Numéro le plus élevé connu : borne du réglage direct de progression. */
  const maxUnitNumber = unitList.reduce<number | null>(
    (max, unit) => (unit.number != null && (max == null || unit.number > max) ? unit.number : max),
    null,
  );
  // Le lien saisi par l'utilisateur dans sa langue prime sur tout le reste.
  const userPrimaryLink =
    entry?.primaryLinks[language] ?? entry?.primaryLinks.fr ?? entry?.primaryLinks.en ?? null;
  const total = unitList.length || (details.totalUnits ?? 0);
  const nextUnit = unitList.find((unit) => !completedIds.has(unit.id));
  const bestPlatformLink =
    cachedLinks.data?.links.find((link) => link.kind === 'stream' || link.kind === 'read') ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <IconButton label="Retour" onClick={() => navigate(-1)}>
          <ArrowLeft size={18} />
        </IconButton>
        <span className="text-sm text-[var(--text-muted)]">Fiche</span>
        <div className="flex-1" />
        <IconButton
          label="Rafraîchir les données"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
        >
          <RefreshCw size={16} className={refresh.isPending ? 'animate-spin' : ''} />
        </IconButton>
        {entry ? (
          <IconButton label="Retirer de la bibliothèque" onClick={() => remove.mutate()}>
            <Trash2 size={16} />
          </IconButton>
        ) : null}
      </div>

      <div className="flex flex-col gap-5 sm:flex-row">
        <div className="w-32 shrink-0 sm:w-44">
          <Cover work={details} />
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h1 className="text-xl font-semibold sm:text-2xl">{details.title}</h1>
            {details.titles.romaji && details.titles.romaji !== details.title ? (
              <p className="text-sm text-[var(--text-muted)]">{details.titles.romaji}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <KindBadge kind={details.kind} />
            <Badge>{releaseStatusLabels[details.releaseStatus][language]}</Badge>
            {details.year ? (
              <span className="text-sm text-[var(--text-muted)]">{details.year}</span>
            ) : null}
            {details.score ? (
              <span className="flex items-center gap-1 text-sm text-[var(--text-muted)]">
                <Star size={13} /> {details.score.toFixed(1)}
              </span>
            ) : null}
          </div>

          {entry ? (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={entry.status}
                onChange={(event) =>
                  updateEntry.mutate({ status: event.target.value as LibraryStatus })
                }
                className={selectClass}
                aria-label="Statut"
                style={{ color: libraryStatusColors[entry.status] }}
              >
                {libraryStatuses.map((status) => (
                  <option key={status} value={status}>
                    {libraryStatusLabels[status][language]}
                  </option>
                ))}
              </select>

              <select
                value={entry.score ?? ''}
                onChange={(event) =>
                  updateEntry.mutate({
                    score: event.target.value === '' ? null : Number(event.target.value),
                  })
                }
                className={selectClass}
                aria-label="Ma note"
              >
                <option value="">Note…</option>
                {Array.from({ length: 10 }, (_, index) => index + 1).map((score) => (
                  <option key={score} value={score}>
                    {score}/10
                  </option>
                ))}
              </select>

              <IconButton
                label={entry.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                onClick={() => updateEntry.mutate({ favorite: !entry.favorite })}
              >
                <Heart
                  size={18}
                  className={entry.favorite ? 'fill-[var(--color-danger)] text-[var(--color-danger)]' : ''}
                />
              </IconButton>
            </div>
          ) : (
            <Button
              variant="primary"
              loading={addToLibrary.isPending}
              onClick={() => addToLibrary.mutate()}
            >
              Ajouter à ma bibliothèque
            </Button>
          )}

          {entry && total > 0 ? (
            <div className="space-y-1">
              <ProgressBar value={percent(done, total)} color={kindColors[details.kind]} />
              <p className="text-xs text-[var(--text-muted)]">
                {done} / {total} {details.kind === 'manga' ? 'chapitres' : 'épisodes'}
              </p>
            </div>
          ) : null}

          {entry ? (
            <ProgressControl
              kind={details.kind}
              current={entry.progress ?? 0}
              total={maxUnitNumber}
              busy={setProgress.isPending}
              onSet={(value) => setProgress.mutate(value)}
            />
          ) : null}

          {/* Action principale : reprendre là où on s'est arrêté. Le lien
              choisi par l'utilisateur passe avant tout le reste, puis le lien
              du chapitre, puis la meilleure plateforme trouvée. */}
          {entry && nextUnit ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                onClick={() => {
                  const url = userPrimaryLink ?? nextUnit.externalUrl ?? bestPlatformLink?.url;
                  if (url) window.open(url, '_blank', 'noopener,noreferrer');
                  progress.mutate({ unitIds: [nextUnit.id], completed: true });
                }}
              >
                {details.kind === 'manga' ? 'Lire' : 'Regarder'}{' '}
                {nextUnit.number != null ? `#${nextUnit.number}` : ''}
              </Button>
              <Button onClick={() => progress.mutate({ unitIds: [nextUnit.id], completed: true })}>
                Marquer comme {details.kind === 'manga' ? 'lu' : 'vu'}
              </Button>
            </div>
          ) : null}

          {/* C'est en consultant une fiche qu'on constate qu'une date manque
              ou qu'elle est fausse. */}
          {entry ? (
            <Button
              icon={<CalendarClock size={16} />}
              onClick={() => setScheduleOpen(true)}
            >
              {details.nextRelease ? 'Corriger le rythme de sortie' : 'Définir un jour de sortie'}
            </Button>
          ) : null}
        </div>
      </div>

      <ScheduleDialog
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        schedule={workSchedule ?? null}
        defaultWorkId={details.id}
      />

      <div className="flex gap-1 border-b border-[var(--border)]">
        {(
          [
            ['links', details.kind === 'manga' ? 'Où lire' : 'Où regarder'],
            ['units', details.kind === 'manga' ? 'Chapitres' : 'Épisodes'],
            ['about', 'À propos'],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              'min-h-11 border-b-2 px-3 text-sm font-medium transition-colors',
              tab === value
                ? 'border-[var(--color-accent)] text-[var(--text)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'links' && entry ? (
        <Card className="space-y-3 p-4">
          <SectionTitle
            title="Mes liens"
            hint="La page que vous ouvrez vraiment pour cette œuvre. Ces liens passent devant tous les autres."
          />
          <PrimaryLinksEditor
            kind={details.kind}
            value={entry.primaryLinks}
            busy={updateEntry.isPending}
            onSave={(primaryLinks) => updateEntry.mutate({ primaryLinks })}
          />
        </Card>
      ) : null}

      {tab === 'links' ? (
        links.isPending && !cachedLinks.data ? (
          <LoadingBlock label="Recherche des liens officiels…" />
        ) : !cachedLinks.data ? (
          <ErrorState message={(links.error as Error).message} onRetry={() => links.refetch()} />
        ) : (
          <LinkList links={cachedLinks.data.links} attributions={cachedLinks.data.attributions} />
        )
      ) : null}

      {/* Un marquage refusé (stockage local indisponible hors connexion) doit se
          voir : l'utilisateur croirait sinon avoir coché son épisode. */}
      {progress.isError ? (
        <ErrorState message={(progress.error as Error).message} />
      ) : null}

      {tab === 'units' ? (
        units.isPending && !cachedUnits.data ? (
          <LoadingBlock label="Récupération de la liste…" />
        ) : !cachedUnits.data ? (
          <ErrorState message={(units.error as Error).message} onRetry={() => units.refetch()} />
        ) : unitList.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            Aucune liste détaillée disponible pour cette œuvre.
          </p>
        ) : !entry ? (
          <p className="text-sm text-[var(--text-muted)]">
            Ajoutez cette œuvre à votre bibliothèque pour suivre votre progression.
          </p>
        ) : (
          <UnitList
            units={unitList}
            completedIds={completedIds}
            busy={progress.isPending || markUpTo.isPending}
            onToggle={(unit, completed) => progress.mutate({ unitIds: [unit.id], completed })}
            onMarkUpTo={(unit) => markUpTo.mutate(unit)}
          />
        )
      ) : null}

      {tab === 'about' ? (
        <Card className="space-y-4 p-4">
          {details.synopsis[language] || details.synopsis.en || details.synopsis.fr ? (
            <p className="text-sm leading-relaxed whitespace-pre-line">
              {details.synopsis[language] ?? details.synopsis.fr ?? details.synopsis.en}
            </p>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">Aucun résumé disponible.</p>
          )}

          {details.genres.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {details.genres.map((genre) => (
                <Badge key={genre}>{genre}</Badge>
              ))}
            </div>
          ) : null}

          <dl className="grid grid-cols-2 gap-3 text-sm">
            {details.authors.length > 0 ? (
              <Detail label="Auteurs" value={details.authors.join(', ')} />
            ) : null}
            {details.studios.length > 0 ? (
              <Detail label="Studios / éditeurs" value={details.studios.join(', ')} />
            ) : null}
            {details.startDate ? (
              <Detail label="Début" value={formatDate(details.startDate, language)} />
            ) : null}
            {details.endDate ? (
              <Detail label="Fin" value={formatDate(details.endDate, language)} />
            ) : null}
            {details.averageRuntime ? (
              <Detail label="Durée moyenne" value={`${details.averageRuntime} min`} />
            ) : null}
            {details.availableLanguages.length > 0 ? (
              <Detail
                label="Langues disponibles"
                value={details.availableLanguages.slice(0, 8).join(', ').toUpperCase()}
              />
            ) : null}
          </dl>

          <div className="space-y-2 border-t border-[var(--border)] pt-3">
            <p className="text-sm font-medium">Sources rattachées</p>
            <p className="text-xs text-[var(--text-muted)]">
              Le rapprochement entre bases est automatique et peut se tromper. Si une source décrit
              en réalité une autre œuvre, détachez-la : la fiche et ses liens sont recalculés.
            </p>
            <SourceManager workId={workId} externals={details.externals} />
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--text-muted)]">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
