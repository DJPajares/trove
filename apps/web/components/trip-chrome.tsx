'use client';

import { CircleAlert, Ellipsis } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { TripActionFeedback, TripActionsProvider } from '@/components/trip-actions-provider';
import { PageState } from '@/components/page-state';
import { TripHubBar } from '@/components/trip-hub/trip-hub-bar';
import { TripHubCover, TripHubCoverSkeleton } from '@/components/trip-hub/trip-hub-cover';
import { TripTabs } from '@/components/trip-tabs';
import { useTripContext } from '@/components/trip-provider';
import { Button } from '@/components/ui/button';
import * as Icons from '@/lib/icons';
import { tripSectionFromPathname } from '@/lib/trips/navigation';
import { overviewLifecycle, tripHubStage } from '@/lib/trips/overview';
import { useTripOverview } from '@/lib/trips/use-trip-overview';
import { cn } from '@/lib/utils';

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

/** The cover, navigation and actions stay mounted between the trip's sections. */
export function TripChrome({
  children,
  tripId,
}: Readonly<{ children: ReactNode; tripId: string }>) {
  const t = useTranslations('trips');
  const pathname = usePathname();
  const context = useTripContext();
  const loadedTrip = context?.trip ?? null;
  const trip = loadedTrip
    ? { ...loadedTrip, lifecycle: overviewLifecycle(loadedTrip, new Date()) }
    : null;
  const overviewQuery = useTripOverview(tripId, Boolean(trip));
  const [leadingSlot, setLeadingSlot] = useState<HTMLElement | null>(null);
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const stickyNavigation = tripSectionFromPathname(pathname, tripId) === 'itinerary';
  const slots = useMemo<TripChromeSlots>(
    () => ({ actionsSlot, leadingSlot }),
    [actionsSlot, leadingSlot],
  );

  if (!trip && (context?.status === 'missing' || context?.status === 'error')) {
    const failed = context.status === 'error';
    return (
      <PageState
        actions={
          <>
            {failed ? <Button onClick={() => context.refresh()}>{t('tryAgain')}</Button> : null}
            <Button
              nativeButton={false}
              render={<Link href="/trips" />}
              variant={failed ? 'outline' : 'default'}
            >
              {t('backToTrips')}
            </Button>
          </>
        }
        description={failed ? t('loadErrorDescription') : t('tripNotFoundDescription')}
        icon={failed ? <CircleAlert aria-hidden="true" /> : <Icons.Trips aria-hidden="true" />}
        kind={failed ? 'error' : 'empty'}
        scope="page"
        title={failed ? t('tripLoadError') : t('tripNotFound')}
      />
    );
  }

  const content = (
    <div className="mx-auto w-full max-w-5xl">
      {/* Flatten the mobile itinerary header so its sticky row is bounded by
          the full planning section, rather than just the photograph. */}
      <header className={cn(stickyNavigation && 'contents md:block')} data-slot="trip-chrome">
        <div className="-mx-[var(--gutter-inline-start)] -mt-8 lg:mx-0 lg:mt-0">
          {trip ? (
            <TripHubCover
              editorial={context?.editorial ?? null}
              layout="section"
              onCoverExpired={() => context?.refresh()}
              overview={overviewQuery.data}
              stage={tripHubStage(trip, new Date())}
              trip={trip}
            />
          ) : (
            <TripHubCoverSkeleton label={t('titleLoading')} layout="section" />
          )}
        </div>
        <div
          className={cn(
            'relative -mx-[var(--gutter-inline-start)] -mt-8 rounded-t-[var(--trip-sheet-radius)] bg-background px-[var(--gutter-inline-start)] pt-2 lg:mx-0 lg:mt-4 lg:rounded-none lg:px-0 lg:pt-0',
            stickyNavigation &&
              'sticky top-[calc(var(--safe-top)+var(--header-offset))] z-[var(--layer-sticky)] md:static md:z-auto',
          )}
        >
          {trip ? (
            <TripHubBar overview={overviewQuery.data} trip={trip} />
          ) : (
            <div className="flex items-center justify-between gap-2 border-b border-border-subtle">
              <TripTabs lifecycle="planning" startDate="" tripId={tripId} />
              <div className="flex shrink-0 items-center gap-1">
                <Button className="rounded-full" disabled size="sm" variant="outline">
                  {t('tripTools')}
                </Button>
                <Button aria-label={t('tripActions')} disabled size="icon" variant="ghost">
                  <Ellipsis aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}
        </div>
        <div
          className="mt-3 hidden min-h-11 items-center gap-3 has-[>*>*]:flex"
          data-slot="trip-section-toolbar"
        >
          <div className="flex min-w-0 flex-1 items-center" ref={setLeadingSlot} />
          <div className="ml-auto flex shrink-0 items-center gap-2" ref={setActionsSlot} />
        </div>
      </header>
      {trip ? <TripActionFeedback /> : null}
      <div className="mt-5 md:mt-7">{children}</div>
    </div>
  );

  return (
    <TripChromeContext.Provider value={slots}>
      {trip ? <TripActionsProvider trip={trip}>{content}</TripActionsProvider> : content}
    </TripChromeContext.Provider>
  );
}
