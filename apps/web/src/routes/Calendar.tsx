import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Pencil, Plus } from 'lucide-react';
import type { CalendarEntry, ReleaseSchedule } from '@scanlib/shared';
import { api } from '../lib/api';
import { formatRelativeDay, kindColors } from '../lib/format';
import { useSession } from '../hooks/useSession';
import { Cover } from '../components/WorkCard';
import { ScheduleDialog } from '../components/ScheduleDialog';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  SectionTitle,
} from '../components/ui';

const weekdays = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/**
 * Agenda des sorties, groupé par jour. Les sorties déjà disponibles mais non
 * consommées apparaissent en tête : c'est la réponse à « qu'est-ce que je peux
 * regarder tout de suite ? ».
 *
 * Les lignes issues d'un rythme saisi par l'utilisateur sont modifiables sur
 * place : les API n'annoncent au mieux qu'une seule date à venir, et rien du
 * tout pour les scans.
 */
export function CalendarPage() {
  const { language, t } = useSession();
  const [dialog, setDialog] = useState<{ open: boolean; schedule: ReleaseSchedule | null }>({
    open: false,
    schedule: null,
  });

  const calendar = useQuery({
    queryKey: ['calendar'],
    queryFn: () => api.calendar(),
    staleTime: 10 * 60_000,
  });

  const schedules = useQuery({
    queryKey: ['schedules'],
    queryFn: () => api.schedules(),
    staleTime: 10 * 60_000,
  });

  const byId = useMemo(
    () => new Map((schedules.data?.schedules ?? []).map((item) => [item.id, item])),
    [schedules.data],
  );

  const days = useMemo(() => {
    const groups = new Map<string, CalendarEntry[]>();
    for (const entry of calendar.data?.entries ?? []) {
      const key = entry.releaseAt.slice(0, 10);
      const bucket = groups.get(key);
      if (bucket) bucket.push(entry);
      else groups.set(key, [entry]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [calendar.data]);

  const available = (calendar.data?.entries ?? []).filter((entry) => entry.isAvailable);

  const openEdit = (scheduleId: string) => {
    const schedule = byId.get(scheduleId);
    if (schedule) setDialog({ open: true, schedule });
  };

  return (
    <div className="mx-auto w-full max-w-[110rem] space-y-6">
      <PageHeader
        title={t('nav.calendar')}
        subtitle="Vos sorties à venir, annoncées par les sources ou réglées par vous."
        action={
          <Button
            variant="primary"
            icon={<Plus size={16} />}
            onClick={() => setDialog({ open: true, schedule: null })}
          >
            {t('calendar.addRelease')}
          </Button>
        }
      />

      {calendar.isPending ? (
        <LoadingBlock />
      ) : calendar.isError ? (
        <ErrorState
          message={(calendar.error as Error).message}
          onRetry={() => void calendar.refetch()}
        />
      ) : (
        <>
          {available.length > 0 ? (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-[var(--color-success)]">
                Disponible maintenant · {available.length}
              </h2>
              <div className="no-scrollbar flex gap-3 overflow-x-auto pb-2">
                {available.map((entry) => (
                  <Link
                    key={`${entry.work?.id}-${entry.unitNumber}`}
                    to={`/work/${entry.work?.id}`}
                    className="w-28 shrink-0"
                  >
                    {entry.work ? <Cover work={entry.work} /> : null}
                    <p className="mt-1.5 line-clamp-2 text-xs font-medium">{entry.work?.title}</p>
                    {entry.unitNumber != null ? (
                      <p className="text-[11px] text-[var(--text-muted)]">#{entry.unitNumber}</p>
                    ) : null}
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="space-y-6">
              {days.length === 0 ? (
                <EmptyState
                  icon={<CalendarDays size={28} />}
                  title={t('calendar.empty')}
                  description="Ajoutez le rythme d'une série pour la voir apparaître ici."
                  action={
                    <Button
                      variant="primary"
                      icon={<Plus size={16} />}
                      onClick={() => setDialog({ open: true, schedule: null })}
                    >
                      {t('calendar.addRelease')}
                    </Button>
                  }
                />
              ) : (
                days.map(([day, entries]) => (
                  <section key={day}>
                    <h2 className="mb-2 text-sm font-semibold capitalize">
                      {formatRelativeDay(`${day}T12:00:00Z`, language)}
                    </h2>
                    <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)]">
                      {entries.map((entry) => (
                        <li
                          key={`${entry.work?.id ?? entry.scheduleId}-${entry.unitNumber}-${entry.releaseAt}`}
                          className="flex items-center transition-colors hover:bg-[var(--surface-hover)]"
                        >
                          <EntryRow entry={entry} language={language} t={t} />
                          {entry.scheduleId ? (
                            <button
                              type="button"
                              aria-label={t('calendar.editRelease')}
                              title={t('calendar.editRelease')}
                              onClick={() => openEdit(entry.scheduleId!)}
                              className="mr-2 flex size-9 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
                            >
                              <Pencil size={15} />
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))
              )}
            </div>

            <Card className="p-5">
              <SectionTitle
                title={t('calendar.mySchedules')}
                hint={t('calendar.schedulesHint')}
              />
              {(schedules.data?.schedules ?? []).length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">
                  Aucun rythme enregistré pour l'instant.
                </p>
              ) : (
                <ul className="space-y-2">
                  {(schedules.data?.schedules ?? []).map((schedule) => (
                    <li key={schedule.id}>
                      <button
                        type="button"
                        onClick={() => setDialog({ open: true, schedule })}
                        className="flex w-full items-center gap-3 rounded-xl border border-[var(--border)] px-3 py-2 text-left transition-colors hover:border-[var(--color-ink-600)]"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {schedule.work?.title ?? schedule.label ?? 'Sortie'}
                          </p>
                          <p className="text-xs text-[var(--text-muted)]">
                            {describeSchedule(schedule)}
                          </p>
                        </div>
                        <Pencil size={15} className="shrink-0 text-[var(--text-muted)]" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}

      <ScheduleDialog
        open={dialog.open}
        schedule={dialog.schedule}
        onClose={() => setDialog({ open: false, schedule: null })}
      />
    </div>
  );
}

function EntryRow({
  entry,
  language,
  t,
}: {
  entry: CalendarEntry;
  language: 'fr' | 'en';
  t: (key: 'calendar.available') => string;
}) {
  const content = (
    <>
      <span
        className="h-8 w-1 shrink-0 rounded-full"
        style={{
          backgroundColor: entry.work ? kindColors[entry.work.kind] : 'var(--color-accent)',
        }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {entry.work?.title ?? entry.label ?? 'Sortie'}
        </p>
        <p className="text-xs text-[var(--text-muted)]">
          {entry.unitNumber != null
            ? `${entry.work?.kind === 'manga' ? 'Chapitre' : 'Épisode'} ${entry.unitNumber}`
            : 'Prochaine sortie'}
          {entry.unitTitle ? ` · ${entry.unitTitle}` : ''}
          {entry.source === 'manual' ? ' · rythme personnalisé' : ''}
        </p>
      </div>
      {entry.isAvailable ? (
        <Badge color="var(--color-success)">{t('calendar.available')}</Badge>
      ) : (
        <span className="text-xs text-[var(--text-muted)]">
          {new Date(entry.releaseAt).toLocaleTimeString(language === 'fr' ? 'fr-FR' : 'en-GB', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      )}
    </>
  );

  // Un événement libre ne mène nulle part : le rendre cliquable promettrait une
  // fiche qui n'existe pas.
  return entry.work ? (
    <Link to={`/work/${entry.work.id}`} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2">
      {content}
    </Link>
  ) : (
    <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2">{content}</div>
  );
}

/** Résumé d'un rythme en une ligne : « Chaque semaine, le mardi à 17:00 ». */
function describeSchedule(schedule: ReleaseSchedule): string {
  const time = `à ${schedule.timeOfDay}`;
  switch (schedule.frequency) {
    case 'daily':
      return `Tous les jours ${time}`;
    case 'weekly':
      return `Chaque ${weekdays[schedule.weekday ?? 0]} ${time}`;
    case 'monthly':
      return `Le ${schedule.dayOfMonth} de chaque mois ${time}`;
    default:
      return `Le ${new Date(schedule.startAt).toLocaleDateString('fr-FR')} ${time}`;
  }
}
