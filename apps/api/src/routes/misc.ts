import { Hono } from 'hono';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  pushSubscriptionInputSchema,
  releaseScheduleInputSchema,
  releaseScheduleUpdateSchema,
  updatePreferencesInputSchema,
} from '@scanlib/shared';
import { db } from '../db/client.js';
import { notifications } from '../db/schema.js';
import type { AppEnv } from '../lib/context.js';
import { requireAuth } from '../lib/context.js';
import { AppError } from '../lib/errors.js';
import { registry } from '../lib/providers.js';
import { parseBody } from '../lib/validate.js';
import { getCalendar } from '../services/calendar.js';
import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  suggestSchedule,
  updateSchedule,
} from '../services/schedules.js';
import { getQueues, getRecommendations } from '../services/queue.js';
import { computeStats } from '../services/stats.js';
import {
  isPushConfigured,
  publicKey,
  removeSubscription,
  saveSubscription,
} from '../services/push.js';
import { toPublicUser, updatePreferences } from '../services/users.js';

export const miscRoutes = new Hono<AppEnv>();

miscRoutes.use('*', requireAuth);

/** Agenda des sorties. Fenêtre par défaut : deux semaines autour d'aujourd'hui. */
miscRoutes.get('/calendar', async (c) => {
  const fromParam = c.req.query('from');
  const toParam = c.req.query('to');
  const from = fromParam ? new Date(fromParam) : new Date(Date.now() - 7 * 86_400_000);
  const to = toParam ? new Date(toParam) : new Date(Date.now() + 21 * 86_400_000);
  return c.json(await getCalendar(c.get('user').id, from, to));
});

/* --- Récurrences de sortie ------------------------------------------------ */

miscRoutes.get('/calendar/schedules', async (c) =>
  c.json({ schedules: await listSchedules(c.get('user').id) }),
);

/**
 * Séparé de la création : la proposition interroge des sources externes et peut
 * être lente, alors que l'enregistrement doit rester immédiat.
 */
miscRoutes.get('/calendar/schedules/suggest', async (c) => {
  const workId = c.req.query('workId');
  if (!workId) {
    throw new AppError('validation_error', 'Indiquez une œuvre pour obtenir une proposition.');
  }
  return c.json({ suggestion: await suggestSchedule(workId) });
});

miscRoutes.post('/calendar/schedules', async (c) => {
  const input = await parseBody(c, releaseScheduleInputSchema);
  return c.json({ schedule: await createSchedule(c.get('user').id, input) }, 201);
});

miscRoutes.patch('/calendar/schedules/:id', async (c) => {
  const input = await parseBody(c, releaseScheduleUpdateSchema);
  const schedule = await updateSchedule(c.get('user').id, c.req.param('id'), input);
  return c.json({ schedule });
});

miscRoutes.delete('/calendar/schedules/:id', async (c) => {
  await deleteSchedule(c.get('user').id, c.req.param('id'));
  return c.json({ ok: true });
});

miscRoutes.get('/stats', async (c) => c.json(await computeStats(c.get('user').id)));

miscRoutes.get('/queue', async (c) => c.json(await getQueues(c.get('user').id)));

miscRoutes.get('/recommendations', async (c) =>
  c.json({ recommendations: await getRecommendations(c.get('user').id) }),
);

/* --- Notifications ------------------------------------------------------ */

miscRoutes.get('/notifications', async (c) => {
  const userId = c.get('user').id;
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(50);

  const [unread] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));

  return c.json({
    notifications: rows.map((row) => ({
      id: row.id,
      type: row.type,
      workId: row.workId,
      title: row.title,
      body: row.body,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
    unread: unread?.count ?? 0,
  });
});

miscRoutes.post('/notifications/read', async (c) => {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, c.get('user').id), isNull(notifications.readAt)));
  return c.json({ ok: true });
});

/* --- Notifications poussées ---------------------------------------------- */

/** Clé publique VAPID : le navigateur en a besoin pour s'abonner. */
miscRoutes.get('/push/key', (c) =>
  c.json({ enabled: isPushConfigured(), publicKey: publicKey() }),
);

miscRoutes.post('/push/subscribe', async (c) => {
  const input = await parseBody(c, pushSubscriptionInputSchema);
  await saveSubscription(c.get('user').id, input, c.req.header('user-agent'));
  return c.json({ ok: true }, 201);
});

miscRoutes.post('/push/unsubscribe', async (c) => {
  const input = await parseBody(c, z.object({ endpoint: z.string() }));
  await removeSubscription(input.endpoint);
  return c.json({ ok: true });
});

/* --- Préférences et diagnostic ------------------------------------------ */

miscRoutes.patch('/preferences', async (c) => {
  const input = await parseBody(c, updatePreferencesInputSchema);
  const preferences = await updatePreferences(c.get('user').id, input);
  return c.json({ preferences });
});

/**
 * État des sources externes. Affiché dans les Réglages : quand AniList ou une
 * autre API tombe, l'utilisateur voit pourquoi certains résultats manquent.
 */
miscRoutes.get('/health/providers', async (c) => {
  const reports = await registry.health();
  return c.json({
    providers: reports.map((report) => ({
      provider: report.provider,
      status: report.status,
      message: report.message,
      checkedAt: report.checkedAt.toISOString(),
    })),
  });
});

/** Export complet de la bibliothèque, pour sauvegarde ou migration. */
miscRoutes.get('/export', async (c) => {
  const user = c.get('user');
  const rows = await db.execute<{
    kind: string;
    title: string;
    status: string;
    score: number | null;
    progress: number | null;
    tags: string[];
    notes: string | null;
    externals: { provider: string; provider_id: string }[];
    completed_units: number;
  }>(sql`
    select
      w.kind, w.title, e.status, e.score, e.progress, e.tags, e.notes,
      coalesce(
        (select json_agg(json_build_object('provider', x.provider, 'provider_id', x.provider_id))
         from external_ids x where x.work_id = w.id),
        '[]'::json
      ) as externals,
      (select count(*)::int from unit_progress p
       where p.user_id = e.user_id and p.work_id = w.id) as completed_units
    from library_entries e
    join works w on w.id = e.work_id
    where e.user_id = ${user.id}
    order by w.title
  `);

  return c.json({
    exportedAt: new Date().toISOString(),
    user: toPublicUser(user),
    entries: rows.rows,
  });
});
