'use client';

import { ArrowLeft, CalendarDays, Clock3, Map, MapPinned } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';

import { NavActiveIndicator } from '@/components/nav-active-indicator';
import { Skeleton } from '@/components/ui/skeleton';
import { isNavigationPathActive } from '@/lib/navigation';
import { cn } from '@/lib/utils';

export const tripModeViews = [
  { icon: Clock3, key: 'now', path: '' },
  { icon: CalendarDays, key: 'today', path: '/today' },
  { icon: Map, key: 'map', path: '/map' },
  { icon: MapPinned, key: 'trip', path: '/trip' },
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
                    ? 'font-semibold text-brand lg:bg-secondary lg:font-medium lg:text-secondary-foreground'
                    : 'text-muted-foreground hover:text-foreground lg:hover:bg-surface-hover',
                )}
                href={withPreviewHref(href)}
              >
                {/* Colour alone cannot carry this: brand against muted measures
                    1.20:1, so the selected tab dissolves into its neighbours in
                    greyscale. The mark is the second channel WCAG 1.4.1 asks
                    for, exactly as the app's main bar does it. At `lg:` the
                    filled pill is already that channel, so the mark stands
                    down. */}
                {active ? <NavActiveIndicator className="lg:hidden" /> : null}
                <Icon aria-hidden="true" className="size-5 lg:size-4" />
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
 * Exit and the trip's name are the header's two anchors. Equal side rails keep
 * the name centered across the screen and leave room for the menu FAB. Preview
 * identifies itself in its day/time controls beneath this shared row.
 */
export function TripModeTopBar({
  tripId,
  tripName,
}: Readonly<{
  tripId: string;
  tripName: string | null;
}>) {
  const t = useTranslations('tripMode');

  return (
    <div
      className="sticky top-[calc(var(--safe-top)+var(--header-offset))] z-[var(--layer-sticky)] -ms-[var(--gutter-inline-start)] -me-[var(--gutter-inline-end)] grid min-h-17 grid-cols-[5rem_minmax(0,1fr)_5rem] items-center border-b border-border-subtle bg-background/95 px-[max(var(--gutter-inline-start),var(--gutter-inline-end))] backdrop-blur supports-[backdrop-filter]:bg-background/88 md:min-h-13"
      data-slot="trip-mode-top-bar"
      data-translucent-surface
    >
      <Link
        className="-ms-2 inline-flex min-h-11 items-center justify-self-start gap-1.5 rounded-[var(--radius-md)] px-2 text-sm font-medium text-muted-foreground outline-none transition-colors duration-[var(--motion-standard)] ease-[var(--ease-standard)] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none"
        // Back to the trip this mode belongs to, not to the whole library. A
        // traveller who opened Trip Mode from their trip could not previously
        // get back to it in one tap.
        href={`/trips/${tripId}`}
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('exit')}
      </Link>

      {tripName ? (
        <p className="min-w-0 truncate text-center text-[length:var(--text-metadata)] font-medium text-muted-foreground">
          {tripName}
        </p>
      ) : (
        <div className="flex min-w-0 justify-center">
          <Skeleton className="h-[length:var(--text-metadata)] w-28 max-w-full" />
        </div>
      )}
    </div>
  );
}
