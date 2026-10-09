'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, Ellipsis, Pencil, Share2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { TripCountries } from '@/components/trip-countries';
import { TripForm } from '@/components/trip-form';
import { TripHeaderDetails } from '@/components/trip-header-details';
import { TripMedia } from '@/components/trip-media';
import { TripShareDialog } from '@/components/trip-share-dialog';
import { useTripContext } from '@/components/trip-provider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import { ITINERARY_EDIT_QUERY_ROOTS, invalidateTripQueries } from '@/lib/query/trip-invalidation';
import type { Trip } from '@/lib/trips/api';
import {
  supportingTripDestinations,
  tripSectionFromPathname,
  tripSectionLabelKey,
  tripTabDestinations,
  type TripDestination,
} from '@/lib/trips/navigation';
import { cn } from '@/lib/utils';
import { tripSectionIcons } from '@/lib/icons';

type TripChromeSlots = {
  /** The section toolbar's leading edge: a screen's view control, or its guidance. */
  leadingSlot: HTMLElement | null;
  /** The section toolbar's trailing edge: the actions that belong to the screen. */
  actionsSlot: HTMLElement | null;
};

const TripChromeContext = createContext<TripChromeSlots | null>(null);

export function useTripChrome() {
  return useContext(TripChromeContext);
}

/**
 * Whether a saved edit moved anything the plan below the chrome is built from.
 *
 * A new date range adds and removes itinerary days and pushes what no longer
 * fits into Unscheduled, and destinations, the reference time zone and
 * readiness each feed a screen or a score. Renaming a trip or swapping its
 * cover feeds none of them — and the roots this gates are provider-billable, so
 * a rename must not buy a fresh set of travel legs.
 */
function movesThePlan(before: Trip, after: Trip) {
  return (
    before.startDate !== after.startDate ||
    before.endDate !== after.endDate ||
    before.referenceTimeZone !== after.referenceTimeZone ||
    before.planningReadiness !== after.planningReadiness ||
    before.destinations.map((entry) => entry.name).join('\u0000') !==
      after.destinations.map((entry) => entry.name).join('\u0000') ||
    // The header names the country now, so an edit that changes only that has
    // to reach it - otherwise the chrome keeps showing the old one.
    (before.countries ?? []).join('\u0000') !== (after.countries ?? []).join('\u0000')
  );
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
  const share = useTranslations('trips.share');
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const context = useTripContext();
  const trip = context?.trip ?? null;
  const editorial = context?.editorial ?? null;

  const [leadingSlot, setLeadingSlot] = useState<HTMLElement | null>(null);
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const [sharing, setSharing] = useState(false);
  const [editing, setEditing] = useState(false);

  const currentSection = tripSectionFromPathname(pathname, tripId);
  const stickyNavigation = currentSection === 'itinerary';

  const lifecycle = trip?.lifecycle ?? 'planning';
  // Trip Mode and Memories each open as an experience of their own, so the row
  // that moves between this trip's sections carries only the planner.
  const primary = tripTabDestinations(tripId, lifecycle, trip?.startDate ?? '');
  const supporting = supportingTripDestinations(tripId);
  const activeSupporting = supporting.find((entry) => entry.section === currentSection);
  const onCoreExperience = primary.some((entry) => entry.section === currentSection);
  // Every supporting screen names itself, even when reached through a direct link.
  const currentLabel = activeSupporting
    ? t(activeSupporting.labelKey)
    : onCoreExperience
      ? undefined
      : currentSection
        ? t(tripSectionLabelKey(currentSection))
        : undefined;

  // The saved trip goes straight back into the query the whole subtree reads,
  // so the cover and the dates update without a second fetch. What the trip's
  // own screens read is a separate question: the overview renders none of it and
  // could stop at `setTrip`, but from here the itinerary is directly below.
  function handleSaved(saved: Trip) {
    const previous = trip;
    context?.setTrip(saved);
    setEditing(false);

    if (previous && movesThePlan(previous, saved)) {
      void invalidateTripQueries(queryClient, tripId, ITINERARY_EDIT_QUERY_ROOTS);
    }
  }

  const slots = useMemo<TripChromeSlots>(
    () => ({ actionsSlot, leadingSlot }),
    [actionsSlot, leadingSlot],
  );

  return (
    <TripChromeContext.Provider value={slots}>
      {/* The chrome owns the page container that each screen used to declare for
          itself, so the cover, the nav row and the screen below them share one
          measure and one rhythm. The rhythm is written as margins on each piece
          rather than `space-y`: on a phone's itinerary the header is flattened to
          `contents`, and a collapsed toolbar must not leave its gap behind. */}
      <div className="mx-auto w-full max-w-5xl">
        {/* A sticky child is bounded by the height of its nearest box ancestor. On
          itinerary, flatten this header at mobile widths so the unchanged
          navigation row stays anchored to the full planning section. Desktop
          keeps the ordinary header box and flow. */}
        <header className={cn(stickyNavigation && 'contents md:block')} data-slot="trip-chrome">
          {/* On mobile, every trip section and the hub use the same cover height
            and overlapping sheet. Desktop keeps the planner's compact band. */}
          <section
            aria-labelledby="trip-section-cover-heading"
            className={cn(
              '-mx-[var(--gutter-inline-start)] -mt-8 md:mx-0 md:mt-0',
              stickyNavigation && 'md:[--trip-cover-height:12rem]',
            )}
          >
            <div className="relative isolate">
              <TripMedia
                alt={trip ? t('coverImageAlt', { name: trip.name }) : ''}
                className="rounded-none md:rounded-t-[var(--radius-2xl)] md:rounded-b-none"
                preload
                sizes="(max-width: 1023px) 100vw, 1024px"
                source={resolveTripMediaSource({ coverUrl: trip?.coverPhotoUrl, editorial })}
                variant="cover"
              />
              <div className="pointer-events-none absolute inset-0 rounded-none bg-gradient-to-t from-surface-overlay/85 from-0% to-transparent to-42% md:rounded-t-[var(--radius-2xl)]" />
              <Link
                aria-label={t('backToTrips')}
                className="absolute top-[max(1rem,var(--safe-top))] left-[max(1rem,var(--safe-left))] z-10 flex size-10 items-center justify-center rounded-full border border-media-fallback-foreground/18 bg-neutral-950/58 text-media-fallback-foreground backdrop-blur-sm outline-none transition-colors hover:bg-neutral-950/78 focus-visible:ring-3 focus-visible:ring-ring/50"
                href="/trips"
              >
                <ArrowLeft aria-hidden="true" className="size-4" />
              </Link>
            </div>

            <div className="relative -mt-8 rounded-t-[var(--trip-sheet-radius)] bg-background px-[var(--gutter-inline-start)] pt-6 md:-mt-10 md:px-7 md:pt-7">
              {/* The cover and metadata reserve their room before the trip's
                photograph and labels arrive. */}
              {/* The same eyebrow the trip's overview carries, so the country
                  does not disappear the moment a traveller moves from Overview
                  into the planner. A trip from before the field existed keeps
                  the space rather than showing an empty line. */}
              {trip ? (
                trip.countries?.length ? (
                  <TripCountries
                    className="text-xs font-medium tracking-[0.1em] text-brand uppercase"
                    countries={trip.countries}
                  />
                ) : null
              ) : (
                <Skeleton className="inline-block h-4 w-24" />
              )}
              {trip ? (
                <h1
                  className="mt-2 text-[length:var(--text-page-title)] leading-[1.08] font-semibold tracking-[-0.035em] text-balance break-words text-foreground md:text-4xl"
                  id="trip-section-cover-heading"
                >
                  {trip.name}
                </h1>
              ) : (
                <div aria-busy="true" aria-live="polite" className="mt-2" role="status">
                  <span className="sr-only">{t('titleLoading')}</span>
                  <Skeleton className="h-[calc(var(--text-page-title)*1.08)] w-3/5 max-w-sm md:h-[calc(2.25rem*1.08)]" />
                </div>
              )}
              {trip ? (
                <TripHeaderDetails trip={trip} />
              ) : (
                <div
                  className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1"
                  aria-hidden="true"
                >
                  <Skeleton className="h-5 w-36" />
                  <Skeleton className="h-5 w-10" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              )}
            </div>
          </section>

          <div
            className={cn(
              'mt-5 flex items-center justify-between gap-2 border-b border-border-subtle',
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
                {supporting.map((destination) => {
                  const SectionIcon = tripSectionIcons[destination.section];

                  return (
                    <DropdownMenuLinkItem
                      aria-current={destination.section === currentSection ? 'page' : undefined}
                      key={destination.section}
                      render={<Link href={destination.href} />}
                    >
                      <SectionIcon aria-hidden="true" />
                      {t(destination.labelKey)}
                    </DropdownMenuLinkItem>
                  );
                })}
                {/* Sharing belongs to the trip rather than to any one section,
                    and the overflow menu is the only control in the chrome that
                    already does. It waits for the trip: there is nothing to
                    publish until its id and current visibility have landed. */}
                {trip ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setEditing(true)}>
                      <Pencil aria-hidden="true" data-icon="inline-start" />
                      {t('editTrip')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSharing(true)}>
                      <Share2 aria-hidden="true" data-icon="inline-start" />
                      {share('action')}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* The section toolbar: the screen's own view control or guidance on
            the leading edge, its actions on the trailing edge, directly under
            the navigation it belongs to. A screen with nothing to put here gets
            no row at all - margin included - so its content starts under the
            tabs. On a phone's itinerary it is a sibling of the sticky navigation
            rather than a wrapper, which would end the navigation's stickiness. */}
          <div
            className="mt-3 hidden min-h-11 items-center gap-3 has-[>*>*]:flex"
            data-slot="trip-section-toolbar"
          >
            <div className="flex min-w-0 flex-1 items-center" ref={setLeadingSlot} />
            <div className="ml-auto flex shrink-0 items-center gap-2" ref={setActionsSlot} />
          </div>
        </header>

        <div className="mt-5 md:mt-7">{children}</div>

        {/* Both of these act on the trip rather than on any one screen, which
            is why they hang off the chrome. Each writes its result straight
            back into the trip the whole subtree already reads, so the change is
            reflected without a second fetch. */}
        {trip ? (
          <>
            <TripShareDialog
              onOpenChange={setSharing}
              onTripChange={(updated) => context?.setTrip(updated)}
              open={sharing}
              trip={trip}
            />

            {/* Deleting is left to the overview. A trip deleted from inside one
                of its own screens leaves the traveller standing on a route that
                no longer resolves. */}
            <Sheet onOpenChange={(open) => !open && setEditing(false)} open={editing}>
              <SheetContent
                className="w-full md:data-[side=right]:w-[min(44rem,calc(100%-0.5rem))]"
                closeLabel={t('close')}
              >
                <SheetHeader className="border-b">
                  <SheetTitle>{t('editTitle')}</SheetTitle>
                  <SheetDescription>{t('editDescription')}</SheetDescription>
                </SheetHeader>
                {editing ? (
                  <TripForm
                    key={trip.id}
                    onCancel={() => setEditing(false)}
                    onSaved={handleSaved}
                    trip={trip}
                  />
                ) : null}
              </SheetContent>
            </Sheet>
          </>
        ) : null}
      </div>
    </TripChromeContext.Provider>
  );
}
