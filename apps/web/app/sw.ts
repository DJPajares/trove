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

const tripModeRscCacheKey: SerwistPlugin = {
  cacheKeyWillBeUsed: ({ request }) => {
    const url = new URL(request.url);
    url.searchParams.delete('_rsc');
    return url.toString();
  },
};

const runtimeCaching: RuntimeCaching[] = [
  {
    handler: new NetworkFirst({
      cacheName: 'trove-pwa-trip-mode-rsc',
      networkTimeoutSeconds: 3,
      plugins: [tripModeRscCacheKey],
    }),
    matcher: ({ request, url }) =>
      request.method === 'GET' &&
      /^\/trips\/[^/]+\/mode(?:\/|$)/.test(url.pathname) &&
      (request.headers.get('RSC') === '1' || request.headers.get('Next-Router-Prefetch') === '1'),
    method: 'GET',
  },
  {
    handler: new NetworkFirst({
      cacheName: 'trove-pwa-trip-mode-pages',
      networkTimeoutSeconds: 3,
    }),
    matcher: ({ request, url }) =>
      request.mode === 'navigate' && /^\/trips\/[^/]+\/mode(?:\/|$)/.test(url.pathname),
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
  skipWaiting: true,
});

serwist.addEventListeners();
