import { eq, lt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { authAttempts } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/**
 * Protection des connexions contre la force brute.
 *
 * Deux compteurs indépendants : l'adresse IP, pour bloquer une machine qui
 * essaie mille mots de passe, et l'adresse e-mail, pour bloquer une attaque
 * répartie sur plusieurs adresses visant un compte précis. Le premier des deux
 * qui déborde bloque la tentative.
 *
 * Le blocage est temporaire et croissant : cinq essais gratuits, puis une
 * minute, deux, quatre… plafonné à une heure. Assez pour rendre l'attaque
 * inutile, assez court pour ne pas punir un utilisateur qui se trompe.
 */
const FREE_ATTEMPTS = 5;
const BASE_BLOCK_MS = 60_000;
const MAX_BLOCK_MS = 60 * 60_000;
/** Un compteur inactif depuis ce délai repart de zéro. */
const RESET_AFTER_MS = 60 * 60_000;

export class TooManyAttemptsError extends AppError {
  constructor(retryAfterSeconds: number) {
    super(
      'too_many_attempts',
      `Trop de tentatives. Réessayez dans ${formatDelay(retryAfterSeconds)}.`,
      429,
      { retryAfterSeconds },
    );
  }
}

/** Vérifie que la tentative est permise. Lève si un des compteurs est bloqué. */
export async function assertLoginAllowed(ip: string | null, email: string): Promise<void> {
  const keys = buildKeys(ip, email);
  if (keys.length === 0) return;

  const rows = await db
    .select()
    .from(authAttempts)
    .where(sql`${authAttempts.key} = any(array[${sql.join(keys.map((key) => sql`${key}`), sql`, `)}])`);

  const now = Date.now();
  const blocked = rows.filter((row) => row.blockedUntil && row.blockedUntil.getTime() > now);
  if (blocked.length === 0) return;

  const until = Math.max(...blocked.map((row) => row.blockedUntil!.getTime()));
  throw new TooManyAttemptsError(Math.ceil((until - now) / 1000));
}

/**
 * Enregistre un échec et allonge le blocage si nécessaire.
 *
 * L'incrément se fait en une seule instruction SQL : deux tentatives simultanées
 * ne peuvent pas se marcher dessus et faire perdre un décompte.
 */
export async function recordFailedLogin(ip: string | null, email: string): Promise<void> {
  const now = new Date();

  for (const key of buildKeys(ip, email)) {
    const [row] = await db
      .insert(authAttempts)
      .values({ key, attempts: 1, updatedAt: now })
      .onConflictDoUpdate({
        target: authAttempts.key,
        set: {
          // Un compteur oublié depuis une heure repart à un.
          attempts: sql`case
            when ${authAttempts.updatedAt} < now() - interval '1 hour' then 1
            else ${authAttempts.attempts} + 1
          end`,
          updatedAt: now,
        },
      })
      .returning();

    if (!row || row.attempts <= FREE_ATTEMPTS) continue;

    const block = Math.min(MAX_BLOCK_MS, BASE_BLOCK_MS * 2 ** (row.attempts - FREE_ATTEMPTS - 1));
    await db
      .update(authAttempts)
      .set({ blockedUntil: new Date(Date.now() + block) })
      .where(eq(authAttempts.key, key));

    logger.warn('tentatives de connexion bloquées', {
      cible: key.startsWith('email:') ? 'compte' : 'adresse',
      tentatives: row.attempts,
      minutes: Math.round(block / 60_000),
    });
  }
}

/** Une connexion réussie efface les compteurs des deux clés. */
export async function clearLoginAttempts(ip: string | null, email: string): Promise<void> {
  const keys = buildKeys(ip, email);
  if (keys.length === 0) return;
  await db
    .delete(authAttempts)
    .where(sql`${authAttempts.key} = any(array[${sql.join(keys.map((key) => sql`${key}`), sql`, `)}])`);
}

/** Purge les compteurs inactifs — appelée par la tâche d'entretien. */
export async function pruneLoginAttempts(): Promise<number> {
  const deleted = await db
    .delete(authAttempts)
    .where(lt(authAttempts.updatedAt, new Date(Date.now() - RESET_AFTER_MS)))
    .returning({ key: authAttempts.key });
  return deleted.length;
}

function buildKeys(ip: string | null, email: string): string[] {
  const keys = [`email:${email.toLowerCase().trim()}`];
  if (ip) keys.push(`ip:${ip}`);
  return keys;
}

function formatDelay(seconds: number): string {
  if (seconds < 60) return `${seconds} secondes`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? 'une minute' : `${minutes} minutes`;
}
