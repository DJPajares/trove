'use client';

import { ArrowLeft, CalendarDays, Clock3, Eye, Map, MapPinned } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';

import { NavActiveIndicator } from '@/components/nav-active-indicator';
import { usePreferences } from '@/components/preferences-provider';
import { Skeleton } from '@/components/ui/skeleton';
import { useNowTick } from '@/hooks/use-now-tick';
import { useHereWeather } from '@/lib/home/use-here-weather';
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
 * One slim row, and everything in it earns its place.
 *
 * What this deliberately does not carry: the trip's cover photograph, the words
 * "TRIP MODE", the country, and the date range. A traveller reading this is
 * standing in the trip - they know which one it is - and on a 390px phone that
 * block cost most of the first screen, pushing the answer to "what now?" below
 * the fold. The trip's name stays as a quiet anchor.
 *
 * What replaces it is the clock. What time it is where the traveller is
 * standing is the one fact on this screen they cannot supply themselves, and it
 * was previously body copy three sections down.
 *
 * The place under it is where the device says they are, resolved to a real
 * name by the server. It used to be read off the IANA zone, which named a
 * region rather than a place - so a traveller in Whangarei was told Auckland.
 * With no shared position there is no name, and the clock stands alone.
 *
 * In Preview the clock would be a fiction, so it gives way to the Preview mark:
 * nobody is standing in a day that has not happened.
 */
export function TripModeTopBar({
  isPreview = false,
  timeZone,
  tripId,
  tripName,
}: Readonly<{
  isPreview?: boolean;
  timeZone: string | null;
  tripId: string;
  tripName: string | null;
}>) {
  const t = useTranslations('tripMode');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const now = useNowTick(!isPreview);
  // Where the traveller actually is, not the city their time zone is named
  // after - Pacific/Auckland said "Auckland" to everyone in New Zealand. The
  // reading is already being fetched for the strip on Home, so this is the same
  // query rather than a second one, and it is null rather than a guess whenever
  // location has not been shared.
  const { weather } = useHereWeather();
  const city = isPreview ? null : (weather?.city ?? null);
  const clock =
    timeZone && !isPreview
      ? new Intl.DateTimeFormat(locale, {
          hour: 'numeric',
          hour12: preferences.timeFormat === '12h',
          minute: '2-digit',
          timeZone,
        }).format(now)
      : null;

  return (
    <div
      className="sticky top-[calc(var(--safe-top)+var(--header-offset))] z-[var(--layer-sticky)] -mx-[var(--gutter-inline-start)] flex min-h-13 items-center gap-3 border-b border-border-subtle bg-background/95 ps-[var(--gutter-inline-start)] pe-[3.25rem] backdrop-blur supports-[backdrop-filter]:bg-background/88 sm:pe-[var(--gutter-inline-end)]"
      data-slot="trip-mode-top-bar"
      data-translucent-surface
    >
      <Link
        className="-ms-2 inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-sm font-medium text-muted-foreground outline-none transition-colors duration-[var(--motion-standard)] ease-[var(--ease-standard)] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none"
        // Back to the trip this mode belongs to, not to the whole library. A
        // traveller who opened Trip Mode from their trip could not previously
        // get back to it in one tap.
        href={`/trips/${tripId}`}
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('exit')}
      </Link>

      {tripName ? (
        <p className="min-w-0 flex-1 truncate text-center text-[length:var(--text-metadata)] font-medium text-muted-foreground">
          {tripName}
        </p>
      ) : (
        <div className="flex min-w-0 flex-1 justify-center">
          <Skeleton className="h-[length:var(--text-metadata)] w-28" />
        </div>
      )}

      {isPreview ? (
        <p className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent-strong/8 px-2.5 py-1 text-[length:var(--text-metadata)] font-semibold tracking-[0.06em] text-accent-strong uppercase">
          <Eye aria-hidden="true" className="size-3.5" />
          {t('preview.badge')}
        </p>
      ) : clock ? (
        <p className="shrink-0 text-end text-[length:var(--text-metadata)] leading-4">
          <span className="block font-semibold text-foreground tabular-nums">{clock}</span>
          {city ? <span className="block text-text-subtle">{city}</span> : null}
        </p>
      ) : (
        <Skeleton className="h-8 w-14 shrink-0" />
      )}
    </div>
  );
}
