import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Trash2 } from 'lucide-react';
import type { ReleaseSchedule, ScheduleFrequency } from '@scanlib/shared';
import { api } from '../lib/api';
import { useSession } from '../hooks/useSession';
import { useToasts } from '../hooks/useToasts';
import { Button, Field, Modal, cn, inputClass, selectClass } from './ui';
import type { TranslationKey } from '../lib/i18n';

const frequencies: { value: ScheduleFrequency; key: TranslationKey }[] = [
  { value: 'weekly', key: 'calendar.freq.weekly' },
  { value: 'daily', key: 'calendar.freq.daily' },
  { value: 'monthly', key: 'calendar.freq.monthly' },
  { value: 'once', key: 'calendar.freq.once' },
];

const weekdays = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

interface FormState {
  workId: string;
  label: string;
  frequency: ScheduleFrequency;
  weekday: number;
  dayOfMonth: number;
  timeOfDay: string;
  startDate: string;
  startNumber: string;
  note: string;
}

function emptyForm(): FormState {
  const now = new Date();
  return {
    workId: '',
    label: '',
    frequency: 'weekly',
    weekday: now.getDay(),
    dayOfMonth: now.getDate(),
    timeOfDay: '12:00',
    startDate: toDateInput(now),
    startNumber: '',
    note: '',
  };
}

function fromSchedule(schedule: ReleaseSchedule): FormState {
  const start = new Date(schedule.startAt);
  return {
    workId: schedule.workId ?? '',
    label: schedule.label ?? '',
    frequency: schedule.frequency,
    weekday: schedule.weekday ?? start.getDay(),
    dayOfMonth: schedule.dayOfMonth ?? start.getDate(),
    timeOfDay: schedule.timeOfDay,
    startDate: toDateInput(start),
    startNumber: schedule.startNumber != null ? String(schedule.startNumber) : '',
    note: schedule.note ?? '',
  };
}

/**
 * Création et modification d'un rythme de sortie. Le bouton de pré-remplissage
 * interroge les sources rattachées à l'œuvre : corriger une proposition est le
 * seul moyen réaliste de renseigner une bibliothèque entière.
 */
export function ScheduleDialog({
  open,
  onClose,
  schedule,
  defaultWorkId,
}: {
  open: boolean;
  onClose: () => void;
  /** Renseigné en modification, absent en création. */
  schedule?: ReleaseSchedule | null;
  defaultWorkId?: string;
}) {
  const { t } = useSession();
  const { notify } = useToasts();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const library = useQuery({
    queryKey: ['library', 'schedule-picker'],
    queryFn: () => api.library({ limit: 200, sort: 'title', order: 'asc' }),
    staleTime: 5 * 60_000,
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      schedule
        ? fromSchedule(schedule)
        : { ...emptyForm(), ...(defaultWorkId ? { workId: defaultWorkId } : {}) },
    );
  }, [open, schedule, defaultWorkId]);

  const patch = (values: Partial<FormState>) => setForm((current) => ({ ...current, ...values }));

  const suggest = useMutation({
    mutationFn: (workId: string) => api.suggestSchedule(workId),
    onSuccess: ({ suggestion }) => {
      const start = new Date(suggestion.startAt);
      patch({
        frequency: suggestion.frequency,
        weekday: suggestion.weekday ?? start.getDay(),
        dayOfMonth: suggestion.dayOfMonth ?? start.getDate(),
        timeOfDay: suggestion.timeOfDay,
        startDate: toDateInput(start),
        startNumber: suggestion.startNumber != null ? String(suggestion.startNumber) : '',
      });
      notify(suggestion.reason, suggestion.basis === 'default' ? 'info' : 'success');
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        label: form.label.trim() || null,
        frequency: form.frequency,
        weekday: form.frequency === 'weekly' ? form.weekday : null,
        dayOfMonth: form.frequency === 'monthly' ? form.dayOfMonth : null,
        timeOfDay: form.timeOfDay,
        startAt: new Date(`${form.startDate}T${form.timeOfDay}`).toISOString(),
        startNumber: form.startNumber === '' ? null : Number(form.startNumber),
        increment: 1,
        note: form.note.trim() || null,
      };

      return schedule
        ? api.updateSchedule(schedule.id, payload)
        : api.createSchedule({ ...payload, workId: form.workId || null });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['calendar'] });
      await queryClient.invalidateQueries({ queryKey: ['schedules'] });
      notify(schedule ? 'Rythme modifié.' : 'Sortie ajoutée au calendrier.', 'success');
      onClose();
    },
    onError: (caught) =>
      setError(caught instanceof Error ? caught.message : "L'enregistrement a échoué."),
  });

  const remove = useMutation({
    mutationFn: () => api.deleteSchedule(schedule!.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['calendar'] });
      await queryClient.invalidateQueries({ queryKey: ['schedules'] });
      notify('Rythme supprimé.', 'info');
      onClose();
    },
  });

  const submit = () => {
    if (!form.workId && !form.label.trim()) {
      setError('Choisissez une œuvre ou donnez un titre à cette sortie.');
      return;
    }
    if (!form.startDate) {
      setError('Indiquez la date de la première sortie.');
      return;
    }
    setError(null);
    save.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={schedule ? t('calendar.editRelease') : t('calendar.addRelease')}
    >
      {/* La modale ne défile pas d'elle-même : sans cette borne, les derniers
          champs sortent de l'écran sur un portable. */}
      <div className="max-h-[75vh] space-y-4 overflow-y-auto p-5">
        {/* L'œuvre ne se change pas après coup : la récurrence n'aurait plus
            aucun rapport avec les occurrences déjà affichées. */}
        {schedule ? null : (
          <Field label="Œuvre" hint="Laissez vide pour un événement libre (sortie cinéma, hors-série…).">
            <select
              className={cn(selectClass, 'w-full')}
              value={form.workId}
              onChange={(event) => patch({ workId: event.target.value })}
            >
              <option value="">— Événement libre —</option>
              {(library.data?.items ?? []).map((item) => (
                <option key={item.work.id} value={item.work.id}>
                  {item.work.title}
                </option>
              ))}
            </select>
          </Field>
        )}

        {form.workId ? (
          <Button
            icon={<Sparkles size={16} />}
            loading={suggest.isPending}
            onClick={() => suggest.mutate(form.workId)}
          >
            {t('calendar.autofill')}
          </Button>
        ) : (
          <Field label="Titre de la sortie">
            <input
              className={inputClass}
              value={form.label}
              onChange={(event) => patch({ label: event.target.value })}
              placeholder="Chapitre spécial, sortie cinéma…"
            />
          </Field>
        )}

        <div>
          <p className="mb-2 text-sm font-medium">{t('calendar.frequency')}</p>
          <div className="grid grid-cols-2 gap-2">
            {frequencies.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={form.frequency === option.value}
                onClick={() => patch({ frequency: option.value })}
                className={cn(
                  'min-h-11 rounded-xl border text-sm transition-colors',
                  form.frequency === option.value
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                    : 'border-[var(--border)] hover:border-[var(--color-ink-600)]',
                )}
              >
                {t(option.key)}
              </button>
            ))}
          </div>
        </div>

        {form.frequency === 'weekly' ? (
          <Field label={t('calendar.weekday')}>
            <select
              className={cn(selectClass, 'w-full')}
              value={form.weekday}
              onChange={(event) => patch({ weekday: Number(event.target.value) })}
            >
              {weekdays.map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {form.frequency === 'monthly' ? (
          <Field
            label={t('calendar.dayOfMonth')}
            hint="Les mois plus courts utilisent leur dernier jour."
          >
            <input
              type="number"
              min={1}
              max={31}
              className={inputClass}
              value={form.dayOfMonth}
              onChange={(event) => patch({ dayOfMonth: Number(event.target.value) })}
            />
          </Field>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('calendar.firstRelease')}>
            <input
              type="date"
              className={inputClass}
              value={form.startDate}
              onChange={(event) => patch({ startDate: event.target.value })}
            />
          </Field>
          <Field label={t('calendar.timeOfDay')}>
            <input
              type="time"
              className={inputClass}
              value={form.timeOfDay}
              onChange={(event) => patch({ timeOfDay: event.target.value })}
            />
          </Field>
        </div>

        <Field
          label={t('calendar.startNumber')}
          hint="Numéro du chapitre ou de l'épisode attendu à cette première date. Il s'incrémente ensuite tout seul."
        >
          <input
            type="number"
            step="0.5"
            className={inputClass}
            value={form.startNumber}
            onChange={(event) => patch({ startNumber: event.target.value })}
            placeholder="Facultatif"
          />
        </Field>

        {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-4">
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            {t('common.save')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {schedule ? (
            <Button
              variant="ghost"
              className="ml-auto text-[var(--color-danger)]"
              icon={<Trash2 size={15} />}
              loading={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {t('common.remove')}
            </Button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

/** `YYYY-MM-DD` en heure locale — `toISOString` décalerait d'un jour à l'est. */
function toDateInput(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
