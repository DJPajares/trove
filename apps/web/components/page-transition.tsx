'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

/** Long enough to be a stuck navigation rather than a slow one. */
const STALE_AFTER_MS = 15_000;

/**
 * The bridge between tapping a link and the next screen appearing.
 *
 * Trove has no root loading skeleton any more, and deliberately so: the root
 * boundary sits above every route, so whatever it drew could only ever be a
 * shape that resembled nothing the traveller was on their way to. Without it
 * the screen they are leaving stays put until the screen they asked for can
 * paint its own skeleton — one skeleton per navigation, and it belongs to the
 * destination.
 *
 * What that trades away is the feeling that the tap registered, which this buys
 * back. The global reduced-motion rule collapses the animation to nothing; the
 * bar still appears, because its presence rather than its movement is the
 * message.
 */
function RouteProgress() {
  const t = useTranslations('app');
  const pathname = usePathname();
  // `useSearchParams` hands back a fresh object every render, so the effect
  // below keys on what it says rather than on which object said it — otherwise
  // it clears the bar on the render that raised it.
  const search = useSearchParams().toString();
  const [pending, setPending] = useState(false);

  // These update when the destination commits, not when the URL changes, so
  // this is the moment the traveller actually has the next screen.
  useEffect(() => {
    setPending(false);
  }, [pathname, search]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.hasAttribute('download')) return;
      if (anchor.target && anchor.target !== '_self') return;

      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      // A link back to where the traveller already is resolves instantly, and a
      // bar for it would be noise.
      if (
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search
      ) {
        return;
      }

      setPending(true);
    }

    // A back or forward gesture ends whatever was in flight.
    function onPopState() {
      setPending(false);
    }

    // Capture, because `next/link` calls `preventDefault` on its way up and a
    // bubble-phase listener would only ever see navigations it had already
    // decided to ignore.
    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPopState);

    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  // A link that opens something instead of navigating would otherwise leave the
  // bar running for the rest of the session.
  useEffect(() => {
    if (!pending) return;

    const timer = window.setTimeout(() => setPending(false), STALE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [pending]);

  if (!pending) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-[var(--layer-notice)] h-0.5 overflow-hidden"
      role="status"
    >
      <span className="sr-only">{t('navigating')}</span>
      <span
        aria-hidden="true"
        className="block h-full w-2/5 animate-[trove-route-progress_1.1s_var(--ease-standard)_infinite] rounded-full bg-brand"
      />
    </div>
  );
}

export function PageTransition({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <>
      {/* `useSearchParams` opts its reader out of static rendering, so the bar
          reads it behind its own boundary rather than dragging every route with
          it. */}
      <Suspense fallback={null}>
        <RouteProgress />
      </Suspense>
      {children}
    </>
  );
}
