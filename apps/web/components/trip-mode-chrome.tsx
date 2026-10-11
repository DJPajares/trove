'use client';

import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { isNavigationPathActive } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import * as Icons from '@/lib/icons';

export const tripModeViews = [
  { icon: Icons.Now, key: 'now', path: '' },
  { icon: Icons.Itinerary, key: 'today', path: '/today' },
  { icon: Icons.MapView, key: 'map', path: '/map' },
  { icon: Icons.Trips, key: 'trip', path: '/trip' },
] as const;

/**
 * The bar a traveller navigates Trip Mode with, in the thumb's reach.
 *
 * Trip Mode is used one-handed, outdoors, while walking, and its four views are
 * the only places it can go - so they belong at the bottom of the phone rather
 * than as a segmented control above the fold. The global bar steps aside for
 * this one inside `/mode` (see `primary-navigation`), which is what stops the
 * screen carrying two navigations stacked on each other.
 *
 * Global navigation is never further than the Exit in the bar above, on every
 * view and every size.
 *
 * Shared between the loading frame and the loaded shell so the row does not
 * move when the trip arrives; `withPreviewHref` defaults to identity because
 * the loading frame has no preview plumbing yet.
 */
export function TripModeTabBar({
  tripId,
  withPreviewHref = (href: string) => href,
}: Readonly<{ tripId: string; withPreviewHref?: (href: string) => string }>) {
  const t = useTranslations('tripMode');
  const pathname = usePathname();
  const basePath = `/trips/${tripId}/mode`;

  return (
    <nav
      aria-label={t('navigation')}
      className="fixed inset-x-0 bottom-0 z-[var(--layer-sticky)] border-t border-border-subtle bg-background/95 pb-[var(--safe-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/88 lg:sticky lg:top-[calc(var(--safe-top)+var(--header-offset)+3.25rem)] lg:mx-auto lg:w-full lg:max-w-6xl lg:rounded-[var(--radius-lg)] lg:border lg:bg-background/95 lg:pb-0"
      data-slot="trip-mode-tabs"
      data-translucent-surface
    >
      {/* `pt-2` is load-bearing: the active mark hangs from the bar's top edge
          by cancelling exactly this padding. */}
      <ul className="mx-auto grid w-full max-w-6xl grid-cols-4 px-[var(--gutter-inline-start)] lg:gap-1 lg:p-1">
        {tripModeViews.map(({ icon: Icon, key, path }) => {
          const href = `${basePath}${path}`;
          // Now owns the bare path, so prefix matching would light it up on
          // every other view. It alone wants an exact match; the rest accept a
          // nested route they may one day grow.
          const active = path ? isNavigationPathActive(pathname, href) : pathname === href;

          return (
            <li key={key}>
              <Link
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative isolate flex min-h-[3.25rem] flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] px-2 pt-1.5 pb-2 text-[length:var(--text-metadata)] font-medium outline-none transition-colors duration-[var(--motion-standard)] ease-[var(--ease-standard)] focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none lg:min-h-11 lg:flex-row lg:gap-1.5 lg:py-1.5',
                  active
                    ? 'font-semibold text-secondary-foreground [--icon-stroke:var(--icon-stroke-emphasis)] lg:bg-secondary lg:font-medium'
                    : 'text-muted-foreground hover:text-foreground lg:hover:bg-surface-hover',
                )}
                href={withPreviewHref(href)}
              >
                {/* Colour alone cannot carry this: the selected tab would
                    dissolve into its neighbours in greyscale. The filled pill
                    behind the icon is the second channel WCAG 1.4.1 asks for.
                    At `lg:` the whole tab is the pill, so the icon's own steps
                    down. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-[var(--motion-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none lg:h-auto lg:w-auto lg:bg-transparent',
                    active && 'bg-secondary',
                  )}
                >
                  <Icon className="size-5 lg:size-4" />
                </span>
                <span>{t(`views.${key}.label`)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Whether the page has scrolled at all. Read once per frame: scroll fires far
 * more often than this answer changes.
 */
function usePageScrolled() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let frame: number | null = null;
    const read = () => {
      frame = null;
      setScrolled(window.scrollY > 4);
    };
    const handleScroll = () => {
      if (frame === null) frame = window.requestAnimationFrame(read);
    };

    read();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  return scrolled;
}

/**
 * Exit and the trip's name are the header's two anchors. Equal side rails keep
 * the name centered across the screen and leave room for the menu FAB. Preview
 * identifies itself in its day/time controls beneath this shared row.
 *
 * At rest the bar has no fill and no rule: it sits on the page, and Exit's own
 * pill is what makes it a control. It stays pinned, because the way out has to
 * be visible from anywhere (PRD 4.5), so once content passes under it a soft
 * fill fades in - otherwise the trip's name would sit on top of whatever text
 * was scrolling by. Over the map, which never scrolls, the name carries a pill
 * of its own instead.
 */
export function TripModeTopBar({
  tripId,
  tripName,
}: Readonly<{
  tripId: string;
  tripName: string | null;
}>) {
  const t = useTranslations('tripMode');
  const pathname = usePathname();
  const scrolled = usePageScrolled();
  const overMap = isNavigationPathActive(pathname, `/trips/${tripId}/mode/map`);
  const filled = scrolled && !overMap;

  return (
    <div
      className={cn(
        'sticky top-[calc(var(--safe-top)+var(--header-offset))] z-[var(--layer-sticky)] -ms-[var(--gutter-inline-start)] -me-[var(--gutter-inline-end)] grid min-h-17 grid-cols-[5rem_minmax(0,1fr)_5rem] items-center px-[max(var(--gutter-inline-start),var(--gutter-inline-end))] transition-[background-color,backdrop-filter] duration-[var(--motion-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none md:min-h-13',
        filled
          ? 'bg-background/92 backdrop-blur supports-[backdrop-filter]:bg-background/85'
          : 'bg-transparent',
      )}
      data-scrolled={filled || undefined}
      data-slot="trip-mode-top-bar"
      data-translucent-surface={filled ? '' : undefined}
    >
      {/* A visible way out, drawn as a control rather than a quiet link:
          outdoors and one-handed, the edge of a word is not a target. */}
      <Link
        className="inline-flex min-h-11 items-center justify-self-start gap-1 rounded-full border border-border bg-card ps-2.5 pe-4 text-sm font-semibold text-foreground shadow-[var(--shadow-control)] outline-none transition-colors duration-[var(--motion-standard)] ease-[var(--ease-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none"
        // Back to the trip this mode belongs to, not to the whole library. A
        // traveller who opened Trip Mode from their trip could not previously
        // get back to it in one tap.
        href={`/trips/${tripId}`}
      >
        <ChevronLeft aria-hidden="true" className="size-4.5" />
        {t('exit')}
      </Link>

      {tripName ? (
        <p
          className={cn(
            'min-w-0 truncate text-center text-base font-semibold text-foreground',
            overMap &&
              'flex h-9 items-center justify-self-center rounded-full bg-background/95 px-3.5 shadow-[var(--shadow-control)]',
          )}
        >
          {overMap ? <span className="min-w-0 truncate">{tripName}</span> : tripName}
        </p>
      ) : (
        <div className="flex min-w-0 justify-center">
          <Skeleton className="h-4 w-28 max-w-full" />
        </div>
      )}
    </div>
  );
}
