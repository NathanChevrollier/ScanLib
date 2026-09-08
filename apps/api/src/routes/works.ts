import { Hono } from 'hono';
import type { ProviderId } from '@scanlib/shared';
import { attachSourceInputSchema, searchQuerySchema } from '@scanlib/shared';
import type { AppEnv } from '../lib/context.js';
import { requireAuth } from '../lib/context.js';
import { AppError } from '../lib/errors.js';
import { parseBody, parseQuery } from '../lib/validate.js';
import { clearNewUnitsFlag, getEntry, toEntry } from '../services/library.js';
import { completedUnitIds } from '../services/progress.js';
import { search } from '../services/search.js';
import {
  attachExternals,
  detachExternal,
  externalsOf,
  getWork,
  listLinks,
  listUnits,
  refreshWork,
  syncLinks,
  syncUnits,
  toDetails,
} from '../services/works.js';
import { TMDB_ATTRIBUTION, withCustomPlatforms } from '@scanlib/providers';

export const workRoutes = new Hono<AppEnv>();

workRoutes.use('*', requireAuth);

/** Recherche multi-sources. */
workRoutes.get('/search', async (c) => {
  const query = parseQuery(c, searchQuerySchema, ['kinds']);
  return c.json(await search(c.get('user').id, query));
});

workRoutes.get('/:workId', async (c) => {
  const user = c.get('user');
  const workId = c.req.param('workId');

  const row = await getWork(workId);
  const externals = await externalsOf(workId);
  const entry = await getEntry(user.id, workId);

  // Ouvrir la fiche vaut prise de connaissance des nouveautés.
  if (entry?.hasNewUnits) await clearNewUnitsFlag(user.id, workId);

  return c.json({
    work: toDetails(row, externals),
    entry: entry ? toEntry(entry) : null,
  });
});

/**
 * Détache une source d'une œuvre.
 *
 * Le rapprochement automatique se trompe forcément de temps en temps : deux
 * éditions fusionnées à tort, ou une source qui décrit en réalité une autre
 * série. Sans ce geste, l'erreur était définitive.
 */
workRoutes.delete('/:workId/sources/:provider', async (c) => {
  const workId = c.req.param('workId');
  const provider = c.req.param('provider') as ProviderId;

  const remaining = await externalsOf(workId);
  if (remaining.length <= 1) {
    throw new AppError(
      'last_source',
      'Impossible de détacher la dernière source : la fiche ne pourrait plus être rafraîchie.',
      400,
    );
  }

  await detachExternal(workId, provider);
  // Les liens dépendaient de cette source : ils sont recalculés à la demande.
  await syncLinks(workId, c.get('user').preferences);

  return c.json({ externals: await externalsOf(workId) });
});

/** Rattache une source supplémentaire, saisie à la main. */
workRoutes.post('/:workId/sources', async (c) => {
  const workId = c.req.param('workId');
  const input = await parseBody(c, attachSourceInputSchema);

  await getWork(workId);
  await attachExternals(workId, [{ provider: input.provider, providerId: input.providerId }]);
  await refreshWork(workId);

  return c.json({ externals: await externalsOf(workId) });
});

workRoutes.post('/:workId/refresh', async (c) => {
  const workId = c.req.param('workId');
  const row = await refreshWork(workId);
  await syncUnits(workId, { languages: c.get('user').preferences.languages });
  return c.json({ work: toDetails(row, await externalsOf(workId)) });
});

/**
 * Liste des chapitres / épisodes. Les unités sont synchronisées à la volée si
 * elles n'ont jamais été récupérées ou si elles datent de plus de six heures :
 * l'utilisateur n'a jamais à déclencher un rafraîchissement manuel.
 */
workRoutes.get('/:workId/units', async (c) => {
  const user = c.get('user');
  const workId = c.req.param('workId');
  const row = await getWork(workId);

  const stale =
    !row.unitsRefreshedAt || Date.now() - row.unitsRefreshedAt.getTime() > 6 * 3_600_000;
  if (stale) await syncUnits(workId, { languages: user.preferences.languages });

  return c.json({
    units: await listUnits(workId),
    completedUnitIds: await completedUnitIds(user.id, workId),
  });
});

/** Liens de lecture et de visionnage officiels. */
workRoutes.get('/:workId/links', async (c) => {
  const user = c.get('user');
  const workId = c.req.param('workId');
  const row = await getWork(workId);

  const stale =
    !row.linksRefreshedAt || Date.now() - row.linksRefreshedAt.getTime() > 7 * 86_400_000;

  const cached = stale ? await syncLinks(workId, user.preferences) : await listLinks(workId);

  // Les sources personnelles s'ajoutent à la lecture : elles varient d'un
  // compte à l'autre alors que le cache des liens est commun à l'instance.
  const links = withCustomPlatforms(
    cached,
    { kind: row.kind, title: row.title, titles: row.titles, externals: await externalsOf(workId) },
    {
      languages: user.preferences.languages,
      regions: user.preferences.regions,
      ownedPlatforms: user.preferences.ownedPlatforms,
      customPlatforms: user.preferences.customPlatforms,
    },
  );

  const filtered = user.preferences.officialOnly
    ? links.filter(
        (link) => link.official || link.kind === 'info' || link.platform.startsWith('custom:'),
      )
    : links;

  return c.json({
    links: filtered,
    attributions: filtered.some((link) => link.source === 'tmdb') ? [TMDB_ATTRIBUTION] : [],
    refreshedAt: (stale ? new Date() : (row.linksRefreshedAt ?? new Date())).toISOString(),
  });
});
