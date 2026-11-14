'use client';

import { ArrowLeft, CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { PageState } from '@/components/page-state';
import { TripActionsProvider, TripActionFeedback } from '@/components/trip-actions-provider';
import { TripArchivedNote } from '@/components/trip-archive-control';
import { TripDetailSkeleton } from '@/components/trip-detail-skeleton';
import { TripHubBar } from '@/components/trip-hub/trip-hub-bar';
import { TripNavigationSheet } from '@/components/trip-hub/trip-navigation-sheet';
import { TripHubChapter } from '@/components/trip-hub/trip-hub-chapter';
import { TripHubCover } from '@/components/trip-hub/trip-hub-cover';
import { TripHubJourney } from '@/components/trip-hub/trip-hub-journey';
import { TripHubWays } from '@/components/trip-hub/trip-hub-ways';
import { TripHubCloseAtHand, TripHubGoodToKnow } from '@/components/trip-hub/trip-hub-sidebar';
import { useTripContext, useTripEntrance } from '@/components/trip-provider';
import { Button } from '@/components/ui/button';
import { selectNextSteps } from '@/lib/home/next-steps';
import * as Icons from '@/lib/icons';
import { overviewLifecycle, tripHubStage } from '@/lib/trips/overview';
import { useTripOverview } from '@/lib/trips/use-trip-overview';
import { pageEntrance } from '@/lib/page-entrance';
import { cn } from '@/lib/utils';

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
  const { enter, style: entranceStyle } = useTripEntrance(Boolean(trip));
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
      <article className="mx-auto w-full max-w-5xl" data-slot="trip-hub" style={entranceStyle}>
        {/* The cover runs edge to edge, beneath the header from `md`, and the
            trip's row rises over it on a sheet, as on the trip's sections and
            on Home. They sit directly in the article so the row stays pinned
            for the whole page on a phone. The days themselves live in the
            planner; this page is the trip. */}
        <div className="-mx-[var(--gutter-inline-start)] -mt-8 md:mx-[calc(50%-50vw)] md:-mt-[calc(var(--safe-top)+var(--header-height)+3rem+1px)]">
          <TripHubCover
            editorial={editorial}
            enter={enter}
            onCoverExpired={() => tripContext?.refresh()}
            overview={overview}
            stage={stage}
            trip={trip}
          />
        </div>
        <TripNavigationSheet
          className="md:mx-[calc(50%-50vw)] md:-mt-10 md:rounded-t-[2.5rem] md:px-[calc(50vw-50%)] md:pt-6"
          enter={enter}
        >
          <TripHubBar overview={overview} trip={trip} />
        </TripNavigationSheet>
        {trip.archivedAt ? (
          // Right under the trip's navigation, so it is the first thing read
          // after the cover and never the first thing on the screen.
          <div className="mt-4">
            <TripArchivedNote trip={trip} />
          </div>
        ) : null}

        {/* On a phone the chapter, then the ways in. From `lg` they sit side by
            side, in the same proportions as the journey beneath them. */}
        <div className="lg:mt-8 lg:grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start lg:gap-x-14">
          <div className={cn(enter && pageEntrance.sheet)}>
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
          <TripHubWays
            className={cn('mt-8 lg:mt-0', enter && pageEntrance.sheet)}
            overview={overview}
            stage={stage}
            trip={trip}
          />
        </div>

        <TripActionFeedback />

        {/* A rule marks where the chapter ends and the journey begins. */}
        <div
          className={cn(
            'mt-10 grid gap-10 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] md:gap-x-14',
            enter && pageEntrance.sheet,
            stage !== 'remember' && 'border-t border-border-subtle pt-10',
          )}
        >
          <TripHubJourney overview={overview} stage={stage} trip={trip} />
          <div className="space-y-12 border-t border-border-subtle pt-10 empty:hidden md:border-t-0 md:pt-0">
            <TripHubGoodToKnow
              overview={overview}
              planScoreEnabled={planScoreEnabled}
              stage={stage}
              trip={trip}
            />
            <TripHubCloseAtHand overview={overview} stage={stage} trip={trip} />
          </div>
        </div>
      </article>
    </TripActionsProvider>
  );
}
