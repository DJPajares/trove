'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarClock,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Compass,
  Ellipsis,
  Info,
  MapPinned,
  Navigation,
  Pencil,
  ReceiptText,
  Share2,
  Sparkles,
  StickyNote,
  Users,
  WalletCards,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type ComponentType, type ReactNode } from 'react';

import { EditorialSection } from '@/components/editorial-section';
import { ExperienceRatingSummary } from '@/components/experience-rating-field';
import { OfflineReadyStatus } from '@/components/offline-ready-status';
import { PageState } from '@/components/page-state';
import { PlanScorePanel } from '@/components/plan-score-panel';
import { TripForm } from '@/components/trip-form';
import { TripLifecycleBadge } from '@/components/trip-lifecycle-badge';
import { TripDetailSkeleton } from '@/components/trip-detail-skeleton';
import { useTripCreation } from '@/components/trip-creation-provider';
import { useTripContext } from '@/components/trip-provider';
import { TripShareDialog } from '@/components/trip-share-dialog';
import { TripMedia } from '@/components/trip-media';
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
import { Button, buttonVariants } from '@/components/ui/button';
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
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import { useTripPlanScore } from '@/lib/plan-score/use-trip-plan-score';
import { fetchTripInfo, type TripInfoEntry } from '@/lib/trip-info/api';
import { deleteTrip, type Trip } from '@/lib/trips/api';
import { formatTripDateRange } from '@/lib/trips/format';
import {
  supportingTripDestinations,
  tripOverviewDestinations,
  type TripOverviewDestination,
} from '@/lib/trips/navigation';
import { tripDestinationSummary } from '@/lib/trips/summary';
import { cn } from '@/lib/utils';
import { queryKeys } from '@/lib/query/keys';

/** The tools' icons. Which tools there are, and their order, is the navigation contract's. */
const supportingIcons: Record<
  'expenses' | 'info' | 'reservations' | 'tasks',
  ComponentType<{ className?: string }>
> = {
  expenses: WalletCards,
  info: Info,
  reservations: ReceiptText,
  tasks: ClipboardCheck,
};

const experienceIcons: Record<
  'itinerary' | 'memories' | 'mode',
  ComponentType<{ className?: string }>
> = {
  itinerary: CalendarClock,
  memories: Sparkles,
  mode: Compass,
};

function TripDetailPlanScore({ revision, tripId }: Readonly<{ revision: string; tripId: string }>) {
  const planScoreTranslations = useTranslations('planScore');
  const planScore = useTripPlanScore(tripId, revision);
  const planScoreHidden =
    planScore.status === 'disabled' ||
    Boolean(planScore.data?.withheldReasons.includes('ADMINISTRATIVELY_DISABLED'));

  if (planScoreHidden || (!planScore.data && planScore.status !== 'error')) return null;

  return (
    <PlanScorePanel
      disabled={planScore.data?.withheldReasons.includes('ADMINISTRATIVELY_DISABLED')}
      explanations={
        planScore.data?.explanations ?? {
          uncertainty: [],
          whatWorks: [],
          worthImproving: [],
        }
      }
      onRetry={planScore.retry}
      score={planScore.data?.score ?? null}
      scope="trip"
      status={planScore.status}
      title={planScoreTranslations('title')}
    />
  );
}

/** One fact in the overview's semantic description list. */
function OverviewFact({
  Icon,
  label,
  value,
  wide = false,
}: Readonly<{
  Icon: ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
  wide?: boolean;
}>) {
  return (
    <div className={cn('flex gap-3 border-b border-border-subtle py-4', wide && 'sm:col-span-2')}>
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-text-subtle" />
      <div className="min-w-0">
        <dt className="text-[length:var(--text-metadata)] font-medium text-text-subtle">{label}</dt>
        <dd className="mt-0.5 text-sm break-words text-foreground">{value}</dd>
      </div>
    </div>
  );
}

function PinnedTripInfoEntry({ label, value }: Readonly<{ label: string; value: ReactNode }>) {
  return (
    <div>
      <p className="text-[length:var(--text-metadata)] font-medium text-text-subtle">{label}</p>
      <p className="mt-1 text-sm break-words text-foreground">{value}</p>
    </div>
  );
}

function TripExperienceTile({
  description,
  destination,
  label,
}: Readonly<{ description: string; destination: TripOverviewDestination; label: string }>) {
  const Icon = experienceIcons[destination.section];

  return (
    <Link
      className="group flex min-h-32 flex-col justify-between rounded-[var(--radius-xl)] border border-border-subtle bg-card p-4 shadow-[var(--shadow-control)] outline-none transition-[background-color,border-color,box-shadow,transform] duration-[var(--motion-standard)] hover:border-border-strong hover:bg-surface-hover hover:shadow-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 active:translate-y-px"
      data-slot="trip-overview-secondary-action"
      href={destination.href}
    >
      <span className="flex items-start justify-between gap-3">
        <Icon aria-hidden="true" className="size-5 text-brand" />
        <ChevronRight
          aria-hidden="true"
          className="size-4 text-text-subtle transition-transform duration-[var(--motion-standard)] group-hover:translate-x-0.5"
        />
      </span>
      <span className="mt-5 block">
        <span className="block font-semibold text-foreground">{label}</span>
        <span className="mt-1 block text-sm leading-5 text-muted-foreground">{description}</span>
      </span>
    </Link>
  );
}

/**
 * The trip's own screen.
 *
 * A cover photograph carries the identity, and everything the trip says about
 * itself outside its sub-routes follows underneath: the stage's actions, the
 * score or the reflection, the facts, the supporting tools, and the details the
 * traveller pinned.
 */
const EMPTY_TRIP_INFO: TripInfoEntry[] = [];

export function TripDetail({
  planScoreEnabled,
  tripId,
}: Readonly<{ planScoreEnabled: boolean; tripId: string }>) {
  const t = useTranslations('trips');
  const share = useTranslations('trips.share');
  const experienceRatingTranslations = useTranslations('experienceRating');
  const mediaTranslations = useTranslations('media');
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { forgetCreatedTrip } = useTripCreation();

  // The trip itself belongs to the layout: it is the same trip every screen
  // inside the trip is showing, and fetching it here as well is what used to
  // make the cover arrive twice.
  const tripContext = useTripContext();
  const trip = tripContext?.trip ?? null;
  const status = tripContext?.status ?? 'loading';
  const editorial = tripContext?.editorial ?? null;
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // The same entry the Trip Info screen reads, so opening this overview after
  // editing trip info shows the edit without asking again.
  const tripInfoQuery = useQuery({
    queryFn: () => fetchTripInfo(tripId),
    queryKey: queryKeys.tripInfo(tripId),
  });
  const tripInfo = useMemo(
    () => tripInfoQuery.data?.entries.filter((entry) => entry.isPinned) ?? EMPTY_TRIP_INFO,
    [tripInfoQuery.data],
  );
  const tripInfoStatus = tripInfoQuery.isPending
    ? 'loading'
    : tripInfoQuery.error
      ? 'error'
      : 'idle';

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
              <MapPinned aria-hidden="true" />
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
  const overviewDestinations = tripOverviewDestinations(trip.id, trip.lifecycle, trip.startDate);
  const primaryActionLabel =
    trip.lifecycle === 'planning'
      ? t('continuePlanning')
      : trip.lifecycle === 'active'
        ? t('openTripMode')
        : t('viewMemories');

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
    <article className="mx-auto w-full max-w-5xl space-y-7">
      <section
        aria-labelledby="trip-detail-heading"
        className="relative isolate -mx-[var(--gutter-inline-start)] -mt-8 md:mx-0 md:mt-0"
      >
        <TripMedia
          alt={
            editorial
              ? mediaTranslations('alt.tripEditorial', { name: destinations ?? trip.name })
              : ''
          }
          // The page's Largest Contentful Paint by a distance.
          preload
          className="rounded-none md:rounded-[var(--radius-2xl)]"
          sizes="(max-width: 1023px) 100vw, 1024px"
          source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
          variant="cover"
        />
        <Link
          aria-label={t('backToTrips')}
          className="absolute top-[max(1rem,var(--safe-top))] left-[max(1rem,var(--safe-left))] z-10 flex size-10 items-center justify-center rounded-full border border-media-fallback-foreground/18 bg-neutral-950/58 text-media-fallback-foreground backdrop-blur-sm outline-none transition-colors hover:bg-neutral-950/78 focus-visible:ring-3 focus-visible:ring-ring/50"
          href="/trips"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
        </Link>
        <div className="absolute top-[max(1rem,var(--safe-top))] right-[max(1rem,var(--safe-right))] z-10">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label={t('tripActions')}
                  className="size-10 rounded-full border border-white/20 bg-neutral-950/58 text-white shadow-sm backdrop-blur-sm hover:bg-neutral-950/78 hover:text-white"
                  size="icon"
                  type="button"
                  variant="ghost"
                />
              }
            >
              <Ellipsis aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52" sideOffset={8}>
              <DropdownMenuItem onClick={() => setEditing(true)}>
                <Pencil aria-hidden="true" />
                {t('editTrip')}
              </DropdownMenuItem>
              {/* Sharing sits with editing rather than among the tools: both are
                  things done to the trip itself, and this menu is the one the
                  overview offers. It is also the first stop from a trip in the
                  library, so a trip can be shared without opening its plan. */}
              <DropdownMenuItem onClick={() => setSharing(true)}>
                <Share2 aria-hidden="true" />
                {share('action')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t('tripTools')}</DropdownMenuLabel>
              </DropdownMenuGroup>
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
        </div>
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-end rounded-none bg-gradient-to-t from-surface-overlay from-20% via-surface-overlay/55 to-transparent p-5 md:rounded-[var(--radius-2xl)] md:p-7">
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] text-media-fallback-foreground/85 uppercase">
                {destinations ?? t('destinationOpen')}
              </p>
              <h1
                className="mt-1 text-[length:var(--text-page-title)] leading-[1.08] font-semibold tracking-[-0.035em] text-pretty text-media-fallback-foreground md:text-4xl"
                id="trip-detail-heading"
              >
                {trip.name}
              </h1>
              <p className="mt-1 text-[length:var(--text-metadata)] font-medium text-media-fallback-foreground/85 tabular-nums">
                {formatTripDateRange(trip.startDate, trip.endDate, locale)}
              </p>
            </div>
            <TripLifecycleBadge
              className="mb-0.5 shrink-0"
              lifecycle={trip.lifecycle}
              tone="onMedia"
            />
          </div>
        </div>
      </section>

      {deleteError ? (
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{deleteError}</AlertDescription>
        </Alert>
      ) : null}

      <section aria-label={t('tripExperiences')} className="space-y-3">
        <Link
          className={buttonVariants({ className: 'w-full', size: 'lg' })}
          data-slot="trip-overview-primary-action"
          href={overviewDestinations.primary.href}
        >
          {primaryActionLabel}
        </Link>
        <div className="grid grid-cols-2 gap-3">
          {overviewDestinations.secondary.map((destination) => (
            <TripExperienceTile
              description={t(`experienceDescription.${destination.descriptionKey}`)}
              destination={destination}
              key={destination.section}
              label={t(destination.displayLabelKey)}
            />
          ))}
        </div>
      </section>

      {/*
        Plan Score judges the plan and only applies while there is still
        planning to do; Experience Rating is the traveller's own reflection
        afterwards. They never occupy this slot at the same time.
      */}
      {trip.lifecycle === 'completed' ? (
        trip.experienceRating === null ? null : (
          <ExperienceRatingSummary
            label={experienceRatingTranslations('summaryLabel')}
            rating={trip.experienceRating}
          />
        )
      ) : planScoreEnabled ? (
        <TripDetailPlanScore revision={trip.updatedAt} tripId={trip.id} />
      ) : null}

      <dl className="grid border-t border-border-subtle sm:grid-cols-2 sm:gap-x-8">
        <OverviewFact
          Icon={MapPinned}
          label={t('destinations')}
          value={
            trip.destinations.length
              ? trip.destinations.map((destination) => destination.name).join(', ')
              : t('destinationOpen')
          }
        />
        <OverviewFact
          Icon={Users}
          label={t('travellers')}
          value={t('travellerCount', { count: trip.partySize })}
        />
        <OverviewFact
          Icon={ClipboardCheck}
          label={t('planningReadiness')}
          value={t(`readinessState.${trip.planningReadiness}`)}
        />
        <OverviewFact
          Icon={Navigation}
          label={t('startingLocation')}
          value={trip.startingLocation?.name ?? t('startingLocationUnavailable')}
        />

        {trip.notes ? (
          <OverviewFact
            Icon={StickyNote}
            label={t('notes')}
            value={<span className="whitespace-pre-wrap">{trip.notes}</span>}
            wide
          />
        ) : null}
      </dl>

      {trip.lifecycle !== 'completed' ? <OfflineReadyStatus tripId={trip.id} /> : null}

      {tripInfoStatus === 'loading' ? (
        <section
          aria-busy="true"
          aria-live="polite"
          className="space-y-2 border-t border-border-subtle pt-5"
        >
          <h2 className="text-base font-semibold">{t('tripInfo')}</h2>
          <p className="text-sm text-muted-foreground">{t('tripInfoLoading')}</p>
        </section>
      ) : null}
      {tripInfoStatus === 'error' ? (
        <section className="border-t border-border-subtle pt-5">
          <h2 className="text-base font-semibold">{t('tripInfo')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('tripInfoUnavailable')}</p>
        </section>
      ) : null}
      {tripInfoStatus === 'idle' && tripInfo.length ? (
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
          <div className="space-y-3">
            {tripInfo.map((entry) => (
              <PinnedTripInfoEntry key={entry.id} label={entry.label} value={entry.value} />
            ))}
          </div>
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
