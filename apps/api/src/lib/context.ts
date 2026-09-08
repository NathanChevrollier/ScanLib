import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { UserRow } from '../db/schema.js';
import { ACCESS_COOKIE, verifyAccessToken } from './auth.js';
import { unauthorized } from './errors.js';
import { findUser } from '../services/users.js';

export interface AppEnv {
  Variables: {
    user: UserRow;
  };
}

/**
 * Authentification par cookie httpOnly. Le jeton d'accès est court (15 min) ;
 * le front le renouvelle silencieusement via `/api/auth/refresh`, ce qui évite
 * de stocker quoi que ce soit d'exploitable en JavaScript côté navigateur.
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, ACCESS_COOKIE) ?? bearerToken(c);
  if (!token) throw unauthorized();

  const payload = await verifyAccessToken(token);
  if (!payload) throw unauthorized('Session expirée.');

  c.set('user', await findUser(payload.sub));
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user');
  if (user.role !== 'admin') throw unauthorized('Réservé aux administrateurs.');
  await next();
};

function bearerToken(c: Context): string | undefined {
  const header = c.req.header('authorization');
  return header?.toLowerCase().startsWith('bearer ') ? header.slice(7) : undefined;
}
