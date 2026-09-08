import { and, asc, eq } from 'drizzle-orm';
import type {
  ReleaseSchedule,
  ReleaseScheduleInput,
  ReleaseScheduleUpdate,
  ScheduleFrequency,
  ScheduleSuggestion,
  WorkSummary,
} from '@scanlib/shared';
import { db } from '../db/client.js';
import { externalIds, releaseSchedules, units, works } from '../db/schema.js';
import type { ReleaseScheduleRow } from '../db/schema.js';
import { AppError, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { registry } from '../lib/providers.js';
import { summariesOf } from './works.js';

/** Une occurrence déroulée depuis une récurrence, avant mise en forme. */
export interface ScheduleOccurrence {
  scheduleId: string;
  workId: string | null;
  label: string | null;
  number: number | null;
  releaseAt: Date;
}

/* -------------------------------------------------------------------------
 * Lecture
 * ---------------------------------------------------------------------- */

export async function listSchedules(userId: string): Promise<ReleaseSchedule[]> {
  const rows = await db
    .select()
    .from(releaseSchedules)
    .where(eq(releaseSchedules.userId, userId))
    .orderBy(asc(releaseSchedules.startAt));

  const summaries = await summariesOf([
    ...new Set(rows.map((row) => row.workId).filter((id): id is string => id != null)),
  ]);

  return rows.map((row) => toDto(row, summaries.get(row.workId ?? '') ?? null));
}

/** Récurrences de l'utilisateur, telles qu'utilisées par le calendrier. */
export async function schedulesOf(userId: string): Promise<ReleaseScheduleRow[]> {
  return db.select().from(releaseSchedules).where(eq(releaseSchedules.userId, userId));
}

/* -------------------------------------------------------------------------
 * Écriture
 * ---------------------------------------------------------------------- */

export async function createSchedule(
  userId: string,
  input: ReleaseScheduleInput,
): Promise<ReleaseSchedule> {
  if (input.workId) await assertWorkExists(input.workId);

  const [row] = await db
    .insert(releaseSchedules)
    .values({
      userId,
      workId: input.workId ?? null,
      label: input.label ?? null,
      frequency: input.frequency,
      weekday: input.frequency === 'weekly' ? (input.weekday ?? null) : null,
      dayOfMonth: input.frequency === 'monthly' ? (input.dayOfMonth ?? null) : null,
      timeOfDay: input.timeOfDay,
      startAt: new Date(input.startAt),
      endAt: input.endAt ? new Date(input.endAt) : null,
      startNumber: input.startNumber ?? null,
      increment: input.increment,
      note: input.note ?? null,
    })
    .returning();

  if (!row) throw new AppError('internal_error', "La récurrence n'a pas pu être enregistrée.", 500);
  return toDto(row, await summaryOf(row.workId));
}

export async function updateSchedule(
  userId: string,
  id: string,
  input: ReleaseScheduleUpdate,
): Promise<ReleaseSchedule> {
  const existing = await findOwned(userId, id);
  const frequency = input.frequency ?? existing.frequency;

  // Les champs de rythme ne valent que pour leur fréquence : garder un
  // `weekday` après un passage en mensuel produirait un calendrier incohérent.
  const weekday =
    frequency === 'weekly'
      ? (input.weekday !== undefined ? input.weekday : existing.weekday)
      : null;
  const dayOfMonth =
    frequency === 'monthly'
      ? (input.dayOfMonth !== undefined ? input.dayOfMonth : existing.dayOfMonth)
      : null;

  if (frequency === 'weekly' && weekday == null) {
    throw new AppError('validation_error', 'Choisissez le jour de la semaine.');
  }
  if (frequency === 'monthly' && dayOfMonth == null) {
    throw new AppError('validation_error', 'Choisissez le jour du mois.');
  }

  const [row] = await db
    .update(releaseSchedules)
    .set({
      ...(input.label !== undefined ? { label: input.label } : {}),
      frequency,
      weekday,
      dayOfMonth,
      ...(input.timeOfDay !== undefined ? { timeOfDay: input.timeOfDay } : {}),
      ...(input.startAt !== undefined ? { startAt: new Date(input.startAt) } : {}),
      ...(input.endAt !== undefined ? { endAt: input.endAt ? new Date(input.endAt) : null } : {}),
      ...(input.startNumber !== undefined ? { startNumber: input.startNumber } : {}),
      ...(input.increment !== undefined ? { increment: input.increment } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      updatedAt: new Date(),
    })
    .where(eq(releaseSchedules.id, id))
    .returning();

  if (!row) throw notFound('Récurrence');
  return toDto(row, await summaryOf(row.workId));
}

export async function deleteSchedule(userId: string, id: string): Promise<void> {
  await findOwned(userId, id);
  await db.delete(releaseSchedules).where(eq(releaseSchedules.id, id));
}

async function findOwned(userId: string, id: string): Promise<ReleaseScheduleRow> {
  const [row] = await db
    .select()
    .from(releaseSchedules)
    .where(and(eq(releaseSchedules.id, id), eq(releaseSchedules.userId, userId)))
    .limit(1);
  if (!row) throw notFound('Récurrence');
  return row;
}

async function assertWorkExists(workId: string): Promise<void> {
  const [row] = await db.select({ id: works.id }).from(works).where(eq(works.id, workId)).limit(1);
  if (!row) throw notFound('Œuvre');
}

async function summaryOf(workId: string | null): Promise<WorkSummary | null> {
  if (!workId) return null;
  const summaries = await summariesOf([workId]);
  return summaries.get(workId) ?? null;
}

/* -------------------------------------------------------------------------
 * Déroulé des occurrences
 * ---------------------------------------------------------------------- */

/**
 * Déroule une récurrence sur une fenêtre de dates. Le calcul est fait à la
 * lecture plutôt que matérialisé en base : corriger un rythme met alors à jour
 * tout le calendrier d'un coup, sans migration de lignes ni risque de doublon.
 */
export function expandSchedule(
  schedule: ReleaseScheduleRow,
  from: Date,
  to: Date,
): ScheduleOccurrence[] {
  const occurrences: ScheduleOccurrence[] = [];
  const end = schedule.endAt && schedule.endAt < to ? schedule.endAt : to;
  const [hours, minutes] = splitTime(schedule.timeOfDay);
  const start = alignStart(schedule, atTime(schedule.startAt, hours, minutes));
  if (start > end) return occurrences;

  const push = (date: Date, index: number) => {
    if (date < from || date > end) return;
    const number =
      schedule.startNumber != null ? schedule.startNumber + index * schedule.increment : null;
    occurrences.push({
      scheduleId: schedule.id,
      workId: schedule.workId,
      label: schedule.label,
      number,
      releaseAt: date,
    });
  };

  if (schedule.frequency === 'once') {
    push(start, 0);
    return occurrences;
  }

  // Borne de sécurité : une récurrence quotidienne sur une fenêtre large ne
  // doit pas pouvoir produire des dizaines de milliers de lignes.
  const MAX_OCCURRENCES = 400;

  for (let index = 0; index < MAX_OCCURRENCES; index += 1) {
    const date = occurrenceAt(schedule.frequency, start, index, hours, minutes);
    if (date > end) break;
    push(date, index);
  }

  return occurrences;
}

/**
 * Cale la première occurrence sur le jour déclaré. `startAt` dit *à partir de
 * quand* la récurrence court, `weekday` / `dayOfMonth` disent *quel jour* elle
 * tombe : sans ce recalage, « chaque mardi » saisi un jeudi donnait des jeudis.
 */
function alignStart(schedule: ReleaseScheduleRow, start: Date): Date {
  if (schedule.frequency === 'weekly' && schedule.weekday != null) {
    const shift = (schedule.weekday - start.getDay() + 7) % 7;
    return new Date(start.getTime() + shift * 86_400_000);
  }

  if (schedule.frequency === 'monthly' && schedule.dayOfMonth != null) {
    const aligned = new Date(start);
    const lastDay = new Date(aligned.getFullYear(), aligned.getMonth() + 1, 0).getDate();
    aligned.setDate(Math.min(schedule.dayOfMonth, lastDay));
    // Le jour visé est déjà passé ce mois-ci : la série commence le mois suivant.
    if (aligned < start) {
      aligned.setDate(1);
      aligned.setMonth(aligned.getMonth() + 1);
      const nextLastDay = new Date(aligned.getFullYear(), aligned.getMonth() + 1, 0).getDate();
      aligned.setDate(Math.min(schedule.dayOfMonth, nextLastDay));
    }
    return aligned;
  }

  return start;
}

function occurrenceAt(
  frequency: ScheduleFrequency,
  start: Date,
  index: number,
  hours: number,
  minutes: number,
): Date {
  if (frequency === 'daily') {
    return new Date(start.getTime() + index * 86_400_000);
  }
  if (frequency === 'weekly') {
    return new Date(start.getTime() + index * 7 * 86_400_000);
  }

  // Mensuel : on avance de mois en mois plutôt qu'en millisecondes, et on
  // ramène au dernier jour disponible — un 31 saisi ne doit pas déborder sur
  // le 3 mars quand février n'a que 28 jours.
  const target = new Date(start);
  const day = target.getDate();
  target.setDate(1);
  target.setMonth(target.getMonth() + index);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return atTime(target, hours, minutes);
}

function atTime(date: Date, hours: number, minutes: number): Date {
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

function splitTime(value: string): [number, number] {
  const [hours, minutes] = value.split(':');
  return [Number(hours ?? 12), Number(minutes ?? 0)];
}

/* -------------------------------------------------------------------------
 * Pré-remplissage depuis les sources externes
 * ---------------------------------------------------------------------- */

const DAY_MS = 86_400_000;

/**
 * Propose une récurrence toute faite pour une œuvre, du plus fiable au plus
 * approximatif : la grille annoncée par une API, la cadence déduite des unités
 * déjà publiées (seul recours pour les scans), puis un hebdomadaire par défaut.
 */
export async function suggestSchedule(workId: string): Promise<ScheduleSuggestion> {
  const [work] = await db
    .select({
      id: works.id,
      kind: works.kind,
      nextReleaseAt: works.nextReleaseAt,
      nextReleaseNumber: works.nextReleaseNumber,
    })
    .from(works)
    .where(eq(works.id, workId))
    .limit(1);

  if (!work) throw notFound('Œuvre');

  const upcoming = await fetchUpcoming(workId, work.kind);

  // Deux dates annoncées suffisent à mesurer l'intervalle réel.
  if (upcoming.length >= 2) {
    const first = new Date(upcoming[0]!.airingAt);
    const gapDays = Math.round(
      (new Date(upcoming[1]!.airingAt).getTime() - first.getTime()) / DAY_MS,
    );
    const rhythm = rhythmFor(gapDays, first);
    if (rhythm) {
      return {
        ...rhythm,
        startAt: first.toISOString(),
        startNumber: upcoming[0]!.number || null,
        increment: 1,
        reason: `Grille de diffusion annoncée : ${describe(rhythm.frequency, gapDays)}.`,
        basis: 'provider',
      };
    }
  }

  // Une seule date annoncée : on la prend comme point de départ, avec le rythme
  // usuel de la famille d'œuvre.
  const announced = upcoming[0]
    ? { at: new Date(upcoming[0].airingAt), number: upcoming[0].number || null }
    : work.nextReleaseAt
      ? { at: work.nextReleaseAt, number: work.nextReleaseNumber }
      : null;

  if (announced) {
    return {
      frequency: 'weekly',
      weekday: announced.at.getDay(),
      dayOfMonth: null,
      timeOfDay: formatTime(announced.at),
      startAt: announced.at.toISOString(),
      startNumber: announced.number,
      increment: 1,
      reason: 'Prochaine sortie annoncée par une source ; rythme hebdomadaire supposé.',
      basis: 'provider',
    };
  }

  const inferred = await inferFromUnits(workId);
  if (inferred) return inferred;

  const now = new Date();
  return {
    frequency: 'weekly',
    weekday: now.getDay(),
    dayOfMonth: null,
    timeOfDay: '12:00',
    startAt: now.toISOString(),
    startNumber: null,
    increment: 1,
    reason: "Aucune date connue pour cette œuvre : à vous de saisir le rythme.",
    basis: 'default',
  };
}

/** Interroge les sources rattachées à l'œuvre pour leur grille de sorties. */
async function fetchUpcoming(
  workId: string,
  kind: 'manga' | 'anime' | 'tv' | 'movie',
): Promise<{ number: number; airingAt: string }[]> {
  const externals = await db
    .select({ provider: externalIds.provider, providerId: externalIds.providerId })
    .from(externalIds)
    .where(eq(externalIds.workId, workId));

  for (const external of externals) {
    const provider = registry.get(external.provider);
    if (!provider?.enabled || !provider.upcoming) continue;
    try {
      const releases = await provider.upcoming(external.providerId, kind);
      if (releases.length > 0) {
        return [...releases].sort((a, b) => a.airingAt.localeCompare(b.airingAt));
      }
    } catch (error) {
      // Une source muette n'empêche pas la proposition : on passe à la suivante.
      logger.debug('grille de sorties indisponible', {
        provider: external.provider,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return [];
}

/**
 * Déduit la cadence des dernières unités publiées. Médiane plutôt que moyenne :
 * une pause au milieu d'une série hebdomadaire ne doit pas la rendre bimensuelle.
 */
async function inferFromUnits(workId: string): Promise<ScheduleSuggestion | null> {
  const rows = await db
    .select({ number: units.number, publishedAt: units.publishedAt })
    .from(units)
    .where(eq(units.workId, workId))
    .orderBy(asc(units.publishedAt));

  const published = rows.filter(
    (row): row is { number: number | null; publishedAt: Date } => row.publishedAt != null,
  );
  const recent = published.slice(-8);
  if (recent.length < 3) return null;

  const gaps: number[] = [];
  for (let index = 1; index < recent.length; index += 1) {
    const gap =
      (recent[index]!.publishedAt.getTime() - recent[index - 1]!.publishedAt.getTime()) / DAY_MS;
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return null;

  gaps.sort((a, b) => a - b);
  const median = Math.round(gaps[Math.floor(gaps.length / 2)]!);

  const last = recent[recent.length - 1]!;
  const next = new Date(last.publishedAt.getTime() + median * DAY_MS);
  const rhythm = rhythmFor(median, next);
  if (!rhythm) return null;

  return {
    ...rhythm,
    startAt: next.toISOString(),
    startNumber: last.number != null ? last.number + 1 : null,
    increment: 1,
    reason: `Cadence déduite des ${recent.length} dernières sorties : ${describe(rhythm.frequency, median)}.`,
    basis: 'inferred',
  };
}

/** Traduit un intervalle en jours vers la fréquence la plus proche. */
function rhythmFor(
  gapDays: number,
  reference: Date,
): Pick<ScheduleSuggestion, 'frequency' | 'weekday' | 'dayOfMonth' | 'timeOfDay'> | null {
  const timeOfDay = formatTime(reference);
  if (gapDays <= 0) return null;
  if (gapDays <= 2) {
    return { frequency: 'daily', weekday: null, dayOfMonth: null, timeOfDay };
  }
  if (gapDays <= 10) {
    return { frequency: 'weekly', weekday: reference.getDay(), dayOfMonth: null, timeOfDay };
  }
  if (gapDays <= 45) {
    return { frequency: 'monthly', weekday: null, dayOfMonth: reference.getDate(), timeOfDay };
  }
  return { frequency: 'once', weekday: null, dayOfMonth: null, timeOfDay };
}

function describe(frequency: ScheduleFrequency, gapDays: number): string {
  switch (frequency) {
    case 'daily':
      return 'tous les jours';
    case 'weekly':
      return 'toutes les semaines';
    case 'monthly':
      return 'tous les mois';
    default:
      return `environ tous les ${gapDays} jours`;
  }
}

function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function toDto(row: ReleaseScheduleRow, work: WorkSummary | null): ReleaseSchedule {
  return {
    id: row.id,
    workId: row.workId,
    work,
    label: row.label,
    frequency: row.frequency,
    weekday: row.weekday,
    dayOfMonth: row.dayOfMonth,
    timeOfDay: row.timeOfDay,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt?.toISOString() ?? null,
    startNumber: row.startNumber,
    increment: row.increment,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
