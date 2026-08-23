'use client';

import {
  ArrowLeft,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Info,
  MapPinned,
  Pencil,
  ReceiptText,
  Users,
  WalletCards,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';

import { EditorialSection } from '@/components/editorial-section';
import { ExperienceRatingSummary } from '@/components/experience-rating-field';
import { PageState } from '@/components/page-state';
import { PlanScorePanel } from '@/components/plan-score-panel';
import { TripDestinationActions } from '@/components/trip-destination-actions';
import { TripForm } from '@/components/trip-form';
import { TripLifecycleBadge } from '@/components/trip-lifecycle-badge';
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
import { Button } from '@/components/ui/button';
import { Item, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import { editorialSubjectKey } from '@/lib/media/editorial-images';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import { useTripPlanScore } from '@/lib/plan-score/use-trip-plan-score';
import { fetchTripInfo, type TripInfoEntry } from '@/lib/trip-info/api';
import { deleteTrip, fetchTrip, TripApiError, type Trip } from '@/lib/trips/api';
import { formatTripDateRange } from '@/lib/trips/format';
import { primaryTripDestinations, supportingTripDestinations } from '@/lib/trips/navigation';
import { tripDestinationSummary, tripEditorialSubject } from '@/lib/trips/summary';

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

/** One fact about a trip. Local to this file: it has exactly one consumer. */
function TripFact({ label, value }: Readonly<{ label: string; value: ReactNode }>) {
  return (
    <div>
      <p className="text-[length:var(--text-metadata)] font-medium text-text-subtle">{label}</p>
      <p className="mt-1 text-sm break-words text-foreground">{value}</p>
    </div>
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
export function TripDetail({
  planScoreEnabled,
  tripId,
}: Readonly<{ planScoreEnabled: boolean; tripId: string }>) {
  const t = useTranslations('trips');
  const experienceRatingTranslations = useTranslations('experienceRating');
  const mediaTranslations = useTranslations('media');
  const locale = useLocale();
  const router = useRouter();

  const [trip, setTrip] = useState<Trip | null>(null);
  const [status, setStatus] = useState<'error' | 'idle' | 'loading' | 'missing'>('loading');
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [tripInfo, setTripInfo] = useState<TripInfoEntry[]>([]);
  const [tripInfoStatus, setTripInfoStatus] = useState<'error' | 'idle' | 'loading'>('idle');

  useEffect(() => {
    let active = true;
    setStatus('loading');

    void fetchTrip(tripId)
      .then(({ trip: result }) => {
        if (!active) return;
        setTrip(result);
        setStatus('idle');
      })
      .catch((error: unknown) => {
        if (!active) return;
        // A trip that is gone is a different answer from a trip that would not
        // load, and only one of them is worth offering a retry for.
        setStatus(error instanceof TripApiError && error.status === 404 ? 'missing' : 'error');
      });

    return () => {
      active = false;
    };
  }, [reloadKey, tripId]);

  useEffect(() => {
    let active = true;
    setTripInfoStatus('loading');

    void fetchTripInfo(tripId)
      .then(({ entries }) => {
        if (!active) return;
        setTripInfo(entries.filter((entry) => entry.isPinned));
        setTripInfoStatus('idle');
      })
      .catch(() => {
        if (!active) return;
        setTripInfoStatus('error');
      });

    return () => {
      active = false;
    };
  }, [tripId]);

  // One subject for the whole screen, and none at all once the traveller has
  // given the trip a cover of its own.
  const subject = trip ? tripEditorialSubject(trip) : null;
  const editorialImages = useEditorialImages(subject ? [subject] : []);
  const editorial = subject ? (editorialImages.get(editorialSubjectKey(subject)) ?? null) : null;

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
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        {backToTrips}
        <PageState kind="loading" loadingShape="list" scope="section" title={t('tripLoading')} />
      </div>
    );
  }

  if (status === 'missing' || status === 'error') {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        {backToTrips}
        <PageState
          actions={
            <>
              {status === 'error' ? (
                <Button onClick={() => setReloadKey((value) => value + 1)}>{t('tryAgain')}</Button>
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

  async function handleDelete() {
    if (!trip) return;
    setDeleting(true);
    setDeleteError(null);

    try {
      await deleteTrip(trip.id);
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
    <article className="mx-auto w-full max-w-5xl space-y-8">
      {backToTrips}

      {/* The trip's photograph carries its name rather than sitting beside it:
          this is the one screen where the cover is the subject. The scrim is a
          fixed dark wash in both themes, because what it has to stay legible
          against is a photograph, not the page. */}
      <section aria-labelledby="trip-detail-heading" className="relative isolate">
        <TripMedia
          alt={
            editorial
              ? mediaTranslations('alt.tripEditorial', { name: destinations ?? trip.name })
              : ''
          }
          className="w-full"
          // The page's Largest Contentful Paint by a distance.
          preload
          sizes="(max-width: 1023px) 100vw, 1024px"
          source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
          variant="hero"
        />
        {/* Bottom padding clears the credit chip the frame draws in the same
            corner. `pointer-events-none` keeps that credit clickable through
            this layer. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-end gap-2 rounded-[var(--radius-2xl)] bg-gradient-to-t from-surface-overlay from-25% via-surface-overlay/70 to-transparent p-5 pb-12 sm:p-8 sm:pb-14">
          <p className="text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] text-media-fallback-foreground/85 uppercase">
            {destinations ?? t('destinationOpen')}
          </p>
          <h1
            className="text-[length:var(--text-page-title)] leading-[1.08] font-semibold tracking-[-0.035em] text-pretty text-media-fallback-foreground md:text-[length:var(--text-immersive-title)] md:leading-[1.02]"
            id="trip-detail-heading"
          >
            {trip.name}
          </h1>
          <p className="text-[length:var(--text-metadata)] font-medium text-media-fallback-foreground/85 tabular-nums">
            {formatTripDateRange(trip.startDate, trip.endDate, locale)}
          </p>
        </div>
      </section>

      {deleteError ? (
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{deleteError}</AlertDescription>
        </Alert>
      ) : null}

      {/*
        Which actions a stage offers, in what order, and which one leads is the
        navigation contract's answer - the same one the trip's own screens use.
        On the trip's own route all three experiences are offered whatever the
        stage, because this is the screen that must never hide one of them.
      */}
      <div className="space-y-3">
        <TripLifecycleBadge lifecycle={trip.lifecycle} />
        <TripDestinationActions
          destinations={primaryTripDestinations(trip.id, trip.lifecycle, trip.startDate)}
          extra={
            <Button onClick={() => setEditing(true)} variant="ghost">
              <Pencil aria-hidden="true" data-icon="inline-start" />
              {t('editTrip')}
            </Button>
          }
          labelOverrides={
            trip.lifecycle === 'completed'
              ? { memories: t(trip.memoryCount ? 'viewMemories' : 'addMemories') }
              : {
                  itinerary: t('continuePlanning'),
                  mode: t(trip.lifecycle === 'active' ? 'openTripMode' : 'previewTripMode'),
                }
          }
          minEmphasis="quiet"
        />
      </div>

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

      {/* Reference, not headline: the actions and the score above are what the
          traveller came for, so these read quieter. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <TripFact
          label={t('destinations')}
          value={
            trip.destinations.length
              ? trip.destinations.map((destination) => destination.name).join(', ')
              : t('destinationOpen')
          }
        />
        <TripFact
          label={t('travellers')}
          value={
            <span className="flex items-center gap-1.5">
              <Users aria-hidden="true" className="size-4" />
              {t('travellerCount', { count: trip.partySize })}
            </span>
          }
        />
        <TripFact
          label={t('planningReadiness')}
          value={t(`readinessState.${trip.planningReadiness}`)}
        />
        <TripFact
          label={t('startingLocation')}
          value={trip.startingLocation?.name ?? t('startingLocationUnavailable')}
        />
      </div>

      {trip.notes ? (
        <TripFact
          label={t('notes')}
          value={<span className="whitespace-pre-wrap">{trip.notes}</span>}
        />
      ) : null}

      <nav aria-label={t('tripTools')} className="border-t border-border-subtle pt-5">
        <h2 className="text-base font-semibold">{t('tripTools')}</h2>
        <ItemGroup className="mt-3" variant="list">
          {supporting.map((destination) => {
            const Icon = supportingIcons[destination.section as keyof typeof supportingIcons];

            return (
              <Item key={destination.section} render={<Link href={destination.href} />} size="sm">
                <ItemMedia variant="icon">
                  <Icon aria-hidden="true" className="text-brand" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{t(destination.labelKey)}</ItemTitle>
                </ItemContent>
                <ChevronRight aria-hidden="true" className="size-4 text-text-subtle" />
              </Item>
            );
          })}
        </ItemGroup>
      </nav>

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
              <TripFact key={entry.id} label={entry.label} value={entry.value} />
            ))}
          </div>
        </EditorialSection>
      ) : null}

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
                setTrip(saved);
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
