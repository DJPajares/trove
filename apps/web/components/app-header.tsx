'use client';

import { useReducedMotion } from 'motion/react';
import { useEffect, type ReactNode } from 'react';

import { useCollapsingHeader } from '@/hooks/use-collapsing-header';
import { cn } from '@/lib/utils';

/**
 * The app header, which gives its height back to the content while a traveller
 * scrolls down and takes it again the moment they scroll up.
 *
 * On a phone the day plan is the reason the app is open; a permanent brand bar
 * spends a tenth of the viewport on chrome the traveller is not reading.
 */
export function AppHeader({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  const shouldReduceMotion = useReducedMotion();
  // Someone who has asked for less movement gets a header that simply stays put
  // rather than one that slides away without animating.
  const { collapsed, reveal } = useCollapsingHeader({ enabled: !shouldReduceMotion });

  useEffect(() => {
    // `--header-offset` is declared on :root, so the flag belongs there too —
    // that is what lets Trip Mode's sticky bar follow the header without
    // knowing anything about it.
    const root = document.documentElement;

    if (collapsed) {
      root.setAttribute('data-header-collapsed', 'true');
    } else {
      root.removeAttribute('data-header-collapsed');
    }

    return () => root.removeAttribute('data-header-collapsed');
  }, [collapsed]);

  return (
    <header
      className={cn(
        'sticky top-0 z-[var(--layer-sticky)] border-b border-border-subtle bg-background/95 pt-[var(--safe-top)] backdrop-blur transition-transform duration-[var(--motion-standard)] ease-[var(--ease-standard)] supports-[backdrop-filter]:bg-background/88',
        collapsed && '-translate-y-full',
        className,
      )}
      data-translucent-surface
      // Tabbing must never move focus to a control that has scrolled out of
      // sight, so any focus arriving inside the header brings it back first.
      onFocusCapture={reveal}
    >
      {children}
    </header>
  );
}
