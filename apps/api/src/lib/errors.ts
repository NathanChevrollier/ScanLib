import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { ProviderError } from '@scanlib/providers';
import { logger } from './logger.js';

/** Erreur applicative portant un code stable, exploitable par le front. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what = 'Ressource') => new AppError('not_found', `${what} introuvable.`, 404);
export const unauthorized = (message = 'Authentification requise.') =>
  new AppError('unauthorized', message, 401);
export const forbidden = (message = 'Accès refusé.') => new AppError('forbidden', message, 403);
export const conflict = (message: string) => new AppError('conflict', message, 409);

/**
 * Reconnaît une panne de connexion à PostgreSQL.
 *
 * `pg` remonte soit une erreur système (serveur éteint, hôte inconnu), soit un
 * code SQLSTATE de la classe 08 (échec de connexion) ou 57P03 (base en cours de
 * démarrage). Aucun de ces cas n'est un bug applicatif.
 */
function isDatabaseUnavailable(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  if (typeof code !== 'string') return false;
  return (
    ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'ECONNRESET'].includes(code) ||
    code.startsWith('08') ||
    code === '57P03' ||
    code === '3D000'
  );
}

/** Gestionnaire d'erreurs unique monté sur l'application Hono. */
export function errorHandler(error: unknown, c: Context): Response {
  if (error instanceof AppError) {
    return c.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      error.status as 400,
    );
  }

  if (error instanceof ZodError) {
    return c.json(
      {
        error: {
          code: 'validation_error',
          message: 'Requête invalide.',
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
      400,
    );
  }

  if (error instanceof ProviderError) {
    // Une source externe en panne n'est pas une erreur du serveur : on le dit
    // explicitement au front pour qu'il affiche une bannière plutôt qu'un échec.
    return c.json(
      {
        error: {
          code: 'provider_unavailable',
          message: `Source ${error.provider} indisponible : ${error.message}`,
        },
      },
      503,
    );
  }

  if (error instanceof HTTPException) {
    return c.json({ error: { code: 'http_error', message: error.message } }, error.status);
  }

  if (isDatabaseUnavailable(error)) {
    // Cas très fréquent en développement : la base n'est pas démarrée. Un
    // « Erreur interne » n'aide personne, alors que la cause est identifiable
    // et la solution évidente.
    logger.error('base de données injoignable', {
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json(
      {
        error: {
          code: 'database_unavailable',
          message:
            "Base de données injoignable. Vérifiez que PostgreSQL est démarré et que DATABASE_URL pointe au bon endroit.",
        },
      },
      503,
    );
  }

  logger.error('erreur non gérée', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

  return c.json({ error: { code: 'internal_error', message: 'Erreur interne.' } }, 500);
}
