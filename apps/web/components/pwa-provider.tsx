'use client';

import { SerwistProvider } from '@serwist/turbopack/react';
import { useEffect, type ReactNode } from 'react';

const TROVE_WORKER_PATH = '/serwist/sw.js';
const TROVE_CACHE_PREFIX = 'trove-pwa-';

function DevelopmentPwaCleanup() {
  useEffect(() => {
    const clearDevelopmentPwaState = async () => {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();

        await Promise.all(
          registrations
            .filter(({ active, installing, waiting }) => {
              const worker = active ?? waiting ?? installing;

              return (
                worker?.scriptURL !== undefined &&
                new URL(worker.scriptURL).pathname === TROVE_WORKER_PATH
              );
            })
            .map((registration) => registration.unregister()),
        );
      }

      if ('caches' in window) {
        const cacheNames = await caches.keys();

        await Promise.all(
          cacheNames
            .filter((cacheName) => cacheName.startsWith(TROVE_CACHE_PREFIX))
            .map((cacheName) => caches.delete(cacheName)),
        );
      }
    };

    void clearDevelopmentPwaState();
  }, []);

  return null;
}

export function PwaProvider({ children }: Readonly<{ children: ReactNode }>) {
  if (process.env.NODE_ENV !== 'production') {
    return (
      <>
        <DevelopmentPwaCleanup />
        {children}
      </>
    );
  }

  return (
    <SerwistProvider cacheOnNavigation={false} reloadOnOnline={false} swUrl={TROVE_WORKER_PATH}>
      {children}
    </SerwistProvider>
  );
}
