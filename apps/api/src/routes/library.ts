import { Hono } from 'hono';
import {
  addToLibraryInputSchema,
  libraryQuerySchema,
  progressInputSchema,
  progressUpToInputSchema,
  setProgressInputSchema,
  updateEntryInputSchema,
} from '@scanlib/shared';
import type { AppEnv } from '../lib/context.js';
import { requireAuth } from '../lib/context.js';
import { parseBody, parseQuery } from '../lib/validate.js';
import {
  addToLibrary,
  listLibrary,
  removeFromLibrary,
  updateEntry,
} from '../services/library.js';
import { markUpTo, setProgressNumber, setUnitsCompleted } from '../services/progress.js';

export const libraryRoutes = new Hono<AppEnv>();

libraryRoutes.use('*', requireAuth);

libraryRoutes.get('/', async (c) => {
  const query = parseQuery(c, libraryQuerySchema, ['status', 'kinds', 'genres', 'tags']);
  return c.json(await listLibrary(c.get('user').id, query));
});

libraryRoutes.post('/', async (c) => {
  const user = c.get('user');
  const input = await parseBody(c, addToLibraryInputSchema);
  const result = await addToLibrary(user.id, input, user.preferences.languages);
  return c.json(result, 201);
});

libraryRoutes.patch('/:workId', async (c) => {
  const input = await parseBody(c, updateEntryInputSchema);
  const entry = await updateEntry(c.get('user').id, c.req.param('workId'), input);
  return c.json({ entry });
});

libraryRoutes.delete('/:workId', async (c) => {
  await removeFromLibrary(c.get('user').id, c.req.param('workId'));
  return c.json({ ok: true });
});

/* --- Progression -------------------------------------------------------- */

libraryRoutes.post('/progress', async (c) => {
  const input = await parseBody(c, progressInputSchema);
  const result = await setUnitsCompleted(c.get('user').id, input.unitIds, input.completed);
  return c.json(result);
});

libraryRoutes.post('/progress/up-to', async (c) => {
  const input = await parseBody(c, progressUpToInputSchema);
  const result = await markUpTo(c.get('user').id, input.workId, input.number);
  return c.json(result);
});

/** « J'en suis au numéro N » : coche jusqu'à N et décoche au-delà. */
libraryRoutes.post('/progress/set', async (c) => {
  const input = await parseBody(c, setProgressInputSchema);
  const result = await setProgressNumber(c.get('user').id, input.workId, input.number);
  return c.json(result);
});
