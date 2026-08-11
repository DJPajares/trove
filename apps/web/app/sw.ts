/// <reference lib="esnext" />
/// <reference lib="webworker" />

import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from 'serwist';
import { NetworkOnly, Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const runtimeCaching: RuntimeCaching[] = [
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
