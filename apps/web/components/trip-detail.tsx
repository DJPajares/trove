'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarSync,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Ellipsis,
  Pencil,
  RefreshCw,
  RotateCcw,
  Share2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, type ComponentType } from 'react';

import { EditorialSection } from '@/components/editorial-section';
import { OfflineReadyStatus } from '@/components/offline-ready-status';
import { PageState } from '@/components/page-state';
import { TripInsights } from '@/components/trip-insights';
import { TripCountries } from '@/components/trip-countries';
import { TripForm } from '@/components/trip-form';
import { TripLifecycleBadge } from '@/components/trip-lifecycle-badge';
import { TripDetailSkeleton } from '@/components/trip-detail-skeleton';
import { useTripCreation } from '@/components/trip-creation-provider';
import { useTripContext } from '@/components/trip-provider';
import { TripShareDialog } from '@/components/trip-share-dialog';
import { TripMedia } from '@/components/trip-media';
import { TripReadinessBadge } from '@/components/trip-readiness-badge';
import { TripReadinessPrompt } from '@/components/trip-readiness-prompt';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { forgetCachedMediaUrls } from '@/lib/media/storage-cache-key';
import { shouldRefreshSignedMedia } from '@/lib/memories/signed-media';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import { deleteTrip, type Trip } from '@/lib/trips/api';
import { formatTripDateRange } from '@/lib/trips/format';
import { supportingTripDestinations } from '@/lib/trips/navigation';
import { tripDestinationSummary } from '@/lib/trips/summary';
import { useTripDateMove } from '@/lib/trips/use-trip-date-move';
import { useTripReadiness } from '@/lib/trips/use-trip-readiness';
import { discardTripOfflineData } from '@/lib/offline/trip-preparation';
import { queryKeys } from '@/lib/query/keys';
import { removeTripQueries } from '@/lib/query/trip-invalidation';
import * as Icons from '@/lib/icons';
import { tripSectionIcons } from '@/lib/icons';

import { TripHubChapter, TripHubExperienceLinks } from '@/components/trip-hub-chapter';
import { selectNextSteps } from '@/lib/home/next-steps';
import { TripHubScore } from '@/components/trip-hub-score';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useTripOverview } from '@/lib/trips/use-trip-overview';
import { overviewLifecycle } from '@/lib/trips/overview';
import { calendarDayDistance } from '@/lib/trips/lifecycle';
const supportingIcons: Record<
  'expenses' | 'info' | 'places' | 'reservations' | 'tasks',
  ComponentType<{ className?: string }>
> = {
  expenses: tripSectionIcons.expenses,
  info: tripSectionIcons.info,
  places: tripSectionIcons.places,
  reservations: tripSectionIcons.reservations,
  tasks: tripSectionIcons.tasks,
};

export function TripDetail({
  planScoreEnabled,
  tripId,
}: Readonly<{ planScoreEnabled: boolean; tripId: string }>) {
  const t = useTranslations('trips');
  const share = useTranslations('trips.share');
  const hub = useTranslations('trips.hub');
  const mediaTranslations = useTranslations('media');
  const locale = useLocale();
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
  const lastCoverRefreshAt = useRef<number | null>(null);
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

  const destinations = tripDestinationSummary(trip);
  const supporting = supportingTripDestinations(trip.id);
  const routeDestinations = (overview?.destinations ?? trip.destinations).filter((destination) =>
    destination.name?.trim(),
  );
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

  const manageMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={t('tripActions')}
            className="shrink-0"
            size="icon"
            type="button"
            variant="ghost"
          />
        }
      >
        {/* The menu closes the moment a date is chosen, so without this the
                only sign the trip is moving would be the trip eventually
                changing underneath the traveller. */}
        {movingDates ? (
          <RefreshCw aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
        ) : (
          <Ellipsis aria-hidden="true" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52" sideOffset={8}>
        <DropdownMenuItem onClick={() => setEditing(true)}>
          <Pencil aria-hidden="true" />
          {t('editTrip')}
        </DropdownMenuItem>
        {/* Shifting a trip is otherwise a trip through the edit form to a
                date field, which is a lot of steps for "a week later". The plan
                comes along on its own: both ends move by the same amount, so
                the trip keeps its length and nothing has to be unscheduled. */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={movingDates}>
            <CalendarSync aria-hidden="true" />
            {t('moveDates.action')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {(
              [
                ['dayEarlier', -1],
                ['dayLater', 1],
                ['weekEarlier', -7],
                ['weekLater', 7],
              ] as const
            ).map(([key, days]) => (
              <DropdownMenuItem key={key} onClick={() => void moveTripDates(trip, days)}>
                {t(`moveDates.${key}`)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {/* Sharing sits with editing rather than among the tools: both are
                things done to the trip itself, and this menu is the one the
                overview offers. It is also the first stop from a trip in the
                library, so a trip can be shared without opening its plan. */}
        <DropdownMenuItem onClick={() => setSharing(true)}>
          <Share2 aria-hidden="true" />
          {share('action')}
        </DropdownMenuItem>
        {/* Readiness was previously reachable only by opening the edit form
                and expanding a panel, which is a long way round for a marker
                the traveller is meant to flip as their plan settles. It stays
                out of the menu once the trip is under way: by then the plan is
                no longer the thing being declared done. */}
        {trip.lifecycle === 'planning' ? (
          <DropdownMenuItem
            disabled={readinessPending}
            onClick={() =>
              void setReadiness(trip, trip.planningReadiness === 'ready' ? 'in_progress' : 'ready')
            }
          >
            {trip.planningReadiness === 'ready' ? (
              <RotateCcw aria-hidden="true" />
            ) : (
              <CircleCheck aria-hidden="true" />
            )}
            {t(trip.planningReadiness === 'ready' ? 'markInProgress' : 'markReady')}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <article className="mx-auto w-full max-w-5xl space-y-6 md:space-y-8" data-slot="trip-hub">
      <div className="-mx-[var(--gutter-inline-start)] -mt-8 overflow-hidden bg-background md:mx-0 md:mt-0 md:grid md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] md:rounded-[var(--radius-2xl)] md:bg-surface-raised">
        <section
          aria-labelledby="trip-detail-heading"
          className="relative isolate md:flex md:min-h-[25rem] md:flex-col md:justify-end"
        >
          <div className="relative md:contents">
            <TripMedia
              alt={
                editorial
                  ? mediaTranslations('alt.tripEditorial', { name: destinations ?? trip.name })
                  : ''
              }
              preload
              fallbackSources={editorial ? [{ kind: 'editorial', reference: editorial }] : []}
              onUnreachable={() => {
                const now = Date.now();
                if (
                  shouldRefreshSignedMedia({
                    canDecodeHeic: true,
                    contentType: null,
                    lastRefreshAt: lastCoverRefreshAt.current,
                    now,
                    online: navigator.onLine,
                    url: trip.coverPhotoUrl,
                  })
                ) {
                  lastCoverRefreshAt.current = now;
                  void forgetCachedMediaUrls([trip.coverPhotoUrl]).finally(() =>
                    tripContext?.refresh(),
                  );
                }
              }}
              className="w-full rounded-none md:absolute md:inset-0 md:h-full"
              sizes="(max-width: 767px) 100vw, 660px"
              source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
              variant="cover"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-gradient-to-t from-surface-overlay/85 from-0% to-transparent to-42% md:from-neutral-950/90 md:via-neutral-950/35 md:to-neutral-950/10 md:to-100%"
            />
            <Link
              aria-label={t('backToTrips')}
              className="absolute top-[max(1rem,var(--safe-top))] left-[max(1rem,var(--safe-left))] z-10 grid size-10 place-items-center rounded-full bg-neutral-950/50 text-white backdrop-blur-sm outline-none hover:bg-neutral-950/75 focus-visible:ring-3 focus-visible:ring-white/60"
              href="/trips"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
            </Link>
          </div>
          <div className="relative -mt-8 rounded-t-[var(--trip-sheet-radius)] bg-background px-[var(--gutter-inline-start)] pt-6 text-foreground md:mt-0 md:rounded-none md:bg-transparent md:px-7 md:pt-20 md:pb-8 md:text-white">
            <div className="mb-4 hidden flex-wrap gap-2 md:flex">
              <TripLifecycleBadge lifecycle={trip.lifecycle} tone="onMedia" />
              <TripReadinessBadge
                lifecycle={trip.lifecycle}
                readiness={trip.planningReadiness}
                tone="onMedia"
              />
            </div>
            {trip.countries?.length ? (
              <TripCountries
                className="text-xs font-medium tracking-[0.1em] text-brand uppercase md:text-white/85"
                countries={trip.countries}
              />
            ) : destinations ? (
              <p className="text-xs font-medium tracking-[0.1em] text-brand uppercase md:text-white/85">
                {destinations}
              </p>
            ) : null}
            <h1
              className="mt-2 text-[length:var(--text-page-title)] leading-[1.08] font-semibold tracking-[-0.035em] text-balance break-words md:text-4xl"
              id="trip-detail-heading"
            >
              {trip.name}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground md:text-white/85">
              <span>{formatTripDateRange(trip.startDate, trip.endDate, locale)}</span>
              <span aria-hidden="true">·</span>
              <span>
                {hub('duration', { count: calendarDayDistance(trip.startDate, trip.endDate) + 1 })}
              </span>
              <TripLifecycleBadge className="md:hidden" lifecycle={trip.lifecycle} />
              <TripReadinessBadge
                className="md:hidden"
                lifecycle={trip.lifecycle}
                readiness={trip.planningReadiness}
              />
            </div>
          </div>
        </section>
        <TripHubChapter
          trip={trip}
          overview={overview}
          loading={overviewQuery.isPending}
          failed={Boolean(overviewQuery.error)}
          onRetry={() => void overviewQuery.refetch()}
        />
      </div>

      <TripHubExperienceLinks trip={trip} />

      <section aria-label={hub('journeyDetails')} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{hub('routeTitle')}</h2>
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
                {t('tripTools')}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {supporting.map((destination) => {
                  const Icon = supportingIcons[destination.section as keyof typeof supportingIcons];
                  return (
                    <DropdownMenuLinkItem
                      key={destination.section}
                      render={<Link href={destination.href} />}
                    >
                      <Icon aria-hidden="true" />
                      {t(destination.labelKey)}
                    </DropdownMenuLinkItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            {manageMenu}
          </div>
        </div>
        {routeDestinations.length ? (
          <Collapsible>
            <ol
              aria-label={hub('destinations')}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-2"
            >
              {routeDestinations.slice(0, 3).map((destination, index) => (
                <li className="flex min-w-0 items-baseline gap-3" key={destination.id}>
                  {index ? (
                    <span aria-hidden="true" className="text-text-subtle">
                      →
                    </span>
                  ) : null}
                  <span className="text-sm text-foreground">{destination.name}</span>
                </li>
              ))}
            </ol>
            {routeDestinations.length > 3 ? (
              <>
                <CollapsibleTrigger className="mt-3 text-xs">
                  {hub('moreDestinations', { count: routeDestinations.length - 3 })}
                </CollapsibleTrigger>
                <CollapsiblePanel>
                  <ol className="mt-3 flex flex-wrap gap-3" start={4}>
                    {routeDestinations.slice(3).map((destination) => (
                      <li className="text-sm text-muted-foreground" key={destination.id}>
                        {destination.name}
                      </li>
                    ))}
                  </ol>
                </CollapsiblePanel>
              </>
            ) : null}
          </Collapsible>
        ) : null}
        <Link
          className="inline-flex min-h-9 items-center gap-2 rounded-sm text-sm font-medium text-brand outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
          href={`/trips/${trip.id}/places`}
        >
          <Icons.Place aria-hidden="true" className="size-4" />
          {hub(trip.lifecycle === 'completed' ? 'placesRemembered' : 'placesToExplore')}
          <ChevronRight aria-hidden="true" className="size-3" />
        </Link>
        {trip.description ? (
          <Collapsible>
            <CollapsibleTrigger className="text-xs">{hub('aboutTrip')}</CollapsibleTrigger>
            <CollapsiblePanel>
              <p className="max-w-[var(--layout-reading)] pt-3 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
                {trip.description}
              </p>
            </CollapsiblePanel>
          </Collapsible>
        ) : null}
      </section>

      {deleteError ? (
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{deleteError}</AlertDescription>
        </Alert>
      ) : null}
      <span aria-live="polite" className="sr-only">
        {movingDates ? t('moveDates.moving') : ''}
      </span>
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

      {trip.lifecycle !== 'completed' ? (
        <div className="grid gap-6 border-t border-border-subtle pt-6 md:grid-cols-2 md:gap-8">
          <div className="space-y-5">
            {nextSteps.some((step) => step.kind === 'readiness') ? (
              <TripReadinessPrompt trip={trip} />
            ) : null}
            {overview?.tasks.next &&
            (trip.lifecycle === 'active' || nextSteps.some((step) => step.kind === 'tasks')) ? (
              <section aria-labelledby="hub-tasks-heading">
                <h2 className="text-sm font-semibold" id="hub-tasks-heading">
                  {hub(trip.lifecycle === 'active' ? 'todayTask' : 'nextStep')}
                </h2>
                <Link
                  className="mt-2 flex items-center justify-between gap-4 rounded-sm py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                  href={`/trips/${trip.id}/tasks`}
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{overview.tasks.next.label}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {hub('openTasks', { count: overview.tasks.openCount })}
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-text-subtle" />
                </Link>
              </section>
            ) : null}
            <OfflineReadyStatus headingLevel={2} tripId={trip.id} variant="compact" />
          </div>
          <div className="space-y-5">
            {planScoreEnabled ? <TripHubScore tripId={trip.id} /> : null}
            {trip.lifecycle !== 'active' || overview?.day ? (
              <TripInsights
                dayId={trip.lifecycle === 'active' ? overview?.day?.id : undefined}
                headingLevel={2}
                initialItemLimit={1}
                tripId={trip.id}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {overview?.pinnedInfo.length ? (
        <EditorialSection
          actions={
            <Button
              nativeButton={false}
              render={<Link href={`/trips/${trip.id}/info`} />}
              size="sm"
              variant="ghost"
            >
              {t('viewTripInfo')}
            </Button>
          }
          density="compact"
          description={t('pinnedTripInfo')}
          title={t('tripInfo')}
          treatment="ruled"
        >
          <dl className="grid gap-4 sm:grid-cols-3">
            {overview.pinnedInfo.map((entry) => (
              <div key={entry.id}>
                <dt className="text-xs font-medium text-text-subtle">{entry.label}</dt>
                <dd className="mt-1 text-sm break-words text-foreground">{entry.value}</dd>
              </div>
            ))}
          </dl>
        </EditorialSection>
      ) : null}
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
