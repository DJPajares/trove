'use client';

import { ArrowLeft, CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { PageState } from '@/components/page-state';
import { PlannerRibbon } from '@/components/planner/planner-ribbon';
import { TripActionsProvider, TripActionFeedback } from '@/components/trip-actions-provider';
import { TripDetailSkeleton } from '@/components/trip-detail-skeleton';
import { TripHubBar } from '@/components/trip-hub/trip-hub-bar';
import { TripNavigationSheet } from '@/components/trip-hub/trip-navigation-sheet';
import { TripHubChapter } from '@/components/trip-hub/trip-hub-chapter';
import { TripHubCover } from '@/components/trip-hub/trip-hub-cover';
import { TripHubJourney } from '@/components/trip-hub/trip-hub-journey';
import { TripHubCloseAtHand, TripHubGoodToKnow } from '@/components/trip-hub/trip-hub-sidebar';
import { useTripContext } from '@/components/trip-provider';
import { Button } from '@/components/ui/button';
import { selectNextSteps } from '@/lib/home/next-steps';
import * as Icons from '@/lib/icons';
import { itineraryViewHref } from '@/lib/itinerary/view';
import { overviewLifecycle, overviewPlannerHref, tripHubStage } from '@/lib/trips/overview';
import { useTripOverview } from '@/lib/trips/use-trip-overview';

/**
 * A single trip's home: its identity on its own photograph, what matters for
 * it now, the shape of the journey, and what to keep close. The same skeleton
 * at every stage; only what fills it changes as the trip moves from plan to
 * memory.
 */
export function TripDetail({ planScoreEnabled }: Readonly<{ planScoreEnabled: boolean }>) {
  const t = useTranslations('trips');

  // The trip itself belongs to the layout: it is the same trip every screen
  // inside the trip is showing, and fetching it here as well is what used to
  // make the cover arrive twice.
  const tripContext = useTripContext();
  const tripId = tripContext?.tripId ?? '';
  const loadedTrip = tripContext?.trip ?? null;
  const trip = loadedTrip
    ? { ...loadedTrip, lifecycle: overviewLifecycle(loadedTrip, new Date()) }
    : null;
  const status = tripContext?.status ?? 'loading';
  const editorial = tripContext?.editorial ?? null;
  const overviewQuery = useTripOverview(tripId, Boolean(trip));
  const overview = overviewQuery.data;
  const backToTrips = (
    <Link
      className="inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-md)] px-2 text-sm font-medium text-muted-foreground outline-none transition-colors duration-[var(--motion-standard)] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
      href="/trips"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      {t('title')}
    </Link>
  );

  if (status === 'loading') {
    return <TripDetailSkeleton label={t('tripLoading')} />;
  }

  if (status === 'missing' || status === 'error') {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        {backToTrips}
        <PageState
          actions={
            <>
              {status === 'error' ? (
                <Button onClick={() => tripContext?.refresh()}>{t('tryAgain')}</Button>
              ) : null}
              <Button
                nativeButton={false}
                render={<Link href="/trips" />}
                variant={status === 'error' ? 'outline' : 'default'}
              >
                {t('backToTrips')}
              </Button>
            </>
          }
          description={
            status === 'error' ? t('loadErrorDescription') : t('tripNotFoundDescription')
          }
          icon={
            status === 'error' ? (
              <CircleAlert aria-hidden="true" />
            ) : (
              <Icons.Trips aria-hidden="true" />
            )
          }
          kind={status === 'error' ? 'error' : 'empty'}
          scope="page"
          title={status === 'error' ? t('tripLoadError') : t('tripNotFound')}
        />
      </div>
    );
  }

  if (!trip) return null;

  const stage = tripHubStage(trip, new Date());
  const nextSteps = selectNextSteps({
    trip,
    tasks: null,
    taskSummary: overview?.tasks.next
      ? { count: overview.tasks.openCount, next: overview.tasks.next }
      : null,
    offlineReady: null,
    weather: null,
  })
    .filter((step) => step.kind !== 'openDays')
    .slice(0, 2);
  return (
    <TripActionsProvider trip={trip}>
      <article className="mx-auto w-full max-w-5xl" data-slot="trip-hub">
        {/* Phone: the cover, then a sheet that rises over it carrying the trip's
        row, its days and its chapter. Desktop: the photograph and the chapter
        side by side, with the row and the days beneath both. One order in the
        document either way. */}
        {/* Flattened on a phone, and the whole page on a desktop, so the
            navigation and the days stay pinned for the whole page, not only
            while the cover is in view. */}
        <div className="contents lg:grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-x-5 lg:gap-y-4 lg:[grid-template-areas:'cover_chapter'_'bar_bar'_'days_days'_'rest_rest']">
          <div className="-mx-[var(--gutter-inline-start)] -mt-8 lg:mx-0 lg:mt-0 lg:[grid-area:cover]">
            <TripHubCover
              editorial={editorial}
              onCoverExpired={() => tripContext?.refresh()}
              overview={overview}
              stage={stage}
              trip={trip}
            />
          </div>
          <TripNavigationSheet className="lg:mx-0 lg:mt-0 lg:rounded-none lg:bg-transparent lg:px-0 lg:pt-0 lg:[grid-area:bar]">
            <TripHubBar overview={overview} trip={trip} />
          </TripNavigationSheet>
          {/* The planner's own strip, in the same place under the tabs, so
              moving between the two pages keeps the days where they were. */}
          {overview?.days.length ? (
            <PlannerRibbon
              className="mt-3 md:mt-7 lg:mt-0 lg:[grid-area:days]"
              days={overview.days}
              hrefs={{
                day: (dayId) => overviewPlannerHref(trip.id, dayId),
                overview: itineraryViewHref(`/trips/${trip.id}/itinerary`, '', null),
              }}
              overviewActive={false}
              selectedDayId={overview.day?.id ?? null}
            />
          ) : null}
          <div className="lg:flex lg:flex-col lg:[grid-area:chapter]">
            <TripHubChapter
              failed={!overview && Boolean(overviewQuery.error)}
              loading={overviewQuery.isPending}
              onRetry={() => void overviewQuery.refetch()}
              overview={overview}
              showReadiness={nextSteps.some((step) => step.kind === 'readiness')}
              stage={stage}
              trip={trip}
            />
          </div>

          <div className="mt-10 grid gap-12 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] md:gap-x-14 lg:mt-6 lg:[grid-area:rest]">
            <TripHubJourney overview={overview} stage={stage} trip={trip} />
            <div className="space-y-12 empty:hidden">
              <TripHubGoodToKnow planScoreEnabled={planScoreEnabled} stage={stage} trip={trip} />
              <TripHubCloseAtHand overview={overview} stage={stage} trip={trip} />
            </div>
          </div>
        </div>

        <TripActionFeedback />
      </article>
    </TripActionsProvider>
  );
}
