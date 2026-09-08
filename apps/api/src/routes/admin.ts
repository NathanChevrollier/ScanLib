import { Hono } from 'hono';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { updateUserInputSchema } from '@scanlib/shared';
import { db } from '../db/client.js';
import { invites, users } from '../db/schema.js';
import type { AppEnv } from '../lib/context.js';
import { requireAdmin, requireAuth } from '../lib/context.js';
import { AppError, notFound } from '../lib/errors.js';
import { parseBody } from '../lib/validate.js';
import { JOB_HANDLERS, JOB_NAMES, type JobName } from '../jobs/handlers.js';
import { runJob } from '../jobs/run.js';
import { createRecoveryCode } from '../services/users.js';

/**
 * Administration de l'instance.
 *
 * Jusqu'ici, l'administrateur pouvait créer une invitation sans jamais voir
 * celles en cours, ni la liste des comptes, ni l'état des tâches de fond. Tout
 * était en base sans être exposé.
 */
export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use('*', requireAuth, requireAdmin);

/** Vue d'ensemble : comptes, invitations, dernières exécutions des tâches. */
adminRoutes.get('/overview', async (c) => {
  const [userRows, inviteRows, jobRows] = await Promise.all([
    db.execute<{
      id: string;
      email: string;
      display_name: string;
      role: 'admin' | 'user';
      disabled_at: Date | null;
      last_login_at: Date | null;
      created_at: Date;
      works_count: number;
      sessions_count: number;
    }>(sql`
      select u.id, u.email, u.display_name, u.role, u.disabled_at, u.last_login_at, u.created_at,
             (select count(*)::int from library_entries e where e.user_id = u.id) as works_count,
             (select count(*)::int from sessions s
              where s.user_id = u.id and s.revoked_at is null and s.expires_at > now()) as sessions_count
      from users u
      order by u.created_at asc
    `),
    db
      .select()
      .from(invites)
      .orderBy(desc(invites.createdAt))
      .limit(50),
    // Une ligne par tâche : la dernière exécution connue.
    db.execute<{
      job: string;
      started_at: Date;
      finished_at: Date | null;
      success: boolean | null;
      duration_ms: number | null;
      result: Record<string, unknown> | null;
      error: string | null;
    }>(sql`
      select distinct on (job) job, started_at, finished_at, success, duration_ms, result, error
      from job_runs
      order by job, started_at desc
    `),
  ]);

  return c.json({
    users: userRows.rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      disabled: row.disabled_at != null,
      lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
      worksCount: row.works_count,
      sessionsCount: row.sessions_count,
    })),
    invites: inviteRows.map((row) => ({
      code: row.code,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      usedBy: row.usedBy,
      usedAt: row.usedAt?.toISOString() ?? null,
    })),
    jobs: jobRows.rows.map((row) => ({
      job: row.job,
      startedAt: new Date(row.started_at).toISOString(),
      finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
      success: row.success,
      durationMs: row.duration_ms,
      result: row.result,
      error: row.error,
    })),
  });
});

/** Change le rôle d'un compte ou le suspend. */
adminRoutes.patch('/users/:id', async (c) => {
  const input = await parseBody(c, updateUserInputSchema);
  const targetId = c.req.param('id');
  const current = c.get('user');

  const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (input.role !== undefined) patch.role = input.role;
  if (input.disabled !== undefined) patch.disabledAt = input.disabled ? new Date() : null;

  // Garde-fou : se retirer soi-même les droits ou se suspendre laisserait
  // potentiellement l'instance sans administrateur actif.
  if (targetId === current.id && (input.role === 'user' || input.disabled === true)) {
    throw new AppError(
      'self_lockout',
      'Vous ne pouvez pas retirer vos propres droits ni suspendre votre compte.',
      400,
    );
  }

  const [updated] = await db.update(users).set(patch).where(eq(users.id, targetId)).returning();
  if (!updated) throw notFound('Utilisateur');

  return c.json({ ok: true });
});

/** Génère un code de secours pour un compte qui a perdu son mot de passe. */
adminRoutes.post('/users/:id/recovery', async (c) => {
  const recovery = await createRecoveryCode(c.req.param('id'), c.get('user').id);
  return c.json({ code: recovery.code, expiresAt: recovery.expiresAt.toISOString() }, 201);
});

/** Annule une invitation non utilisée. */
adminRoutes.delete('/invites/:code', async (c) => {
  const deleted = await db
    .delete(invites)
    .where(and(eq(invites.code, c.req.param('code')), isNull(invites.usedBy)))
    .returning({ code: invites.code });

  if (deleted.length === 0) throw notFound('Invitation utilisable');
  return c.json({ ok: true });
});

/** Déclenche une tâche de fond sans attendre sa planification. */
adminRoutes.post('/jobs/:job/run', async (c) => {
  const job = c.req.param('job') as JobName;
  if (!JOB_NAMES.includes(job)) throw notFound('Tâche');

  // Exécution en arrière-plan : certaines tâches durent plusieurs minutes et la
  // requête ne doit pas rester ouverte le temps qu'elles finissent.
  void runJob(job, JOB_HANDLERS[job]);
  return c.json({ started: job }, 202);
});
