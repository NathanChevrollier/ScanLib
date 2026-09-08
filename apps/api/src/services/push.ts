import { eq, inArray } from 'drizzle-orm';
import webpush from 'web-push';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { pushSubscriptions } from '../db/schema.js';
import { logger } from '../lib/logger.js';

/**
 * Notifications poussées vers le navigateur.
 *
 * Sans elles, savoir qu'un chapitre est sorti demande d'ouvrir l'application —
 * ce qui vide de sens la détection automatique. Le service worker de la PWA est
 * déjà en place ; il ne manquait que la paire de clés VAPID et l'envoi.
 *
 * L'absence de clés n'est pas une erreur : l'application fonctionne sans, les
 * notifications restent simplement internes.
 */
const configured = Boolean(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY);

if (configured) {
  webpush.setVapidDetails(
    config.VAPID_SUBJECT,
    config.VAPID_PUBLIC_KEY!,
    config.VAPID_PRIVATE_KEY!,
  );
}

export function isPushConfigured(): boolean {
  return configured;
}

export function publicKey(): string | null {
  return config.VAPID_PUBLIC_KEY ?? null;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Chemin ouvert au clic sur la notification. */
  url: string;
}

export async function saveSubscription(
  userId: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent?: string,
): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent: userAgent ?? null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      // Un même appareil peut changer de compte : l'abonnement suit.
      set: {
        userId,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        lastUsedAt: new Date(),
      },
    });
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

/**
 * Envoie une notification à tous les appareils des comptes concernés.
 *
 * Un abonnement refusé définitivement (404 ou 410) correspond à un navigateur
 * qui a désinstallé l'application ou révoqué l'autorisation : on le supprime,
 * sans quoi la table grossirait indéfiniment d'adresses mortes.
 */
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<number> {
  if (!configured || userIds.length === 0) return 0;

  const subscriptions = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, [...new Set(userIds)]));

  if (subscriptions.length === 0) return 0;

  const message = JSON.stringify(payload);
  let delivered = 0;
  const expired: string[] = [];

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          message,
          { TTL: 24 * 3600 },
        );
        delivered += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) expired.push(subscription.endpoint);
        else {
          logger.warn('notification poussée en échec', {
            status,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }),
  );

  if (expired.length > 0) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, expired));
    logger.info('abonnements expirés retirés', { nombre: expired.length });
  }

  return delivered;
}
