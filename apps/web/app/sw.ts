/// <reference lib="esnext" />
/// <reference lib="webworker" />

import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig, SerwistPlugin } from 'serwist';
import { NetworkFirst, NetworkOnly, Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const requestedUrl = new URL(
    typeof event.notification.data?.url === 'string' ? event.notification.data.url : '/',
    self.location.origin,
  );
  const url = new URL(
    requestedUrl.origin === self.location.origin
      ? `${requestedUrl.pathname}${requestedUrl.search}${requestedUrl.hash}`
      : '/',
    self.location.origin,
  ).toString();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const matchingClient = clients.find((client) => client.url === url);
      if (matchingClient && 'focus' in matchingClient) return matchingClient.focus();
      return self.clients.openWindow(url);
    }),
  );
});

const tripModeRscCacheKey: SerwistPlugin = {
  cacheKeyWillBeUsed: ({ request }) => {
    const url = new URL(request.url);
    url.searchParams.delete('_rsc');
    return url.toString();
  },
};

const offlineTripPath =
  /^\/trips\/[^/]+\/(?:expenses|info|itinerary|mode(?:\/[^/]+)?|places|reservations|tasks)\/?$/;

const runtimeCaching: RuntimeCaching[] = [
  {
    handler: new NetworkFirst({
      cacheName: 'trove-pwa-trip-mode-rsc',
      networkTimeoutSeconds: 3,
      plugins: [tripModeRscCacheKey],
    }),
    matcher: ({ request, url }) =>
      request.method === 'GET' &&
      offlineTripPath.test(url.pathname) &&
      (request.headers.get('RSC') === '1' || request.headers.get('Next-Router-Prefetch') === '1'),
    method: 'GET',
  },
  {
    handler: new NetworkFirst({
      cacheName: 'trove-pwa-trip-mode-pages',
      networkTimeoutSeconds: 3,
    }),
    matcher: ({ request, url }) =>
      request.mode === 'navigate' && offlineTripPath.test(url.pathname),
    method: 'GET',
  },
  {
    handler: new NetworkOnly(),
    matcher: ({ request }) => request.mode === 'navigate',
    method: 'GET',
  },
];

const serwist = new Serwist({
  cacheId: 'trove-pwa',
  clientsClaim: true,
  fallbacks: {
    entries: [
      {
        matcher: ({ request }) => request.mode === 'navigate',
        url: '/~offline',
      },
    ],
  },
  navigationPreload: true,
  precacheEntries: self.__SW_MANIFEST,
  runtimeCaching,
  // A new build waits until the user accepts it. Taking over an open tab
  // immediately would leave the running page requesting chunks the new
  // precache no longer serves.
  skipWaiting: false,
});

serwist.addEventListeners();
