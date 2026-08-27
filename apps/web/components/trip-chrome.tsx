'use client';

import { ArrowLeft, ChevronDown, Ellipsis } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { TripMedia } from '@/components/trip-media';
import { useTripContext } from '@/components/trip-provider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { resolveTripMediaSource, type TripMediaSource } from '@/lib/media/trip-media';
import {
  primaryTripDestinations,
  supportingTripDestinations,
  tripSectionFromPathname,
  tripSectionLabelKey,
  visibleTripNavigationDestinations,
  type TripDestination,
  type TripSection,
} from '@/lib/trips/navigation';
import { cn } from '@/lib/utils';

type TripChromeSlots = {
  /** Where a screen renders the actions that belong to it, above the nav row. */
  actionsSlot: HTMLElement | null;
  /** Where a screen renders the standing guidance that sits below the nav row. */
  descriptionSlot: HTMLElement | null;
  /** Where a screen renders a control onto the cover itself. */
  coverMetaSlot: HTMLElement | null;
  setCoverSource: (source: TripMediaSource | null) => void;
};

const TripChromeContext = createContext<TripChromeSlots | null>(null);

export function useTripChrome() {
  return useContext(TripChromeContext);
}

/**
 * Itinerary is a working screen rather than a page about a trip: the nav row
 * follows the traveller down a long plan, and the trip's name is orientation
 * rather than a headline. That is a property of the section, and the chrome is
 * now the only thing that knows which section is on screen.
 */
function sectionDensity(section: TripSection | null) {
  return section === 'itinerary' ? 'compact' : 'default';
}

function emphasisClasses(destination: TripDestination, active: boolean) {
  if (active) return 'text-foreground';
  if (destination.emphasis === 'leading') {
    return 'text-foreground hover:bg-surface-hover';
  }
  if (destination.emphasis === 'quiet') {
    return 'text-text-subtle hover:bg-surface-hover hover:text-foreground';
  }
  return 'text-muted-foreground hover:bg-surface-hover hover:text-foreground';
}

/**
 * The chrome every screen inside a trip shares — the cover and the navigation
 * between the trip's experiences — mounted once by the layout.
 *
 * Two things follow from it living here rather than inside each screen. The
 * cover is not unmounted and re-faded every time the traveller changes tab. And
 * it holds its full height from the very first frame, before the trip has
 * loaded: what arrives with the trip is the photograph and the name, never the
 * space they occupy. A cover that appears is a cover that pushes the
 * traveller's plan down the screen, and that is the whole reason this moved.
 */
export function TripChrome({
  children,
  tripId,
}: Readonly<{ children: ReactNode; tripId: string }>) {
  const t = useTranslations('trips');
  const locale = useLocale();
  const pathname = usePathname();
  const context = useTripContext();
  const trip = context?.trip ?? null;
  const editorial = context?.editorial ?? null;

  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const [descriptionSlot, setDescriptionSlot] = useState<HTMLElement | null>(null);
  const [coverMetaSlot, setCoverMetaSlot] = useState<HTMLElement | null>(null);
  const [coverSource, setCoverSource] = useState<TripMediaSource | null>(null);

  const currentSection = tripSectionFromPathname(pathname, tripId);
  const density = sectionDensity(currentSection);
  const stickyNavigation = currentSection === 'itinerary';

  const lifecycle = trip?.lifecycle ?? 'planning';
  const primary = visibleTripNavigationDestinations(
    primaryTripDestinations(tripId, lifecycle, trip?.startDate ?? ''),
  );
  const supporting = supportingTripDestinations(tripId);
  const activeSupporting = supporting.find((entry) => entry.section === currentSection);
  const onCoreExperience = primary.some((entry) => entry.section === currentSection);
  // Places is reached from the itinerary rather than from the menu, so it belongs to
  // neither set. It is still a screen the traveller can be standing on, and a header
  // that reads "More" there tells them nothing about where they are.
  const currentLabel = activeSupporting
    ? t(activeSupporting.labelKey)
    : onCoreExperience
      ? undefined
      : currentSection
        ? t(tripSectionLabelKey(currentSection))
        : undefined;

  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(`${value}T00:00:00.000Z`),
    );

  const slots = useMemo<TripChromeSlots>(
    () => ({ actionsSlot, coverMetaSlot, descriptionSlot, setCoverSource }),
    [actionsSlot, coverMetaSlot, descriptionSlot],
  );

  return (
    <TripChromeContext.Provider value={slots}>
      {/* The chrome owns the page container that each screen used to declare for
          itself, so the cover, the nav row and the screen below them share one
          measure and one rhythm. */}
      <div className="mx-auto w-full max-w-5xl space-y-7">
        {/* A sticky child is bounded by the height of its nearest box ancestor. On
          itinerary, flatten this header at mobile widths so the unchanged
          navigation row stays anchored to the full planning section. Desktop
          keeps the ordinary header box and flow. */}
        <header
          className={cn(
            stickyNavigation && 'contents md:block',
            'space-y-5',
            density === 'compact' && 'space-y-3 sm:space-y-5',
          )}
          data-density={density}
          data-slot="trip-chrome"
        >
          <section
            aria-labelledby="trip-section-cover-heading"
            className="relative isolate -mx-[var(--gutter-inline-start)] -mt-8 md:mx-0 md:mt-0"
          >
            <TripMedia
              alt={trip ? t('coverImageAlt', { name: trip.name }) : ''}
              className="rounded-none md:rounded-[var(--radius-2xl)]"
              preload
              sizes="(max-width: 1023px) 100vw, 1024px"
              source={
                coverSource ?? resolveTripMediaSource({ coverUrl: trip?.coverPhotoUrl, editorial })
              }
              variant="cover"
            />
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-end gap-2 rounded-none bg-gradient-to-t from-surface-overlay from-20% via-surface-overlay/55 to-transparent p-5 md:rounded-[var(--radius-2xl)] md:p-7">
              {/* The name and the dates are the only part of the cover that waits
                on the trip, and they wait inside boxes the right size, so the
                answer arriving never moves anything below. */}
              {trip ? (
                <>
                  <h1
                    className="text-[length:var(--text-page-title)] leading-[1.08] font-semibold tracking-[-0.035em] text-pretty text-media-fallback-foreground"
                    id="trip-section-cover-heading"
                  >
                    {trip.name}
                  </h1>
                  <p className="text-[length:var(--text-metadata)] font-medium text-media-fallback-foreground/85 tabular-nums">
                    {t('dateRange', {
                      endDate: formatDate(trip.endDate),
                      startDate: formatDate(trip.startDate),
                    })}
                    {' · '}
                    {t(`lifecycle.${trip.lifecycle}`)}
                  </p>
                </>
              ) : (
                <div aria-busy="true" aria-live="polite" role="status">
                  <span className="sr-only">{t('titleLoading')}</span>
                  <Skeleton className="h-[calc(var(--text-page-title)*1.08)] w-3/5 max-w-sm bg-media-fallback-foreground/20" />
                  <Skeleton className="mt-2 h-[length:var(--text-metadata)] w-2/5 max-w-56 bg-media-fallback-foreground/20" />
                </div>
              )}
              <div className="pointer-events-auto -ml-1 empty:hidden" ref={setCoverMetaSlot} />
            </div>
            <Link
              aria-label={t('backToTrips')}
              className="absolute top-[max(1rem,var(--safe-top))] left-[max(1rem,var(--safe-left))] z-10 flex size-10 items-center justify-center rounded-full border border-media-fallback-foreground/18 bg-neutral-950/58 text-media-fallback-foreground backdrop-blur-sm outline-none transition-colors hover:bg-neutral-950/78 focus-visible:ring-3 focus-visible:ring-ring/50"
              href="/trips"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
            </Link>
          </section>

          {/* Held open at one control's height — the same 44px minimum every
            touch target in Trove gets — so a screen filling it on the frame
            after mount costs nothing below it. */}
          <div
            className="flex min-h-11 shrink-0 flex-wrap items-center justify-end gap-2"
            ref={setActionsSlot}
          />

          <div
            className={cn(
              'flex items-center justify-between gap-2 border-b border-border-subtle',
              stickyNavigation &&
                'sticky top-[calc(var(--safe-top)+var(--header-offset))] z-[var(--layer-sticky)] bg-background backdrop-blur md:static md:z-auto md:bg-transparent md:backdrop-blur-none',
            )}
          >
            <nav aria-label={t('tripNavigation')} className="min-w-0">
              {/* `overflow-x-auto` also clips vertically, which would cut the tabs'
                focus ring. The negative margin buys it room without moving the
                margin box, so each tab's active underline stays welded to the
                section border below. */}
              <ul className="-m-1 flex items-center gap-1 overflow-x-auto p-1">
                {primary.map((destination) => {
                  const active = destination.section === currentSection;
                  return (
                    <li key={destination.section}>
                      <Link
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'relative inline-flex min-h-11 items-center whitespace-nowrap px-3 text-sm font-medium outline-none transition-colors duration-[var(--motion-standard)] after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent focus-visible:ring-3 focus-visible:ring-ring/40',
                          active && 'after:bg-brand',
                          emphasisClasses(destination, active),
                        )}
                        href={destination.href}
                      >
                        {t(destination.labelKey)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    // The accessible name has to contain the visible one, so when the
                    // trigger reads "Expenses" the label leads with it.
                    aria-label={
                      currentLabel
                        ? t('moreLabelCurrent', { section: currentLabel })
                        : t('moreLabel')
                    }
                    className={cn(
                      'shrink-0',
                      currentLabel ? 'bg-secondary text-secondary-foreground' : undefined,
                    )}
                    size="sm"
                    type="button"
                    variant="ghost"
                  />
                }
              >
                {/* Icon or name, never both — the row is tight at 375px. Off the core
                  experiences the name always shows, because it is the only thing telling
                  the traveller where they are. */}
                {currentLabel ? null : <Ellipsis aria-hidden="true" data-icon="inline-start" />}
                <span className={currentLabel ? undefined : 'hidden sm:inline'}>
                  {currentLabel ?? t('more')}
                </span>
                <ChevronDown aria-hidden="true" data-icon="inline-end" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{t('supportingTools')}</DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                {supporting.map((destination) => (
                  <DropdownMenuLinkItem
                    aria-current={destination.section === currentSection ? 'page' : undefined}
                    key={destination.section}
                    render={<Link href={destination.href} />}
                  >
                    {t(destination.labelKey)}
                  </DropdownMenuLinkItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div ref={setDescriptionSlot} />
        </header>

        {children}
      </div>
    </TripChromeContext.Provider>
  );
}
