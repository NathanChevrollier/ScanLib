/* eslint-disable @typescript-eslint/no-explicit-any -- les réponses HTTP sont
   volontairement non typées ici : le test vérifie le contrat rendu, pas les
   types du client. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { closeDatabase, db } from '../src/db/client.js';
import { units, users, works } from '../src/db/schema.js';
import { registerUser } from '../src/services/users.js';

/**
 * Tests d'intégration de l'API, sur une vraie base.
 *
 * Ils couvrent ce qu'aucun test unitaire ne pouvait vérifier : qu'un compte ne
 * voit que sa propre bibliothèque, qu'une route protégée refuse un visiteur, et
 * que la progression se calcule correctement. Une régression sur l'un de ces
 * points serait invisible autrement.
 *
 * Aucune API externe n'est appelée : les œuvres sont insérées directement.
 */
const app = createApp();

/**
 * Ces tests ont besoin d'une base. Elle est fournie par l'intégration continue ;
 * en local, si PostgreSQL n'est pas démarré, ils sont ignorés plutôt que de
 * faire échouer toute la suite pour une raison sans rapport avec le code.
 */
const databaseReachable = await db
  .execute(sql`select 1`)
  .then(() => true)
  .catch(() => false);

if (!databaseReachable) {
  console.warn('Base indisponible : tests d’API ignorés (démarrez PostgreSQL pour les exécuter).');
}

const withDatabase = describe.skipIf(!databaseReachable);

/** Exécute une requête HTTP contre l'application, cookies inclus. */
async function call(
  path: string,
  options: { method?: string; body?: unknown; cookies?: string } = {},
): Promise<{ status: number; body: any; cookies: string }> {
  const response = await app.request(`http://localhost${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.cookies ? { Cookie: options.cookies } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  const cookies = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');

  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    cookies,
  };
}

const suffix = Date.now();
const alice = { email: `alice-${suffix}@test.local`, password: 'motdepasse-alice', name: 'Alice' };
const bob = { email: `bob-${suffix}@test.local`, password: 'motdepasse-bob-01', name: 'Bob' };

let aliceCookies = '';
let bobCookies = '';
let workId = '';
let unitIds: string[] = [];

beforeAll(async () => {
  if (!databaseReachable) return;
  await registerUser({
    email: alice.email,
    password: alice.password,
    displayName: alice.name,
    skipInvite: true,
  });
  await registerUser({
    email: bob.email,
    password: bob.password,
    displayName: bob.name,
    skipInvite: true,
  });

  const login = async (email: string, password: string) =>
    (await call('/api/auth/login', { method: 'POST', body: { email, password } })).cookies;

  aliceCookies = await login(alice.email, alice.password);
  bobCookies = await login(bob.email, bob.password);

  // Œuvre de test insérée directement : aucun appel aux API publiques.
  const [work] = await db
    .insert(works)
    .values({
      kind: 'manga',
      title: `Série de test ${suffix}`,
      titles: { fr: `Série de test ${suffix}` },
      releaseStatus: 'ongoing',
    })
    .returning();
  workId = work!.id;

  const inserted = await db
    .insert(units)
    .values(
      [1, 2, 3].map((number) => ({
        workId,
        kind: 'chapter' as const,
        number,
        dedupeKey: `c${number}`,
        source: 'mangadex',
        publishedAt: new Date(Date.now() - number * 86_400_000),
      })),
    )
    .returning({ id: units.id, number: units.number });

  unitIds = inserted.sort((a, b) => (a.number ?? 0) - (b.number ?? 0)).map((row) => row.id);
});

afterAll(async () => {
  if (!databaseReachable) return;
  await db.delete(works).where(sql`${works.id} = ${workId}`);
  await db.delete(users).where(sql`${users.email} in (${alice.email}, ${bob.email})`);
  await closeDatabase();
});

withDatabase('accès', () => {
  it('refuse les routes protégées sans session', async () => {
    for (const path of ['/api/library', '/api/stats', '/api/admin/overview']) {
      const response = await call(path);
      expect(response.status, path).toBe(401);
    }
  });

  it('laisse la sonde de santé ouverte', async () => {
    const response = await call('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it("refuse l'administration à un compte ordinaire", async () => {
    const response = await call('/api/admin/overview', { cookies: bobCookies });
    expect(response.status).toBe(401);
  });
});

withDatabase('bibliothèque', () => {
  it('ajoute une œuvre et la retrouve', async () => {
    const added = await call('/api/library', {
      method: 'POST',
      cookies: aliceCookies,
      body: { workId, status: 'in_progress' },
    });
    expect(added.status).toBe(201);

    const library = await call('/api/library', { cookies: aliceCookies });
    expect(library.status).toBe(200);
    expect(library.body.items.some((item: any) => item.work.id === workId)).toBe(true);
  });

  it("n'expose pas la bibliothèque d'un autre compte", async () => {
    const library = await call('/api/library', { cookies: bobCookies });
    expect(library.status).toBe(200);
    expect(library.body.items).toHaveLength(0);
  });

  it("refuse de modifier la progression d'une œuvre non suivie", async () => {
    const response = await call('/api/library/progress', {
      method: 'POST',
      cookies: bobCookies,
      body: { unitIds: [unitIds[0]], completed: true },
    });
    expect(response.status).toBe(404);
  });
});

withDatabase('progression', () => {
  it('coche une unité et fait avancer le statut', async () => {
    const response = await call('/api/library/progress', {
      method: 'POST',
      cookies: aliceCookies,
      body: { unitIds: [unitIds[0]], completed: true },
    });

    expect(response.status).toBe(200);
    expect(response.body.completedUnitIds).toHaveLength(1);
    expect(response.body.entry.progress).toBe(1);
    expect(response.body.entry.status).toBe('in_progress');
  });

  it('« j’en suis au numéro N » coche avant et décoche après', async () => {
    const monte = await call('/api/library/progress/set', {
      method: 'POST',
      cookies: aliceCookies,
      body: { workId, number: 3 },
    });
    expect(monte.body.completedUnitIds).toHaveLength(3);
    expect(monte.body.entry.status).toBe('completed');

    const descend = await call('/api/library/progress/set', {
      method: 'POST',
      cookies: aliceCookies,
      body: { workId, number: 1 },
    });
    expect(descend.body.completedUnitIds).toHaveLength(1);
    expect(descend.body.entry.progress).toBe(1);
    // Décocher une série terminée la remet logiquement en cours.
    expect(descend.body.entry.status).toBe('in_progress');
  });

  it('enregistre les liens principaux choisis par l’utilisateur', async () => {
    const response = await call(`/api/library/${workId}`, {
      method: 'PATCH',
      cookies: aliceCookies,
      body: { primaryLinks: { fr: 'https://exemple.fr/serie' } },
    });

    expect(response.status).toBe(200);
    expect(response.body.entry.primaryLinks.fr).toBe('https://exemple.fr/serie');
    expect(response.body.entry.primaryLinks.en).toBeNull();
  });
});

withDatabase('connexion', () => {
  it('rejette un mot de passe incorrect', async () => {
    const response = await call('/api/auth/login', {
      method: 'POST',
      body: { email: alice.email, password: 'mauvais-mot-de-passe' },
    });
    expect(response.status).toBe(401);
  });

  it('bloque après plusieurs tentatives ratées', async () => {
    const cible = `inconnu-${suffix}@test.local`;
    let dernier = 0;

    // Cinq essais gratuits, le sixième doit être refusé sans vérifier le mot
    // de passe — c'est ce qui rend la force brute inopérante.
    for (let essai = 0; essai < 7; essai += 1) {
      const response = await call('/api/auth/login', {
        method: 'POST',
        body: { email: cible, password: `essai-${essai}` },
      });
      dernier = response.status;
    }

    expect(dernier).toBe(429);
  });
});


