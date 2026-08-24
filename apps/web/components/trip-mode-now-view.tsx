'use client';

import {
  ArrowRight,
  CalendarDays,
  CarFront,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Compass,
  ExternalLink,
  Footprints,
  ListChecks,
  MapPin,
  Plane,
  Route,
  Sparkles,
  TramFront,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { PageState } from '@/components/page-state';
import { usePreferences } from '@/components/preferences-provider';
import { TripModeMemoryDialog } from '@/components/trip-mode-memory-dialog';
import { useTripModePreview } from '@/components/trip-mode-shell';
import { useOfflineDataRefreshKey, useOnlineStatus } from '@/components/trip-sync-status';
import { TripWeatherContext } from '@/components/trip-weather-context';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useTripModeClock } from '@/hooks/use-trip-mode-clock';
import {
  fetchTripModeContext,
  type ItineraryItem,
  type RouteTravelMode,
  type TripModeContext,
} from '@/lib/itinerary/api';
import {} from '@/lib/saved/api';
import { fetchReservations, type Reservation } from '@/lib/reservations/api';
import { fetchTasks, type Task } from '@/lib/tasks/api';

type LoadState =
  | { context: null; status: 'error' }
  | { context: null; status: 'loading' }
  | { context: TripModeContext; status: 'ready' };

type SupportingContext = { reservations: Reservation[]; tasks: Task[] };

function providerId(item: ItineraryItem | null) {
  return item?.tripPlace?.place.providerRefs.find((ref) => ref.provider === 'google')
    ?.externalPlaceId;
}

function itemName(item: ItineraryItem, fallback: string) {
  return (
    item.customLabel ??
    item.tripPlace?.place.name ??
    item.tripPlace?.place.snapshot?.name ??
    item.tripPlace?.place.providerLabel ??
    fallback
  );
}

function itemLocation(item: ItineraryItem) {
  return (
    item.customLocation?.label ??
    item.tripPlace?.place.snapshot?.address ??
    item.tripPlace?.place.providerAddress ??
    null
  );
}

function directionsHref(item: ItineraryItem, name: string) {
  const externalPlaceId = providerId(item);
  const location = item.tripPlace?.place.location;
  if (!externalPlaceId && !location) return null;

  const destination = location ? `${location.latitude},${location.longitude}` : name;
  const query = new URLSearchParams({ api: '1', destination });
  if (externalPlaceId) query.set('destination_place_id', externalPlaceId);
  return `https://www.google.com/maps/dir/?${query.toString()}`;
}

function travelIcon(mode: RouteTravelMode): ReactNode {
  if (mode === 'flight') return <Plane aria-hidden="true" />;
  if (mode === 'walk') return <Footprints aria-hidden="true" />;
  if (mode === 'transit') return <TramFront aria-hidden="true" />;
  return <CarFront aria-hidden="true" />;
}

function TripModeNowSkeleton({ label }: Readonly<{ label: string }>) {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-6" role="status">
      <span className="sr-only">{label}</span>
      <div className="space-y-3">
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-5 w-56" />
      </div>
      <Skeleton className="h-24 w-full rounded-[var(--radius-lg)]" />
      <Skeleton className="h-80 w-full rounded-[var(--radius-xl)]" />
    </div>
  );
}

export function TripModeNowView({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('tripMode.views.now');
  const memoryTranslations = useTranslations('memories.capture');
  const [memoryOpen, setMemoryOpen] = useState(false);
  const locale = useLocale();
  const { preferences } = usePreferences();
  const online = useOnlineStatus();
  const offlineDataRefreshKey = useOfflineDataRefreshKey();
  const { contextOptions, isPreview, withPreviewHref } = useTripModePreview();
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<LoadState>({ context: null, status: 'loading' });
  const [supporting, setSupporting] = useState<SupportingContext>({ reservations: [], tasks: [] });
  // A preview stands at a fixed hypothetical time, so it must never tick.
  const clockRefreshKey = useTripModeClock({
    context: state.context,
    enabled: !isPreview,
  });

  useEffect(() => {
    const controller = new AbortController();
    // A clock refresh replaces data that is already on screen, so only a first
    // load — or a reload after failure — is allowed to blank the view.
    setState((current) =>
      current.status === 'ready' ? current : { context: null, status: 'loading' },
    );
    void fetchTripModeContext(tripId, contextOptions(controller.signal))
      .then((context) => setState({ context, status: 'ready' }))
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setState({ context: null, status: 'error' });
        }
      });
    return () => controller.abort();
  }, [clockRefreshKey, contextOptions, offlineDataRefreshKey, reloadKey, tripId]);

  useEffect(() => {
    let active = true;
    setSupporting({ reservations: [], tasks: [] });
    void Promise.allSettled([fetchReservations(tripId), fetchTasks(tripId)]).then(
      ([reservationsResult, tasksResult]) => {
        if (!active) return;
        setSupporting({
          reservations:
            reservationsResult.status === 'fulfilled' ? reservationsResult.value.reservations : [],
          tasks: tasksResult.status === 'fulfilled' ? tasksResult.value.tasks : [],
        });
      },
    );
    return () => {
      active = false;
    };
  }, [offlineDataRefreshKey, reloadKey, tripId]);

  const context = state.context;
  const currentItem = useMemo(
    () => context?.day?.items.find((item) => item.id === context.currentOrRelevant?.itemId) ?? null,
    [context],
  );
  const nextItem = useMemo(
    () => context?.day?.items.find((item) => item.id === context.nextItemId) ?? null,
    [context],
  );

  if (state.status === 'loading') return <TripModeNowSkeleton label={t('loading')} />;

  if (state.status === 'error') {
    return (
      <PageState
        actions={
          <>
            <Button onClick={() => setReloadKey((value) => value + 1)}>{t('tryAgain')}</Button>
            <Button
              nativeButton={false}
              render={<Link href={withPreviewHref(`/trips/${tripId}/mode/today`)} />}
              variant="outline"
            >
              {t('openToday')}
            </Button>
          </>
        }
        description={t('loadErrorDescription')}
        headingLevel={2}
        icon={<Compass aria-hidden="true" />}
        kind="error"
        title={t('loadError')}
      />
    );
  }

  const { context: readyContext } = state;
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: 'full',
    timeZone: 'UTC',
  }).format(new Date(`${readyContext.selectedDate}T00:00:00.000Z`));
  const timeFormat = (value: string, timeZone: string) =>
    new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      hour12: preferences.timeFormat === '12h',
      minute: '2-digit',
      timeZone,
    }).format(new Date(value));
  const dateFormat = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(new Date(`${value}T00:00:00.000Z`));
  const formatSchedule = (item: ItineraryItem) => {
    if (item.startInstant) {
      return timeFormat(
        item.startInstant,
        item.timeZone ?? readyContext.day?.defaultTimeZone ?? readyContext.trip.referenceTimeZone,
      );
    }
    if (item.dayPart) return t(`dayPart.${item.dayPart}`);
    return t('scheduleFlexible');
  };
  const formatDuration = (seconds: number) => {
    const minutes = Math.max(1, Math.round(seconds / 60));
    if (minutes < 60) {
      return new Intl.NumberFormat(locale, {
        style: 'unit',
        unit: 'minute',
        unitDisplay: 'short',
      }).format(minutes);
    }
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    const hourText = new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'hour',
      unitDisplay: 'short',
    }).format(hours);
    const minuteText = new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'minute',
      unitDisplay: 'short',
    }).format(remainder);
    return remainder ? `${hourText} ${minuteText}` : hourText;
  };
  const formatDistance = (meters: number) => {
    const value = preferences.distanceUnit === 'mi' ? meters / 1609.344 : meters / 1000;
    const amount = new Intl.NumberFormat(locale, {
      maximumFractionDigits: value < 10 ? 1 : 0,
    }).format(value);
    return t('distance', { unit: t(`unit.${preferences.distanceUnit}`), value: amount });
  };
  const nextName = nextItem ? itemName(nextItem, t('placeFallback')) : null;
  const hasNext = Boolean(nextItem && nextName);
  const weatherItem = nextItem ?? currentItem;
  // One source for where the weather is. A provider Place's coordinates arrive
  // with the itinerary now, so this no longer reconciles a live lookup against a
  // separately keyed session cache to work out where the traveller is standing.
  const weatherCoordinates = weatherItem?.tripPlace?.place.location;
  const weatherLocation = weatherCoordinates
    ? {
        latitude: weatherCoordinates.latitude,
        longitude: weatherCoordinates.longitude,
        timeZone:
          weatherCoordinates.timeZone ??
          weatherItem?.timeZone ??
          readyContext.day?.defaultTimeZone ??
          readyContext.trip.referenceTimeZone,
      }
    : null;
  const route =
    readyContext.leaveBy?.destinationItemId === nextItem?.id ? readyContext.leaveBy : null;
  // The leg into the next item is owned by the current item. A flight has no
  // leave-by because Trove never estimates one, which is a different thing to say
  // than an estimate that has not arrived yet.
  const nextLegIsFlight = currentItem?.travelModeToNext === 'flight';
  const directions = online && nextItem && nextName ? directionsHref(nextItem, nextName) : null;
  const selectedDayId = readyContext.day?.id;
  const reservationDate = (reservation: Reservation) =>
    reservation.localDate ??
    reservation.flight?.departure?.localDate ??
    reservation.checkInDate ??
    null;
  const relevantReservation =
    supporting.reservations.find((reservation) => reservation.itineraryItem?.id === nextItem?.id) ??
    supporting.reservations.find(
      (reservation) => reservation.itineraryItem?.id === currentItem?.id,
    ) ??
    supporting.reservations.find(
      (reservation) =>
        reservationDate(reservation) === readyContext.selectedDate ||
        reservation.applicableDays.some((day) => day.id === selectedDayId),
    ) ??
    null;
  const relevantTask =
    supporting.tasks.find(
      (task) =>
        !task.completed &&
        task.context.kind === 'item' &&
        task.context.itineraryItemId === nextItem?.id,
    ) ??
    supporting.tasks.find(
      (task) =>
        !task.completed &&
        task.context.kind === 'item' &&
        task.context.itineraryItemId === currentItem?.id,
    ) ??
    supporting.tasks.find(
      (task) =>
        !task.completed &&
        (task.dueDate === readyContext.selectedDate ||
          (task.context.kind === 'day' && task.context.itineraryDayId === selectedDayId)),
    ) ??
    null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="sr-only">{t('title')}</h2>
        <p className="text-[length:var(--text-metadata)] leading-5 font-medium text-muted-foreground tabular-nums">
          {date}
        </p>
        {/* Naming the zone is what keeps a planned clock from reading as the
            phone's own. It costs one line, and it is the line that says so. */}
        <p className="mt-0.5 text-[length:var(--text-metadata)] leading-5 text-text-subtle">
          {t('timeZone', {
            timeZone: readyContext.day?.defaultTimeZone ?? readyContext.trip.referenceTimeZone,
          })}
        </p>
      </div>

      {readyContext.day ? (
        <TripModeMemoryDialog
          dayDate={date}
          dayId={readyContext.day.id}
          defaultItemId={currentItem?.id ?? null}
          items={readyContext.day.items}
          onOpenChange={setMemoryOpen}
          onSaved={() => setMemoryOpen(false)}
          open={memoryOpen}
          timeZone={readyContext.day.defaultTimeZone}
          tripId={tripId}
        />
      ) : null}

      {/* What is happening now leads. Everything below it answers "and then
          what" — the order the traveller asks the questions in. */}
      {currentItem && readyContext.currentOrRelevant ? (
        <section
          aria-labelledby="trip-mode-current-heading"
          className="border-y border-border py-4"
        >
          <p className="text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] text-brand uppercase">
            {t(`currentKind.${readyContext.currentOrRelevant.kind}`)}
          </p>
          <h3
            className="mt-1.5 text-[length:var(--text-section-title)] leading-[1.18] font-semibold tracking-[-0.022em] text-pretty text-foreground"
            id="trip-mode-current-heading"
          >
            {itemName(currentItem, t('placeFallback'))}
          </h3>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-sm leading-6 text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <Clock3 aria-hidden="true" className="size-4 shrink-0" />
              {formatSchedule(currentItem)}
            </span>
            {itemLocation(currentItem) ? (
              <span className="inline-flex min-w-0 items-start gap-2">
                <MapPin aria-hidden="true" className="mt-1 size-4 shrink-0" />
                <span className="min-w-0">{itemLocation(currentItem)}</span>
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-xs leading-5 text-text-subtle">{t('locationDisclaimer')}</p>
        </section>
      ) : null}

      {readyContext.state === 'free_time' ? (
        <div className="flex items-start gap-3 rounded-[var(--radius-lg)] bg-secondary/65 px-4 py-4">
          <Clock3 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand" />
          <div>
            <p className="font-medium text-foreground">{t('freeTimeTitle')}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {t('freeTimeDescription')}
            </p>
          </div>
        </div>
      ) : null}

      {nextItem && nextName ? (
        <section
          aria-labelledby="trip-mode-next-heading"
          className="rounded-[var(--radius-xl)] border border-border bg-card p-4 shadow-[var(--shadow-surface)] sm:p-6"
        >
          <div className="flex items-center gap-2 text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] text-brand uppercase">
            <ArrowRight aria-hidden="true" className="size-4" />
            {t('nextLabel')}
          </div>
          <div className="mt-3 grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
            <div className="min-w-0">
              <h3
                className="text-[length:var(--text-section-title)] leading-[1.18] font-semibold tracking-[-0.022em] text-pretty text-foreground"
                id="trip-mode-next-heading"
              >
                {nextName}
              </h3>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-sm leading-6 text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <Clock3 aria-hidden="true" className="size-4 shrink-0" />
                  {formatSchedule(nextItem)}
                </span>
                {itemLocation(nextItem) ? (
                  <span className="inline-flex min-w-0 items-start gap-2">
                    <MapPin aria-hidden="true" className="mt-1 size-4 shrink-0" />
                    <span className="min-w-0">{itemLocation(nextItem)}</span>
                  </span>
                ) : null}
              </div>
            </div>

            {route ? (
              <div className="md:min-w-44 md:border-l md:border-border md:pl-6">
                <p className="text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                  {t('leaveByLabel')}
                </p>
                <p className="mt-1 text-2xl leading-tight font-semibold tracking-[-0.02em] text-foreground tabular-nums">
                  {timeFormat(
                    route.at,
                    nextItem.timeZone ??
                      readyContext.day?.defaultTimeZone ??
                      readyContext.trip.referenceTimeZone,
                  )}
                </p>
              </div>
            ) : null}
          </div>

          {/* A leg that was never going to be estimated, an estimate that has
              not arrived, and an item with no fixed start are three different
              things, and each of them says which one it is. */}
          {route ? (
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-4 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <span className="[&_svg]:size-4">{travelIcon(route.mode)}</span>
                {t('travelEstimate', {
                  duration: formatDuration(route.routeDurationSeconds),
                  mode: t(`travelMode.${route.mode}`),
                })}
              </span>
              {route.distanceMeters !== null ? (
                <span>{formatDistance(route.distanceMeters)}</span>
              ) : null}
              {route.provider === 'google' ? (
                <span className="w-full text-xs text-text-subtle">{t('googleAttribution')}</span>
              ) : null}
            </div>
          ) : (
            <p className="mt-4 border-t border-border pt-4 text-sm leading-6 text-muted-foreground">
              {nextLegIsFlight
                ? t('routeFlight')
                : nextItem.startInstant
                  ? t('routeUnavailable')
                  : t('timingFlexible')}
            </p>
          )}

          {directions ? (
            <div className="mt-4">
              <Button
                nativeButton={false}
                render={
                  <a
                    aria-label={t('directionsExternal')}
                    href={directions}
                    rel="noreferrer"
                    target="_blank"
                  />
                }
              >
                <Route aria-hidden="true" data-icon="inline-start" />
                {t('directions')}
                <ExternalLink aria-hidden="true" data-icon="inline-end" />
              </Button>
            </div>
          ) : null}
        </section>
      ) : (
        <PageState
          actions={
            <Button
              nativeButton={false}
              render={<Link href={withPreviewHref(`/trips/${tripId}/mode/today`)} />}
            >
              {t('openToday')}
            </Button>
          }
          className="py-4"
          description={
            readyContext.state === 'no_day'
              ? t('noDayDescription', { date })
              : t('noNextDescription')
          }
          headingLevel={2}
          icon={<Clock3 aria-hidden="true" />}
          title={readyContext.state === 'no_day' ? t('noDayTitle') : t('noNextTitle')}
        />
      )}

      <TripWeatherContext
        isPreview={isPreview}
        location={weatherLocation}
        selectedDate={readyContext.selectedDate}
      />

      {relevantReservation || relevantTask ? (
        <section aria-labelledby="trip-mode-context-heading">
          <h3 className="text-sm font-semibold text-foreground" id="trip-mode-context-heading">
            {t('supportingContext')}
          </h3>
          <ul className="mt-2 border-y border-border">
            {relevantReservation ? (
              <li>
                <Link
                  className="flex min-h-14 items-center gap-3 rounded-[var(--radius-sm)] py-2.5 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
                  href={`/trips/${tripId}/reservations`}
                >
                  <ClipboardCheck aria-hidden="true" className="size-5 shrink-0 text-brand" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {relevantReservation.title}
                    </span>
                    {relevantReservation.bookingReference || relevantReservation.localTime ? (
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {relevantReservation.bookingReference
                          ? t('bookingReference', {
                              reference: relevantReservation.bookingReference,
                            })
                          : relevantReservation.localTime}
                      </span>
                    ) : null}
                  </span>
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-text-subtle" />
                </Link>
              </li>
            ) : null}
            {relevantTask ? (
              <li className={relevantReservation ? 'border-t border-border' : undefined}>
                <Link
                  className="flex min-h-14 items-center gap-3 rounded-[var(--radius-sm)] py-2.5 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
                  href={`/trips/${tripId}/tasks`}
                >
                  <ListChecks aria-hidden="true" className="size-5 shrink-0 text-brand" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {relevantTask.label}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {relevantTask.dueDate
                        ? t('taskDue', { date: dateFormat(relevantTask.dueDate) })
                        : t('taskContext')}
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-text-subtle" />
                </Link>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {/* What the day offers doing, after the day has been described. When
          there is nothing next, the empty state has already offered Today and
          this row does not offer it a second time. */}
      {hasNext || readyContext.day ? (
        <div className="flex flex-wrap gap-2 border-t border-border-subtle pt-4">
          {hasNext ? (
            <Button
              nativeButton={false}
              render={<Link href={withPreviewHref(`/trips/${tripId}/mode/today`)} />}
              variant="outline"
            >
              <CalendarDays aria-hidden="true" data-icon="inline-start" />
              {t('openToday')}
            </Button>
          ) : null}
          {readyContext.day ? (
            <Button onClick={() => setMemoryOpen(true)} variant="outline">
              <Sparkles aria-hidden="true" data-icon="inline-start" />
              {memoryTranslations('quickAction')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
