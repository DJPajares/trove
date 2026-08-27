/// <reference lib="esnext" />
/// <reference lib="webworker" />

import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig, SerwistPlugin } from 'serwist';
import {
  CacheableResponsePlugin,
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
} from 'serwist';

import {
  EDITORIAL_IMAGE_CACHE,
  isSupabaseStorageObject,
  STATIC_IMAGE_CACHE,
  storageCacheKey,
  USER_MEDIA_CACHE,
} from '@/lib/media/storage-cache-key';

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

const DAY_SECONDS = 24 * 60 * 60;

/** Signed URLs rotate; the object behind them does not. */
const storageMediaCacheKey: SerwistPlugin = {
  cacheKeyWillBeUsed: ({ request }) => storageCacheKey(request.url),
};

/**
 * `next/image` sets no `crossOrigin`, so cross-origin photographs come back as
 * opaque responses with `status: 0`. Leaving the 0 out of this list is the
 * difference between an image cache and an image cache that silently stores
 * nothing at all.
 */
const cacheableImage = () => new CacheableResponsePlugin({ statuses: [0, 200] });

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
    /**
     * Editorial photography, hotlinked from the provider.
     *
     * CacheFirst rather than stale-while-revalidate because a provider URL at a
     * fixed width is immutable - revalidating would spend a request per view on
     * bytes that cannot have changed.
     *
     * The 90 days match the API's own `EDITORIAL_IMAGE_CACHE_TTL_MS`, so cached
     * bytes never outlive the reference that named them. Reconciliation needs
     * nothing more than that: re-resolving a subject yields a different source
     * URL, and the URL is the key, so superseded entries are simply never asked
     * for again and fall out under `maxEntries`. Opaque responses are padded
     * heavily against the storage quota, which is what `purgeOnQuotaError` is
     * for.
     */
    handler: new CacheFirst({
      cacheName: EDITORIAL_IMAGE_CACHE,
      plugins: [
        cacheableImage(),
        new ExpirationPlugin({
          maxAgeSeconds: 90 * DAY_SECONDS,
          maxEntries: 200,
          purgeOnQuotaError: true,
        }),
      ],
    }),
    matcher: ({ request, url }) =>
      request.destination === 'image' && url.hostname === 'images.pexels.com',
    method: 'GET',
  },
  {
    /**
     * The traveller's own media - trip covers, memory photos, avatars.
     *
     * Keyed by storage path rather than by signed URL, so a screen refetching
     * and re-signing does not re-download what it already has. Covers and
     * avatars are uploaded to a fresh id and never overwritten, so a replaced
     * one is a new key; memory photos can be overwritten, and the upload path
     * evicts them explicitly.
     */
    handler: new CacheFirst({
      cacheName: USER_MEDIA_CACHE,
      plugins: [
        storageMediaCacheKey,
        cacheableImage(),
        new ExpirationPlugin({
          maxAgeSeconds: 30 * DAY_SECONDS,
          maxEntries: 300,
          purgeOnQuotaError: true,
        }),
      ],
    }),
    matcher: ({ request, url }) => request.destination === 'image' && isSupabaseStorageObject(url),
    method: 'GET',
  },
  {
    /**
     * Trove's own icons. Stale-while-revalidate rather than CacheFirst so a
     * re-deployed icon corrects itself on the next load instead of waiting out
     * an expiry. Everything under `_next/static` is content-hashed and already
     * precached, so this is only the handful of files in `public`.
     */
    handler: new StaleWhileRevalidate({
      cacheName: STATIC_IMAGE_CACHE,
      plugins: [new ExpirationPlugin({ maxAgeSeconds: 30 * DAY_SECONDS, maxEntries: 60 })],
    }),
    matcher: ({ request, url }) =>
      request.destination === 'image' && url.origin === self.location.origin,
    method: 'GET',
  },
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
