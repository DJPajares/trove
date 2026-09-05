'use client';

import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Compass,
  ExternalLink,
  ListChecks,
  MapPin,
  Route,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { PageState } from '@/components/page-state';
import { usePreferences } from '@/components/preferences-provider';
import { TripLegBar } from '@/components/trip-leg-bar';
import { TripModeMemoryDialog } from '@/components/trip-mode-memory-dialog';
import { useTripModeData } from '@/components/trip-mode-data';
import { useTripModePreview } from '@/components/trip-mode-shell';
import {
  TripModeTaskList,
  TripModeTasksNotice,
  useTripModeTasks,
} from '@/components/trip-mode-tasks';
import { useOnlineStatus } from '@/components/trip-sync-status';
import { TripWeatherContext } from '@/components/trip-weather-context';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useNowTick } from '@/hooks/use-now-tick';
import type { ItineraryItem } from '@/lib/itinerary/api';
import { formatDistanceValue } from '@/lib/itinerary/format-distance';
import { formatItineraryTimeRange } from '@/lib/itinerary/item-timing';
import { TravelModeIcon } from '@/lib/itinerary/travel-mode';
import type { Reservation } from '@/lib/reservations/api';
import { defaultTripModeTaskContext, nowTaskGroups } from '@/lib/tasks/trip-mode';

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
  const itineraryT = useTranslations('itinerary');
  const memoryTranslations = useTranslations('memories.capture');
  const tasksT = useTranslations('tripMode.tasks');
  const [memoryOpen, setMemoryOpen] = useState(false);
  const locale = useLocale();
  const { preferences } = usePreferences();
  const online = useOnlineStatus();
  const { isPreview, withPreviewHref } = useTripModePreview();
  const { context, refresh, reservations: loadedReservations, status } = useTripModeData();
  const tripModeTasks = useTripModeTasks();
  const reservations = loadedReservations ?? [];
  const now = useNowTick(!isPreview);
  const currentItem = useMemo(
    () => context?.day?.items.find((item) => item.id === context.currentOrRelevant?.itemId) ?? null,
    [context],
  );
  const nextItem = useMemo(
    () => context?.day?.items.find((item) => item.id === context.nextItemId) ?? null,
    [context],
  );

  if (status === 'loading') return <TripModeNowSkeleton label={t('loading')} />;

  if (status === 'error' || !context) {
    return (
      <PageState
        actions={
          <>
            <Button onClick={() => void refresh()}>{t('tryAgain')}</Button>
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

  const readyContext = context;
  const nowZone = readyContext.day?.defaultTimeZone ?? readyContext.trip.referenceTimeZone;
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
  const formatSchedule = (item: ItineraryItem) => {
    if (item.localStartTime) {
      return formatItineraryTimeRange(item, locale, preferences.timeFormat);
    }
    if (item.startInstant) {
      const timeZone =
        item.timeZone ?? readyContext.day?.defaultTimeZone ?? readyContext.trip.referenceTimeZone;
      const start = timeFormat(item.startInstant, timeZone);
      if (!item.durationMinutes) return start;

      const end = new Date(new Date(item.startInstant).getTime() + item.durationMinutes * 60_000);
      return `${start} - ${timeFormat(end.toISOString(), timeZone)}`;
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
  const formatDistance = (meters: number) =>
    t('distance', {
      unit: t(`unit.${preferences.distanceUnit}`),
      value: formatDistanceValue(meters, preferences.distanceUnit, locale),
    });
  const nextName = nextItem ? itemName(nextItem, t('placeFallback')) : null;
  const hasNext = Boolean(nextItem && nextName);
  const route =
    readyContext.leaveBy?.destinationItemId === nextItem?.id ? readyContext.leaveBy : null;
  // The leg into the next item is owned by the current item. A flight has no
  // leave-by because Trove never estimates one, which is a different thing to say
  // than an estimate that has not arrived yet.
  const nextLegIsFlight = currentItem?.travelModeToNext === 'flight';
  const directions = online && nextItem && nextName ? directionsHref(nextItem, nextName) : null;
  // The two stops themselves. It draws the morning out of the daily base and
  // the evening back to it, which is most of a day and all of what a routed
  // estimate cannot reach.
  const legBar = readyContext.leg ? <TripLegBar context={readyContext} /> : null;
  const selectedDayId = readyContext.day?.id;
  const reservationDate = (reservation: Reservation) =>
    reservation.localDate ??
    reservation.flight?.departure?.localDate ??
    reservation.checkInDate ??
    null;
  const relevantReservation =
    reservations.find((reservation) => reservation.itineraryItem?.id === nextItem?.id) ??
    reservations.find((reservation) => reservation.itineraryItem?.id === currentItem?.id) ??
    reservations.find(
      (reservation) =>
        reservationDate(reservation) === readyContext.selectedDate ||
        reservation.applicableDays.some((day) => day.id === selectedDayId),
    ) ??
    null;
  const taskGroups = nowTaskGroups(tripModeTasks.data?.tasks ?? [], currentItem?.id, nextItem?.id);

  return (
    <div className="space-y-6">
      <div>
        {readyContext.day?.name ? (
          <h2 className="text-base font-semibold tracking-tight sm:text-lg">
            {readyContext.day.name}
          </h2>
        ) : (
          <h2 className="sr-only">{t('title')}</h2>
        )}
        <p className="text-[length:var(--text-metadata)] leading-5 font-medium text-muted-foreground tabular-nums">
          {readyContext.day?.name
            ? itineraryT('dayOption', { date, number: readyContext.day.number })
            : date}
        </p>
        {/* Naming the zone is what keeps a planned clock from reading as the
            phone's own. It costs one line, and it is the line that says so. */}
        <p className="mt-0.5 text-[length:var(--text-metadata)] leading-5 text-text-subtle tabular-nums">
          {t('localTime', {
            time: timeFormat(isPreview ? readyContext.contextAt : now.toISOString(), nowZone),
            timeZone: nowZone,
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
                <span className="[&_svg]:size-4">
                  <TravelModeIcon mode={route.mode} />
                </span>
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
          ) : nextLegIsFlight ? (
            <p className="mt-4 border-t border-border pt-4 text-sm leading-6 text-muted-foreground">
              {t('routeFlight')}
            </p>
          ) : !nextItem.startInstant ? (
            <p className="mt-4 border-t border-border pt-4 text-sm leading-6 text-muted-foreground">
              {t('timingFlexible')}
            </p>
          ) : readyContext.leg ? null : (
            <p className="mt-4 border-t border-border pt-4 text-sm leading-6 text-muted-foreground">
              {t('routeUnavailable')}
            </p>
          )}

          {legBar ? <div className="mt-4 border-t border-border pt-4">{legBar}</div> : null}

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
        <div className="space-y-4">
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
          {/* Nothing left to reach is not nothing left to do: the way back to
              where the day started is still a leg the traveller is on. */}
          {legBar ? (
            <div className="rounded-[var(--radius-xl)] border border-border bg-card p-4 shadow-[var(--shadow-surface)] sm:p-6">
              {legBar}
            </div>
          ) : null}
        </div>
      )}

      <TripWeatherContext
        isPreview={isPreview}
        selectedDate={readyContext.selectedDate}
        tripId={tripId}
      />

      <TripModeTasksNotice />

      {taskGroups.length ? (
        <section aria-labelledby="trip-mode-nearby-tasks-heading">
          <h3 className="text-sm font-semibold text-foreground" id="trip-mode-nearby-tasks-heading">
            {tasksT('nearbyTitle')}
          </h3>
          <div className="mt-2 divide-y divide-border border-y border-border">
            {taskGroups.map((group) => {
              const item = group.itemId === currentItem?.id ? currentItem : nextItem;
              return (
                <div className="py-3" key={`${group.kind}-${group.itemId}`}>
                  <p className="text-xs font-semibold tracking-[0.08em] text-brand uppercase">
                    {tasksT(group.kind)}
                  </p>
                  {item ? (
                    <p className="mt-1 text-sm font-medium text-foreground">
                      {itemName(item, t('placeFallback'))}
                    </p>
                  ) : null}
                  <TripModeTaskList className="mt-2" tasks={group.tasks} />
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {relevantReservation ? (
        <section aria-labelledby="trip-mode-context-heading">
          <h3 className="text-sm font-semibold text-foreground" id="trip-mode-context-heading">
            {t('supportingContext')}
          </h3>
          <ul className="mt-2 border-y border-border">
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
          </ul>
        </section>
      ) : null}

      {/* What the day offers doing, after the day has been described. When
          there is nothing next, the empty state has already offered Today and
          this row does not offer it a second time. */}
      <div className="flex flex-wrap gap-2 pt-4">
        <Button
          disabled={tripModeTasks.status !== 'ready'}
          onClick={() =>
            tripModeTasks.openCreate(
              defaultTripModeTaskContext({
                currentItemId: currentItem?.id,
                dayId: readyContext.day?.id,
                nextItemId: nextItem?.id,
              }),
            )
          }
          variant="outline"
        >
          <ListChecks aria-hidden="true" data-icon="inline-start" />
          {tasksT('add')}
        </Button>
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
    </div>
  );
}
