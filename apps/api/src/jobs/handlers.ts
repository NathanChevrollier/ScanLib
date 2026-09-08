import { and, eq, inArray, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { PostgresCache } from '../db/cache.js';
import { invites, libraryEntries, notifications, officialLinks, users, works } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { registry } from '../lib/providers.js';
import { PLATFORMS, platformUrl } from '@scanlib/providers';
import { pruneJobRuns } from './run.js';
import { pruneLoginAttempts } from '../services/auth-guard.js';
import { pruneSessions } from '../services/users.js';
import { sendPushToUsers } from '../services/push.js';
import { externalsOf, refreshWork, syncLinks, syncUnits } from '../services/works.js';

export const JOB_NAMES = [
  'refresh-metadata',
  'detect-new-units',
  'refresh-links',
  'airing-calendar',
  'verify-platforms',
  'maintenance',
] as const;

export type JobName = (typeof JOB_NAMES)[number];

/** Pause entre deux œuvres : les API publiques sont limitées en débit. */
const PACE_MS = 250;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Période au bout de laquelle une œuvre mérite d'être réinterrogée, selon son
 * statut de publication.
 *
 * Une série terminée depuis dix ans ne change plus : la réinterroger toutes les
 * six heures gaspillait l'essentiel des appels et des quotas. Une série en
 * cours, elle, peut publier un chapitre à tout moment.
 */
const REFRESH_INTERVAL_HOURS: Record<string, number> = {
  ongoing: 6,
  upcoming: 24,
  hiatus: 24 * 7,
  unknown: 24 * 3,
  finished: 24 * 30,
  cancelled: 24 * 90,
};

/**
 * Œuvres suivies dont les données méritent d'être rafraîchies maintenant.
 *
 * Le tri place les plus anciennement vues en tête : sur une grande
 * bibliothèque, chaque passage traite ce qui en a le plus besoin sans jamais
 * bloquer sur les mêmes séries.
 */
async function worksDueForRefresh(
  column: 'refreshed_at' | 'units_refreshed_at' | 'links_refreshed_at',
  limit = 400,
): Promise<{ id: string; kind: string }[]> {
  const cases = Object.entries(REFRESH_INTERVAL_HOURS)
    .map(([status, hours]) => `when '${status}' then interval '${hours} hours'`)
    .join(' ');

  const rows = await db.execute<{ id: string; kind: string }>(sql`
    select distinct w.id, w.kind
    from works w
    join library_entries e on e.work_id = w.id and e.status <> 'dropped'
    where w.${sql.raw(column)} is null
       or w.${sql.raw(column)} < now() - (case w.release_status ${sql.raw(cases)}
            else interval '3 days' end)
    order by w.${sql.raw(column)} asc nulls first
    limit ${limit}
  `);

  return rows.rows;
}

/* -------------------------------------------------------------------------
 * Rafraîchissement des métadonnées
 * ---------------------------------------------------------------------- */

export async function runRefreshMetadata(): Promise<{ traitees: number; ignorees: number }> {
  const works = await worksDueForRefresh('refreshed_at');
  let traitees = 0;
  let ignorees = 0;

  for (const work of works) {
    try {
      await refreshWork(work.id);
      traitees += 1;
    } catch (error) {
      ignorees += 1;
      logger.warn('refresh-metadata : œuvre ignorée', {
        workId: work.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await sleep(PACE_MS);
  }

  return { traitees, ignorees };
}

/* -------------------------------------------------------------------------
 * Détection des nouveaux chapitres / épisodes
 * ---------------------------------------------------------------------- */

/**
 * Cœur de la promesse « savoir quand la suite est sortie » : on resynchronise
 * les unités des œuvres suivies, et toute nouveauté lève le badge sur les
 * entrées concernées et crée une notification.
 */
export async function runDetectNewUnits(): Promise<{
  examinees: number;
  oeuvresAvecNouveautes: number;
  nouvellesUnites: number;
}> {
  const works = await worksDueForRefresh('units_refreshed_at');
  let nouvellesUnites = 0;
  let oeuvresAvecNouveautes = 0;

  for (const work of works) {
    try {
      const { inserted } = await syncUnits(work.id, { languages: config.DEFAULT_LANGUAGES });
      if (inserted > 0) {
        nouvellesUnites += inserted;
        oeuvresAvecNouveautes += 1;
        await announceNewUnits(work.id, inserted);
      }
    } catch (error) {
      logger.warn('detect-new-units : œuvre ignorée', {
        workId: work.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await sleep(PACE_MS);
  }

  return { examinees: works.length, oeuvresAvecNouveautes, nouvellesUnites };
}

async function announceNewUnits(workId: string, count: number): Promise<void> {
  const [work] = await db
    .select({ title: works.title, kind: works.kind })
    .from(works)
    .where(eq(works.id, workId))
    .limit(1);
  if (!work) return;

  const entries = await db
    .select({ userId: libraryEntries.userId })
    .from(libraryEntries)
    .where(
      and(
        eq(libraryEntries.workId, workId),
        sql`${libraryEntries.status} in ('planned', 'in_progress', 'on_hold', 'revisiting')`,
      ),
    );
  if (entries.length === 0) return;

  await db
    .update(libraryEntries)
    .set({ hasNewUnits: true })
    .where(
      and(
        eq(libraryEntries.workId, workId),
        inArray(
          libraryEntries.userId,
          entries.map((entry) => entry.userId),
        ),
      ),
    );

  const label = work.kind === 'manga' ? 'chapitre' : 'épisode';
  const body =
    count > 1 ? `${count} nouveaux ${label}s disponibles` : `Un nouveau ${label} est disponible`;

  await db.insert(notifications).values(
    entries.map((entry) => ({
      userId: entry.userId,
      type: 'new_unit' as const,
      workId,
      title: work.title,
      body,
    })),
  );

  // Une notification qui n'existe que dans l'application demande d'ouvrir
  // l'application pour être vue : l'envoi poussé est ce qui rend la détection
  // réellement utile.
  await sendPushToUsers(
    entries.map((entry) => entry.userId),
    { title: work.title, body, url: `/work/${workId}` },
  );
}

/* -------------------------------------------------------------------------
 * Liens officiels
 * ---------------------------------------------------------------------- */

/**
 * Recalcule les liens puis vérifie ceux qui pointent directement vers l'œuvre.
 * Les URLs de recherche ne sont pas testées : elles répondent toujours, même
 * quand la plateforme n'a pas le titre.
 */
export async function runRefreshLinks(): Promise<{ refreshed: number; broken: number }> {
  const works = await worksDueForRefresh('links_refreshed_at');
  let refreshed = 0;

  for (const { id: workId } of works) {
    try {
      await syncLinks(workId, {
        languages: config.DEFAULT_LANGUAGES,
        regions: config.DEFAULT_WATCH_REGIONS,
        ownedPlatforms: [],
      });
      refreshed += 1;
    } catch (error) {
      logger.warn('refresh-links : œuvre ignorée', {
        workId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await sleep(PACE_MS);
  }

  const broken = await validateExactLinks();
  logger.info('refresh-links terminé', { refreshed, broken });
  return { refreshed, broken };
}

async function validateExactLinks(): Promise<number> {
  const candidates = await db
    .select({ id: officialLinks.id, url: officialLinks.url })
    .from(officialLinks)
    .where(
      and(
        eq(officialLinks.confidence, 'exact'),
        sql`${officialLinks.brokenAt} is null`,
        sql`${officialLinks.checkedAt} < now() - interval '7 days'`,
      ),
    )
    .limit(300);

  let broken = 0;

  for (const link of candidates) {
    try {
      const response = await fetch(link.url, {
        method: 'HEAD',
        redirect: 'follow',
        headers: { 'User-Agent': config.PROVIDER_USER_AGENT },
        signal: AbortSignal.timeout(8000),
      });
      // Seules les disparitions franches comptent : beaucoup de sites répondent
      // 403 aux robots tout en restant parfaitement accessibles à un navigateur.
      if (response.status === 404 || response.status === 410) {
        await db
          .update(officialLinks)
          .set({ brokenAt: new Date() })
          .where(eq(officialLinks.id, link.id));
        broken += 1;
      } else {
        await db
          .update(officialLinks)
          .set({ checkedAt: new Date() })
          .where(eq(officialLinks.id, link.id));
      }
    } catch {
      // Timeout ou DNS : on ne conclut rien, le lien sera retesté la semaine suivante.
    }
    await sleep(100);
  }

  return broken;
}

/* -------------------------------------------------------------------------
 * Calendrier de diffusion
 * ---------------------------------------------------------------------- */

export async function runAiringCalendar(): Promise<{ updated: number }> {
  const rows = await db
    .select({ id: works.id, kind: works.kind })
    .from(works)
    .where(sql`${works.releaseStatus} in ('ongoing', 'upcoming')`);

  let updated = 0;

  for (const work of rows) {
    const externals = await externalsOf(work.id);
    for (const external of externals) {
      const provider = registry.get(external.provider);
      if (!provider?.enabled || !provider.schedule) continue;
      try {
        const next = await provider.schedule(external.providerId, work.kind);
        if (!next) continue;
        await db
          .update(works)
          .set({
            nextReleaseNumber: next.number,
            nextReleaseAt: new Date(next.airingAt),
          })
          .where(eq(works.id, work.id));
        updated += 1;
        break;
      } catch (error) {
        logger.debug('airing-calendar : source ignorée', {
          workId: work.id,
          provider: external.provider,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    await sleep(PACE_MS);
  }

  logger.info('airing-calendar terminé', { updated });
  return { updated };
}

/* -------------------------------------------------------------------------
 * Entretien
 * ---------------------------------------------------------------------- */

/**
 * Vérifie que les URLs de recherche du registre mènent toujours quelque part.
 *
 * Les plateformes changent le format de leurs adresses sans prévenir : sans ce
 * contrôle, l'application continuerait à proposer des liens morts — exactement
 * le défaut qu'on vient de corriger à la main. Toute rupture remonte comme
 * notification aux administrateurs.
 */
export async function runVerifyPlatforms(): Promise<{ testees: number; cassees: string[] }> {
  const cassees: string[] = [];
  let testees = 0;

  for (const platform of PLATFORMS) {
    const target = platformUrl(platform, 'One Piece');
    if (!target) continue;
    testees += 1;

    try {
      const response = await fetch(target.url, {
        redirect: 'follow',
        headers: { 'User-Agent': config.PROVIDER_USER_AGENT },
        signal: AbortSignal.timeout(15_000),
      });
      // Seules les disparitions franches comptent : beaucoup de sites répondent
      // 403 aux robots tout en fonctionnant dans un navigateur.
      if (response.status === 404 || response.status === 410) cassees.push(platform.id);
    } catch {
      // Timeout ou DNS : indécidable, on ne conclut pas.
    }
    await sleep(200);
  }

  if (cassees.length > 0) {
    const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin'));
    if (admins.length > 0) {
      await db.insert(notifications).values(
        admins.map((admin) => ({
          userId: admin.id,
          type: 'system' as const,
          title: 'Liens de plateformes à corriger',
          body: `Ces plateformes ne répondent plus : ${cassees.join(', ')}. Lancez « npm run links:verify » pour le détail.`,
        })),
      );
    }
    logger.warn('plateformes cassées', { cassees });
  }

  return { testees, cassees };
}

/**
 * Entretien : cache expiré, sessions mortes, compteurs de connexion, historique
 * des tâches. Regroupé en une seule tâche nocturne — ce sont toutes des
 * suppressions de lignes devenues inutiles.
 */
export async function runMaintenance(): Promise<{
  cacheSupprime: number;
  sessionsSupprimees: number;
  compteursSupprimes: number;
  executionsSupprimees: number;
  invitationsSupprimees: number;
}> {
  const cacheSupprime = await new PostgresCache().prune();
  const sessionsSupprimees = await pruneSessions();
  const compteursSupprimes = await pruneLoginAttempts();
  const executionsSupprimees = await pruneJobRuns();

  // Invitations expirées et jamais utilisées : elles ne servent plus à rien.
  const invitations = await db
    .delete(invites)
    .where(sql`${invites.usedBy} is null and ${invites.expiresAt} < now()`)
    .returning({ code: invites.code });

  return {
    cacheSupprime,
    sessionsSupprimees,
    compteursSupprimes,
    executionsSupprimees,
    invitationsSupprimees: invitations.length,
  };
}

export const JOB_HANDLERS: Record<JobName, () => Promise<unknown>> = {
  'refresh-metadata': runRefreshMetadata,
  'detect-new-units': runDetectNewUnits,
  'refresh-links': runRefreshLinks,
  'airing-calendar': runAiringCalendar,
  'verify-platforms': runVerifyPlatforms,
  maintenance: runMaintenance,
};
