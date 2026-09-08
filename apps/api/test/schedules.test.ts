import { describe, expect, it } from 'vitest';
import { expandSchedule } from '../src/services/schedules.js';
import type { ReleaseScheduleRow } from '../src/db/schema.js';

/**
 * Le déroulé des récurrences est la seule logique du calendrier qui ne se
 * vérifie pas à l'œil : une erreur d'un jour ou un numéro d'épisode décalé
 * passe inaperçu jusqu'à ce qu'un utilisateur rate une sortie. Ces cas sont
 * purs — aucune base n'est nécessaire.
 */
function schedule(overrides: Partial<ReleaseScheduleRow> = {}): ReleaseScheduleRow {
  return {
    id: 'schedule-1',
    userId: 'user-1',
    workId: 'work-1',
    label: null,
    frequency: 'weekly',
    weekday: null,
    dayOfMonth: null,
    timeOfDay: '17:00',
    startAt: new Date(2026, 0, 1, 0, 0, 0),
    endAt: null,
    startNumber: null,
    increment: 1,
    note: null,
    createdAt: new Date(2026, 0, 1),
    updatedAt: new Date(2026, 0, 1),
    ...overrides,
  };
}

const days = (occurrences: { releaseAt: Date }[]) =>
  occurrences.map((occurrence) => occurrence.releaseAt.toISOString().slice(0, 10));

describe('expandSchedule', () => {
  it("cale la première occurrence sur le jour de la semaine déclaré", () => {
    // 1er janvier 2026 est un jeudi ; on demande le mardi.
    const occurrences = expandSchedule(
      schedule({ frequency: 'weekly', weekday: 2, startAt: new Date(2026, 0, 1) }),
      new Date(2026, 0, 1),
      new Date(2026, 0, 31),
    );

    expect(occurrences.length).toBeGreaterThan(0);
    for (const occurrence of occurrences) {
      expect(occurrence.releaseAt.getDay()).toBe(2);
    }
    expect(occurrences[0]!.releaseAt.getDate()).toBe(6);
  });

  it('respecte l’heure de sortie déclarée', () => {
    const [first] = expandSchedule(
      schedule({ frequency: 'daily', timeOfDay: '09:30' }),
      new Date(2026, 0, 1),
      new Date(2026, 0, 3),
    );

    expect(first!.releaseAt.getHours()).toBe(9);
    expect(first!.releaseAt.getMinutes()).toBe(30);
  });

  it('incrémente le numéro d’unité à chaque occurrence', () => {
    const occurrences = expandSchedule(
      schedule({ frequency: 'weekly', weekday: 4, startNumber: 12, increment: 1 }),
      new Date(2026, 0, 1),
      // Le 22 à 23 h 59 : la fenêtre doit englober l'heure de sortie (17 h),
      // pas seulement le début de la journée.
      new Date(2026, 0, 22, 23, 59),
    );

    expect(occurrences.map((occurrence) => occurrence.number)).toEqual([12, 13, 14, 15]);
  });

  it('ramène un 31 au dernier jour des mois plus courts', () => {
    const occurrences = expandSchedule(
      schedule({ frequency: 'monthly', dayOfMonth: 31, startAt: new Date(2026, 0, 1) }),
      new Date(2026, 0, 1),
      new Date(2026, 3, 1),
    );

    // Janvier 31, février 28 (2026 n'est pas bissextile), mars 31.
    expect(days(occurrences)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('ne produit rien hors de la fenêtre demandée', () => {
    const occurrences = expandSchedule(
      schedule({ frequency: 'once', startAt: new Date(2026, 5, 1) }),
      new Date(2026, 0, 1),
      new Date(2026, 0, 31),
    );

    expect(occurrences).toEqual([]);
  });

  it('s’arrête à la date de fin', () => {
    const occurrences = expandSchedule(
      schedule({
        frequency: 'daily',
        startAt: new Date(2026, 0, 1),
        endAt: new Date(2026, 0, 4, 23, 59),
      }),
      new Date(2026, 0, 1),
      new Date(2026, 0, 31),
    );

    expect(days(occurrences)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
  });
});
