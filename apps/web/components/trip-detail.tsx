'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { PageState } from '@/components/page-state';
import { TripForm } from '@/components/trip-form';
import { TripDetailSkeleton } from '@/components/trip-detail-skeleton';
import { useTripCreation } from '@/components/trip-creation-provider';
import { TripHubBar } from '@/components/trip-hub/trip-hub-bar';
import { TripHubChapter } from '@/components/trip-hub/trip-hub-chapter';
import { TripHubCover } from '@/components/trip-hub/trip-hub-cover';
import { TripHubJourney } from '@/components/trip-hub/trip-hub-journey';
import { TripHubCloseAtHand, TripHubGoodToKnow } from '@/components/trip-hub/trip-hub-sidebar';
import { useTripContext } from '@/components/trip-provider';
import { TripShareDialog } from '@/components/trip-share-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { selectNextSteps } from '@/lib/home/next-steps';
import * as Icons from '@/lib/icons';
import { discardTripOfflineData } from '@/lib/offline/trip-preparation';
import { queryKeys } from '@/lib/query/keys';
import { removeTripQueries } from '@/lib/query/trip-invalidation';
import { deleteTrip, type Trip } from '@/lib/trips/api';
import { overviewLifecycle, tripHubStage } from '@/lib/trips/overview';
import { useTripDateMove } from '@/lib/trips/use-trip-date-move';
import { useTripOverview } from '@/lib/trips/use-trip-overview';
import { useTripReadiness } from '@/lib/trips/use-trip-readiness';

/**
 * A single trip's home: its identity on its own photograph, what matters for
 * it now, the shape of the journey, and what to keep close. The same skeleton
 * at every stage; only what fills it changes as the trip moves from plan to
 * memory.
 */
export function TripDetail({
  planScoreEnabled,
  tripId,
}: Readonly<{ planScoreEnabled: boolean; tripId: string }>) {
  const t = useTranslations('trips');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { forgetCreatedTrip } = useTripCreation();

  // The trip itself belongs to the layout: it is the same trip every screen
  // inside the trip is showing, and fetching it here as well is what used to
  // make the cover arrive twice.
  const tripContext = useTripContext();
  const loadedTrip = tripContext?.trip ?? null;
  const trip = loadedTrip
    ? { ...loadedTrip, lifecycle: overviewLifecycle(loadedTrip, new Date()) }
    : null;
  const status = tripContext?.status ?? 'loading';
  const editorial = tripContext?.editorial ?? null;
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const {
    failedTripId: readinessFailedTripId,
    pendingTripId: readinessPendingTripId,
    setReadiness,
  } = useTripReadiness();
  const {
    failedTripId: dateMoveFailedTripId,
    moveTripDates,
    pendingTripId: dateMovePendingTripId,
  } = useTripDateMove();
  const movingDates = dateMovePendingTripId !== null;
  const readinessPending = readinessPendingTripId !== null;
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
  async function handleDelete() {
    if (!trip) return;
    setDeleting(true);
    setDeleteError(null);

    try {
      await deleteTrip(trip.id);
      forgetCreatedTrip(trip.id);
      queryClient.setQueryData(queryKeys.trips(), (current: { trips: Trip[] } | undefined) =>
        current
          ? { trips: current.trips.filter((candidate) => candidate.id !== trip.id) }
          : current,
      );
      queryClient.removeQueries({ queryKey: queryKeys.trip(trip.id) });
      removeTripQueries(queryClient, trip.id);
      // The trip is gone from the server, so its offline copy is no longer a
      // copy of anything. A storage failure here must not turn a delete that
      // succeeded into an error the traveller has to act on.
      await discardTripOfflineData(trip.id).catch(() => undefined);
      setConfirmingDelete(false);
      setEditing(false);
      // The route the traveller is standing on no longer exists, so it must not
      // stay in the back stack either.
      router.replace('/trips');
    } catch {
      setDeleteError(t('deleteError'));
      setDeleting(false);
    }
  }

  return (
    <article className="mx-auto w-full max-w-5xl" data-slot="trip-hub">
      {/* Phone: the cover, then a sheet that rises over it carrying the trip's
        row and its chapter. Desktop: the photograph and the chapter side by
        side, with the row beneath both. One order in the document either way. */}
      <div className="-mx-[var(--gutter-inline-start)] -mt-8 lg:mx-0 lg:mt-0 lg:grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-x-5 lg:gap-y-4 lg:[grid-template-areas:'cover_chapter'_'bar_bar']">
        <div className="lg:[grid-area:cover]">
          <TripHubCover
            editorial={editorial}
            onCoverExpired={() => tripContext?.refresh()}
            overview={overview}
            stage={stage}
            trip={trip}
          />
        </div>
        <div className="relative -mt-8 rounded-t-[var(--trip-sheet-radius)] bg-background px-[var(--gutter-inline-start)] pt-2 lg:mt-0 lg:rounded-none lg:bg-transparent lg:px-0 lg:pt-0 lg:[grid-area:bar]">
          <TripHubBar
            movingDates={movingDates}
            onDelete={() => setConfirmingDelete(true)}
            onEdit={() => setEditing(true)}
            onMoveDates={(days) => void moveTripDates(trip, days)}
            onShare={() => setSharing(true)}
            onToggleReadiness={() =>
              void setReadiness(trip, trip.planningReadiness === 'ready' ? 'in_progress' : 'ready')
            }
            overview={overview}
            readinessPending={readinessPending}
            trip={trip}
          />
        </div>
        <div className="px-[var(--gutter-inline-start)] lg:flex lg:flex-col lg:px-0 lg:[grid-area:chapter]">
          <TripHubChapter
            failed={Boolean(overviewQuery.error)}
            loading={overviewQuery.isPending}
            onRetry={() => void overviewQuery.refetch()}
            overview={overview}
            showReadiness={nextSteps.some((step) => step.kind === 'readiness')}
            stage={stage}
            trip={trip}
          />
        </div>
      </div>

      <div className="mt-6 space-y-3 empty:hidden">
        {deleteError ? (
          <Alert role="alert" variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{deleteError}</AlertDescription>
          </Alert>
        ) : null}
        {dateMoveFailedTripId === trip.id ? (
          <Alert role="alert" variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{t('moveDates.error')}</AlertDescription>
          </Alert>
        ) : null}
        {readinessFailedTripId === trip.id ? (
          <Alert role="alert" variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{t('readinessPrompt.error')}</AlertDescription>
          </Alert>
        ) : null}
      </div>
      <span aria-live="polite" className="sr-only">
        {movingDates ? t('moveDates.moving') : ''}
      </span>

      <div className="mt-10 grid gap-12 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] md:gap-x-14">
        <TripHubJourney overview={overview} stage={stage} trip={trip} />
        <div className="space-y-12 empty:hidden">
          <TripHubGoodToKnow planScoreEnabled={planScoreEnabled} stage={stage} trip={trip} />
          <TripHubCloseAtHand overview={overview} stage={stage} trip={trip} />
        </div>
      </div>

      <TripShareDialog
        onOpenChange={setSharing}
        onTripChange={(updated) => tripContext?.setTrip(updated)}
        open={sharing}
        trip={trip}
      />

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
              onDelete={() => setConfirmingDelete(true)}
              onSaved={(saved) => {
                tripContext?.setTrip(saved);
                setEditing(false);
              }}
              trip={trip}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      <AlertDialog
        onOpenChange={(open) => !open && setConfirmingDelete(false)}
        open={confirmingDelete}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteDescription', { name: trip.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={() => void handleDelete()}
              variant="destructive"
            >
              {deleting ? t('deleting') : t('deleteTrip')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
