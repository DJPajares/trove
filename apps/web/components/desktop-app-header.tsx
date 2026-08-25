'use client';

import { useSyncExternalStore, type ReactNode } from 'react';

import { AppHeader } from '@/components/app-header';

function subscribeToDesktopViewport(onChange: () => void) {
  const query = window.matchMedia('(min-width: 768px)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function DesktopAppHeader({ children }: Readonly<{ children: ReactNode }>) {
  const desktop = useSyncExternalStore(
    subscribeToDesktopViewport,
    () => window.matchMedia('(min-width: 768px)').matches,
    // The CSS fallback keeps this server-rendered header hidden on mobile until
    // hydration can unmount it, without delaying the desktop header.
    () => true,
  );

  return desktop ? <AppHeader className="hidden md:block">{children}</AppHeader> : null;
}
