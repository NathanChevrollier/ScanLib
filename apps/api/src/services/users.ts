import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { PublicUser, UpdatePreferencesInput, UserPreferences } from '@scanlib/shared';
import { defaultPreferences, userPreferencesSchema } from '@scanlib/shared';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { invites, recoveryCodes, sessions, users, type UserRow } from '../db/schema.js';
import {
  createRefreshToken,
  generateInviteCode,
  generateRecoveryCode,
  hashPassword,
  hashToken,
  parseDuration,
  verifyPassword,
} from '../lib/auth.js';
import { AppError, conflict, forbidden, notFound, unauthorized } from '../lib/errors.js';

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    preferences: row.preferences,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function findUser(userId: string): Promise<UserRow> {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw notFound('Utilisateur');
  return row;
}

/**
 * Création de compte. L'instance est fermée par défaut : il faut soit un code
 * d'invitation valide, soit passer par la commande `npm run user:create`.
 * Le tout premier compte créé devient administrateur.
 */
export async function registerUser(input: {
  email: string;
  password: string;
  displayName: string;
  inviteCode?: string | undefined;
  role?: 'admin' | 'user';
  skipInvite?: boolean;
}): Promise<UserRow> {
  const email = input.email.toLowerCase().trim();

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) throw conflict('Un compte existe déjà avec cette adresse.');

  const [totals] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  const isFirstUser = (totals?.count ?? 0) === 0;

  let invite: typeof invites.$inferSelect | undefined;
  if (!isFirstUser && !input.skipInvite && !config.ALLOW_OPEN_REGISTRATION) {
    if (!input.inviteCode) throw forbidden("Un code d'invitation est nécessaire.");
    [invite] = await db
      .select()
      .from(invites)
      .where(
        and(
          eq(invites.code, input.inviteCode.trim().toUpperCase()),
          isNull(invites.usedBy),
          or(isNull(invites.expiresAt), sql`${invites.expiresAt} > now()`),
        ),
      )
      .limit(1);
    if (!invite) throw forbidden("Code d'invitation invalide ou déjà utilisé.");
  }

  const [row] = await db
    .insert(users)
    .values({
      email,
      passwordHash: await hashPassword(input.password),
      displayName: input.displayName.trim(),
      role: input.role ?? (isFirstUser ? 'admin' : 'user'),
      preferences: {
        ...defaultPreferences,
        languages: config.DEFAULT_LANGUAGES,
        regions: config.DEFAULT_WATCH_REGIONS,
      },
    })
    .returning();

  if (invite) {
    await db
      .update(invites)
      .set({ usedBy: row!.id, usedAt: new Date() })
      .where(eq(invites.code, invite.code));
  }

  return row!;
}

export async function authenticate(email: string, password: string): Promise<UserRow> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()))
    .limit(1);

  // Message identique dans les deux cas : ne pas révéler quelles adresses existent.
  if (!row) throw unauthorized('Adresse ou mot de passe incorrect.');
  const valid = await verifyPassword(row.passwordHash, password);
  if (!valid) throw unauthorized('Adresse ou mot de passe incorrect.');

  // Un compte suspendu conserve ses identifiants mais ne peut plus entrer.
  if (row.disabledAt) {
    throw forbidden('Ce compte a été suspendu par un administrateur.');
  }

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, row.id));
  return row;
}

/**
 * Change le mot de passe et révoque les autres sessions.
 *
 * Changer son mot de passe sert le plus souvent à reprendre la main après un
 * doute : laisser les sessions existantes ouvertes viderait le geste de son
 * sens. Celle en cours est épargnée pour ne pas se déconnecter soi-même.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepSessionToken?: string,
): Promise<void> {
  const user = await findUser(userId);

  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw unauthorized('Mot de passe actuel incorrect.');
  }
  if (await verifyPassword(user.passwordHash, newPassword)) {
    throw new AppError('same_password', 'Le nouveau mot de passe doit être différent.', 400);
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
    .where(eq(users.id, userId));

  await revokeOtherSessions(userId, keepSessionToken);
}

/**
 * Code de secours à usage unique, généré par un administrateur.
 *
 * Une instance auto-hébergée n'a pas forcément de serveur d'envoi d'e-mails.
 * Plutôt que d'imposer une configuration SMTP à qui veut simplement suivre ses
 * séries, l'administrateur produit un code et le transmet de vive voix. Seule
 * son empreinte est conservée : la base volée ne donne rien.
 */
export async function createRecoveryCode(
  targetUserId: string,
  createdBy: string,
  ttlHours = 24,
): Promise<{ code: string; expiresAt: Date }> {
  await findUser(targetUserId);

  const code = generateRecoveryCode();
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);

  await db.insert(recoveryCodes).values({
    userId: targetUserId,
    codeHash: hashToken(code),
    createdBy,
    expiresAt,
  });

  return { code, expiresAt };
}

/** Consomme un code de secours et fixe un nouveau mot de passe. */
export async function consumeRecoveryCode(code: string, newPassword: string): Promise<UserRow> {
  const [row] = await db
    .select()
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.codeHash, hashToken(code.trim().toUpperCase())), isNull(recoveryCodes.usedAt)))
    .limit(1);

  if (!row || row.expiresAt.getTime() < Date.now()) {
    throw forbidden('Code de secours invalide ou expiré.');
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
    .where(eq(users.id, row.userId));

  await db.update(recoveryCodes).set({ usedAt: new Date() }).where(eq(recoveryCodes.id, row.id));

  // Un mot de passe repris signifie que l'ancien n'est plus sûr : on ferme tout.
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, row.userId), isNull(sessions.revokedAt)));

  return findUser(row.userId);
}

export async function updateProfile(
  userId: string,
  input: { displayName?: string; email?: string },
): Promise<UserRow> {
  const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };

  if (input.displayName !== undefined) patch.displayName = input.displayName.trim();

  if (input.email !== undefined) {
    const email = input.email.toLowerCase().trim();
    const [taken] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (taken && taken.id !== userId) throw conflict('Cette adresse est déjà utilisée.');
    patch.email = email;
  }

  const [updated] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
  return updated!;
}

/**
 * Supprime définitivement un compte et tout ce qui s'y rattache.
 *
 * L'effacement en cascade est déjà décrit par le schéma : bibliothèque,
 * progression, activité, notifications et sessions partent avec la ligne.
 */
export async function deleteAccount(userId: string, password: string): Promise<void> {
  const user = await findUser(userId);
  if (!(await verifyPassword(user.passwordHash, password))) {
    throw unauthorized('Mot de passe incorrect.');
  }
  await db.delete(users).where(eq(users.id, userId));
}

/* -------------------------------------------------------------------------
 * Sessions
 * ---------------------------------------------------------------------- */

export interface SessionSummary {
  id: string;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

export async function listSessions(
  userId: string,
  currentToken?: string,
): Promise<SessionSummary[]> {
  const currentHash = currentToken ? hashToken(currentToken) : null;

  const rows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .orderBy(desc(sessions.createdAt));

  return rows
    .filter((row) => row.expiresAt.getTime() > Date.now())
    .map((row) => ({
      id: row.id,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      current: currentHash != null && row.tokenHash === currentHash,
    }));
}

export async function revokeSessionById(userId: string, sessionId: string): Promise<void> {
  const result = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .returning({ id: sessions.id });

  if (result.length === 0) throw notFound('Session');
}

export async function revokeOtherSessions(userId: string, keepToken?: string): Promise<number> {
  const keepHash = keepToken ? hashToken(keepToken) : null;

  const revoked = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        keepHash ? sql`${sessions.tokenHash} <> ${keepHash}` : sql`true`,
      ),
    )
    .returning({ id: sessions.id });

  return revoked.length;
}

/** Supprime les sessions révoquées ou expirées — tâche d'entretien. */
export async function pruneSessions(): Promise<number> {
  const deleted = await db
    .delete(sessions)
    .where(sql`${sessions.expiresAt} < now() or ${sessions.revokedAt} < now() - interval '7 days'`)
    .returning({ id: sessions.id });
  return deleted.length;
}

export async function createSession(
  userId: string,
  userAgent?: string,
): Promise<{ token: string; expiresAt: Date }> {
  const { token, tokenHash } = createRefreshToken();
  const expiresAt = new Date(Date.now() + parseDuration(config.REFRESH_TOKEN_TTL));

  await db.insert(sessions).values({
    userId,
    tokenHash,
    userAgent: userAgent ?? null,
    expiresAt,
  });

  return { token, expiresAt };
}

/**
 * Rotation du jeton de rafraîchissement : l'ancien est révoqué à chaque usage,
 * ce qui limite la fenêtre d'exploitation d'un jeton volé.
 */
export async function rotateSession(
  token: string,
  userAgent?: string,
): Promise<{ user: UserRow; token: string; expiresAt: Date }> {
  const tokenHash = hashToken(token);
  const [session] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)))
    .limit(1);

  if (!session || session.expiresAt.getTime() < Date.now()) {
    throw unauthorized('Session expirée, reconnectez-vous.');
  }

  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, session.id));

  const user = await findUser(session.userId);
  const next = await createSession(user.id, userAgent);
  return { user, ...next };
}

export async function revokeSession(token: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.tokenHash, hashToken(token)));
}

export async function updatePreferences(
  userId: string,
  input: UpdatePreferencesInput,
): Promise<UserPreferences> {
  const user = await findUser(userId);
  const preferences = userPreferencesSchema.parse({ ...user.preferences, ...input });

  await db
    .update(users)
    .set({ preferences, updatedAt: new Date() })
    .where(eq(users.id, userId));

  return preferences;
}

export async function createInvite(
  createdBy: string,
  ttlDays = 14,
): Promise<{ code: string; expiresAt: Date }> {
  const code = generateInviteCode();
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
  await db.insert(invites).values({ code, createdBy, expiresAt });
  return { code, expiresAt };
}
