/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

/**
 * Service worker de l'application.
 *
 * Il était jusqu'ici généré automatiquement, ce qui suffisait pour le cache mais
 * interdisait de recevoir des notifications poussées — d'où ce fichier écrit à
 * la main : mêmes règles de cache qu'avant, plus la réception des notifications.
 */
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: { url: string; revision: string | null }[];
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Toute navigation retombe sur la coquille de l'application, sauf l'API.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api/],
  }),
);

// Jaquettes : cache long, elles ne changent pas.
registerRoute(
  ({ url }) =>
    /^(uploads\.mangadex\.org|image\.tmdb\.org|cdn\.myanimelist\.net|media\.kitsu\.(io|app)|s4\.anilist\.co|static\.tvmaze\.com)$/.test(
      url.hostname,
    ),
  new CacheFirst({
    cacheName: 'scanlib-covers',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
);

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/* -------------------------------------------------------------------------
 * Notifications poussées
 * ---------------------------------------------------------------------- */

interface PushPayload {
  title: string;
  body: string;
  url: string;
}

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload: PushPayload;
  try {
    payload = event.data.json() as PushPayload;
  } catch {
    payload = { title: 'ScanLib', body: event.data.text(), url: '/' };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: { url: payload.url },
      // Regroupe les notifications d'une même œuvre plutôt que de les empiler.
      tag: payload.url,
    }),
  );
});

/**
 * Au clic, on réutilise un onglet déjà ouvert plutôt que d'en créer un :
 * l'application installée n'a qu'une fenêtre, et rouvrir la même deux fois
 * perdrait l'état de navigation.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data as { url?: string } | undefined)?.url ?? '/';

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) await client.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
