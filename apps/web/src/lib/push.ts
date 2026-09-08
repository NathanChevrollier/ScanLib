import { api } from './api';

/**
 * Abonnement du navigateur aux notifications poussées.
 *
 * Trois conditions doivent être réunies : le navigateur doit savoir le faire,
 * le serveur doit avoir ses clés VAPID, et l'utilisateur doit accepter. Chacune
 * peut manquer sans que l'application cesse de fonctionner — les notifications
 * restent alors visibles dans l'application seulement.
 */
export interface PushStatus {
  available: boolean;
  subscribed: boolean;
  /** Pourquoi c'est indisponible, à afficher tel quel. */
  reason?: string;
}

export async function pushStatus(): Promise<PushStatus> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return {
      available: false,
      subscribed: false,
      reason: "Ce navigateur ne gère pas les notifications poussées. Sur iPhone, l'application doit être installée sur l'écran d'accueil.",
    };
  }

  const key = await api.pushKey().catch(() => null);
  if (!key?.enabled || !key.publicKey) {
    return {
      available: false,
      subscribed: false,
      reason:
        'Le serveur n’a pas de clés de notification. Renseignez VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY pour les activer.',
    };
  }

  if (Notification.permission === 'denied') {
    return {
      available: false,
      subscribed: false,
      reason: 'Les notifications ont été refusées pour ce site dans les réglages du navigateur.',
    };
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return { available: true, subscribed: subscription != null };
}

export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Autorisation refusée : les notifications resteront dans l’application.');
  }

  const key = await api.pushKey();
  if (!key.publicKey) throw new Error('Le serveur n’a pas de clé de notification.');

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    // Exigé par les navigateurs : une notification poussée doit toujours être
    // visible par l'utilisateur, jamais silencieuse.
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key.publicKey),
  });

  const raw = subscription.toJSON() as {
    endpoint: string;
    keys?: { p256dh?: string; auth?: string };
  };
  if (!raw.keys?.p256dh || !raw.keys.auth) throw new Error('Abonnement incomplet.');

  await api.pushSubscribe({
    endpoint: raw.endpoint,
    keys: { p256dh: raw.keys.p256dh, auth: raw.keys.auth },
  });
}

export async function disablePush(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  await api.pushUnsubscribe(subscription.endpoint).catch(() => undefined);
  await subscription.unsubscribe();
}

/**
 * La clé VAPID circule en base64url ; l'API navigateur attend des octets.
 * Le tampon est alloué explicitement : `PushManager` refuse une vue dont le
 * tampon sous-jacent pourrait être partagé.
 */
function urlBase64ToUint8Array(base64: string): BufferSource {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
