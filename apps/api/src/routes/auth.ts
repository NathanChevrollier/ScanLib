import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import {
  changePasswordInputSchema,
  deleteAccountInputSchema,
  loginInputSchema,
  recoveryInputSchema,
  registerInputSchema,
  updateProfileInputSchema,
} from '@scanlib/shared';
import { config } from '../config.js';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  cookieOptions,
  parseDuration,
  signAccessToken,
} from '../lib/auth.js';
import type { AppEnv } from '../lib/context.js';
import { requireAdmin, requireAuth } from '../lib/context.js';
import { unauthorized } from '../lib/errors.js';
import { parseBody } from '../lib/validate.js';
import {
  assertLoginAllowed,
  clearLoginAttempts,
  recordFailedLogin,
} from '../services/auth-guard.js';
import {
  authenticate,
  changePassword,
  consumeRecoveryCode,
  createInvite,
  createSession,
  deleteAccount,
  listSessions,
  registerUser,
  revokeOtherSessions,
  revokeSession,
  revokeSessionById,
  rotateSession,
  toPublicUser,
  updateProfile,
} from '../services/users.js';

export const authRoutes = new Hono<AppEnv>();

async function issueCookies(
  c: Context<AppEnv>,
  userId: string,
  role: 'admin' | 'user',
): Promise<void> {
  const access = await signAccessToken({ sub: userId, role });
  const session = await createSession(userId, c.req.header('user-agent'));

  setCookie(c, ACCESS_COOKIE, access, cookieOptions(parseDuration(config.ACCESS_TOKEN_TTL)));
  setCookie(c, REFRESH_COOKIE, session.token, cookieOptions(parseDuration(config.REFRESH_TOKEN_TTL)));
}

authRoutes.post('/register', async (c) => {
  const input = await parseBody(c, registerInputSchema);
  const user = await registerUser(input);
  await issueCookies(c, user.id, user.role);
  return c.json({ user: toPublicUser(user) }, 201);
});

authRoutes.post('/login', async (c) => {
  const { email, password } = await parseBody(c, loginInputSchema);
  const ip = clientIp(c);

  // Le compteur est consulté avant de vérifier le mot de passe : une tentative
  // bloquée ne doit pas mobiliser argon2, qui est volontairement coûteux.
  await assertLoginAllowed(ip, email);

  let user;
  try {
    user = await authenticate(email, password);
  } catch (error) {
    await recordFailedLogin(ip, email);
    throw error;
  }

  await clearLoginAttempts(ip, email);
  await issueCookies(c, user.id, user.role);
  return c.json({ user: toPublicUser(user) });
});

/** Change son propre mot de passe et ferme les autres sessions. */
authRoutes.post('/password', requireAuth, async (c) => {
  const input = await parseBody(c, changePasswordInputSchema);
  await changePassword(
    c.get('user').id,
    input.currentPassword,
    input.newPassword,
    getCookie(c, REFRESH_COOKIE),
  );
  return c.json({ ok: true });
});

/** Reprend la main sur un compte avec un code de secours. */
authRoutes.post('/recovery', async (c) => {
  const input = await parseBody(c, recoveryInputSchema);
  const ip = clientIp(c);

  // Un code de secours se devine aussi mal qu'un mot de passe : même protection.
  await assertLoginAllowed(ip, `recovery:${input.code.slice(0, 4)}`);

  try {
    const user = await consumeRecoveryCode(input.code, input.newPassword);
    await issueCookies(c, user.id, user.role);
    return c.json({ user: toPublicUser(user) });
  } catch (error) {
    await recordFailedLogin(ip, `recovery:${input.code.slice(0, 4)}`);
    throw error;
  }
});

authRoutes.patch('/profile', requireAuth, async (c) => {
  const input = await parseBody(c, updateProfileInputSchema);
  const user = await updateProfile(c.get('user').id, input);
  return c.json({ user: toPublicUser(user) });
});

authRoutes.post('/account/delete', requireAuth, async (c) => {
  const input = await parseBody(c, deleteAccountInputSchema);
  await deleteAccount(c.get('user').id, input.password);
  deleteCookie(c, ACCESS_COOKIE, { path: '/' });
  deleteCookie(c, REFRESH_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

/* --- Appareils connectés ------------------------------------------------ */

authRoutes.get('/sessions', requireAuth, async (c) =>
  c.json({ sessions: await listSessions(c.get('user').id, getCookie(c, REFRESH_COOKIE)) }),
);

authRoutes.delete('/sessions/:id', requireAuth, async (c) => {
  await revokeSessionById(c.get('user').id, c.req.param('id'));
  return c.json({ ok: true });
});

authRoutes.post('/sessions/revoke-others', requireAuth, async (c) => {
  const revoked = await revokeOtherSessions(c.get('user').id, getCookie(c, REFRESH_COOKIE));
  return c.json({ revoked });
});

/** Renouvelle le jeton d'accès à partir du jeton de rafraîchissement. */
authRoutes.post('/refresh', async (c) => {
  const token = getCookie(c, REFRESH_COOKIE);
  if (!token) throw unauthorized();

  const { user, token: nextToken } = await rotateSession(token, c.req.header('user-agent'));
  const access = await signAccessToken({ sub: user.id, role: user.role });

  setCookie(c, ACCESS_COOKIE, access, cookieOptions(parseDuration(config.ACCESS_TOKEN_TTL)));
  setCookie(c, REFRESH_COOKIE, nextToken, cookieOptions(parseDuration(config.REFRESH_TOKEN_TTL)));

  return c.json({ user: toPublicUser(user) });
});

authRoutes.post('/logout', async (c) => {
  const token = getCookie(c, REFRESH_COOKIE);
  if (token) await revokeSession(token);
  deleteCookie(c, ACCESS_COOKIE, { path: '/' });
  deleteCookie(c, REFRESH_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

authRoutes.get('/me', requireAuth, (c) => c.json({ user: toPublicUser(c.get('user')) }));

/** Génère un code d'invitation — seul moyen d'ouvrir l'instance à quelqu'un. */
authRoutes.post('/invites', requireAuth, requireAdmin, async (c) => {
  const invite = await createInvite(c.get('user').id);
  return c.json({ code: invite.code, expiresAt: invite.expiresAt.toISOString() }, 201);
});

/**
 * Adresse du client. Derrière Caddy, l'adresse réelle arrive dans
 * `X-Forwarded-For` ; on ne retient que le premier maillon, les suivants
 * pouvant être ajoutés par le client lui-même.
 */
function clientIp(c: Context<AppEnv>): string | null {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null;
  return c.req.header('x-real-ip') ?? null;
}