import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';

const secret = new TextEncoder().encode(config.JWT_SECRET);

export const ACCESS_COOKIE = 'scanlib_access';
export const REFRESH_COOKIE = 'scanlib_refresh';

export interface AccessPayload {
  sub: string;
  role: 'admin' | 'user';
}

/** Argon2id : paramètres par défaut de la bibliothèque, adaptés à un VPS. */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export async function signAccessToken(payload: AccessPayload): Promise<string> {
  return new SignJWT({ role: payload.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(config.ACCESS_TOKEN_TTL)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (!payload.sub) return null;
    return { sub: payload.sub, role: (payload.role as 'admin' | 'user') ?? 'user' };
  } catch {
    return null;
  }
}

/**
 * Le jeton de rafraîchissement est une valeur aléatoire opaque : seul son
 * empreinte est stockée, ce qui permet de révoquer une session et évite
 * qu'une fuite de la base ne donne accès aux comptes.
 */
export function createRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(48).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Convertit « 15m », « 30d » en millisecondes. */
export function parseDuration(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match?.[1] || !match[2]) throw new Error(`Durée invalide : ${value}`);
  const amount = Number(match[1]);
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]] ?? 1000;
  return amount * unit;
}

export function cookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'Lax' as const,
    path: '/',
    maxAge: Math.floor(maxAgeMs / 1000),
    ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
  };
}

export function generateInviteCode(): string {
  return randomBytes(9).toString('base64url').toUpperCase();
}

/**
 * Code de secours lisible à voix haute : groupes de quatre caractères, sans
 * les lettres et chiffres qui se confondent (O/0, I/1).
 */
export function generateRecoveryCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(16);
  const chars = [...bytes].map((byte) => alphabet[byte % alphabet.length]);
  return [0, 4, 8, 12].map((start) => chars.slice(start, start + 4).join('')).join('-');
}
