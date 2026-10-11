'use client';

import { Camera, Check, ChevronRight, Clock3, MapPin, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type ReactNode } from 'react';

import { PageState } from '@/components/page-state';
import { PlaceHoursNote } from '@/components/place-hours-note';
import { PlaceMedia } from '@/components/place-media';
import { usePreferences } from '@/components/preferences-provider';
import { TripLegBar } from '@/components/trip-leg-bar';
import { TripModeMemorySheet } from '@/components/trip-mode-memory-sheet';
import { useTripModeData } from '@/components/trip-mode-data';
import { useTripModePlaceDetails, useTripModePreview } from '@/components/trip-mode-shell';
import {
  TripModeTaskList,
  TripModeTasksNotice,
  useTripModeTasks,
} from '@/components/trip-mode-tasks';
import { useOnlineStatus } from '@/components/trip-sync-status';
import { TripWeatherContext } from '@/components/trip-weather-context';
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import { useNowTick } from '@/hooks/use-now-tick';
import { useTripPlaceHours } from '@/lib/trip-places/use-trip-place-hours';
import {
  deviceTimeZone,
  type ItineraryItem,
  type ItineraryTravelStatus,
  type ItineraryTripPlace,
  updateItineraryItemTravelStatus,
} from '@/lib/itinerary/api';
import { dayTown } from '@/lib/itinerary/day-place';
import { formatDistanceValue, formatEstimatedDistance } from '@/lib/itinerary/format-distance';
import { formatItineraryTimeRange } from '@/lib/itinerary/item-timing';
import { placeVisitDate, scheduledPlaceUse } from '@/lib/itinerary/places';
import { haversineMeters } from '@/lib/maps/haversine';
import {
  editorialCoverImage,
  editorialSubjectKey,
  type EditorialImageReference,
  type EditorialSubject,
} from '@/lib/media/editorial-images';
import { resolvePlaceMediaSource } from '@/lib/media/trip-media';
import { cn } from '@/lib/utils';
import type { Reservation } from '@/lib/reservations/api';
import { defaultTripModeTaskContext, nowTaskGroups } from '@/lib/tasks/trip-mode';
import {
  resolveItineraryItemPlaceName,
  resolvePlacePhotoName,
  resolveTripPlaceName,
} from '@/lib/trip-places/place-name';
import * as Icons from '@/lib/icons';

/**
 * Inside this many minutes the next move stops waiting below the place and
 * becomes the screen: the dock floods terracotta and the stop being left shrinks
 * to one row. Ten minutes is about the time it takes to pay, find the exit and
 * look up which way to walk.
 */
const LEAVE_SOON_MINUTES = 10;

/** Free time offers a handful of places, close enough to walk to and back. */
const FREE_TIME_NEARBY_LIMIT = 3;
const FREE_TIME_NEARBY_RADIUS_METERS = 1_500;

/**
 * The dock that carries the next move. It is the one dark surface on a light
 * screen - fixed in both themes, like every surface Trove prints on a photo, so
 * the leg bar's inverse ink always has the ground it was drawn for. In dark
 * mode a hairline keeps it from dissolving into the page.
 *
 * Leaving soon floods it terracotta. In dark mode, where Trove's terracotta is
 * pale and would take dark ink, the urgency is carried by a terracotta ring,
 * countdown and button on the same dark ground instead.
 */
function dockTone(leavingSoon: boolean) {
  return leavingSoon
    ? {
        button:
          'bg-primary-foreground text-accent-strong hover:bg-primary-foreground/90 hover:text-accent-strong dark:bg-accent-strong dark:text-[color:var(--score-media-background)] dark:hover:bg-accent-strong/90 dark:hover:text-[color:var(--score-media-background)]',
        countdown: 'dark:text-accent-strong',
        eyebrow: 'text-primary-foreground dark:text-accent-strong',
        muted: 'text-primary-foreground/85 dark:text-[color:var(--score-media-muted)]',
        rule: 'border-primary-foreground/20 dark:border-[color:var(--score-media-foreground)]/12',
        secondary:
          'border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground dark:border-[color:var(--score-media-foreground)]/25 dark:text-[color:var(--score-media-foreground)] dark:hover:text-[color:var(--score-media-foreground)]',
        surface:
          'bg-accent-strong text-primary-foreground dark:bg-[color:var(--score-media-background)] dark:text-[color:var(--score-media-foreground)] dark:ring-1 dark:ring-accent-strong',
      }
    : {
        button:
          'bg-[color:var(--score-media-brand)] text-[color:var(--score-media-background)] hover:bg-[color:var(--score-media-brand)]/90 hover:text-[color:var(--score-media-background)]',
        countdown: '',
        eyebrow: 'text-[color:var(--score-media-brand)]',
        muted: 'text-[color:var(--score-media-muted)]',
        rule: 'border-[color:var(--score-media-foreground)]/12',
        secondary:
          'border-[color:var(--score-media-foreground)]/25 bg-transparent text-[color:var(--score-media-foreground)] hover:bg-[color:var(--score-media-foreground)]/10 hover:text-[color:var(--score-media-foreground)]',
        surface:
          'bg-[color:var(--score-media-background)] text-[color:var(--score-media-foreground)] dark:ring-1 dark:ring-border',
      };
}

function providerId(item: ItineraryItem | null) {
  return item?.tripPlace?.place.providerRefs.find((ref) => ref.provider === 'google')
    ?.externalPlaceId;
}

/**
 * What a stop is called, through the one chain the rest of the app uses. Its own
 * copy skipped `tripPlace.customName`, so a stop the traveller had named showed
 * Google's name instead of theirs.
 */
function itemName(item: ItineraryItem, fallback: string) {
  return resolveItineraryItemPlaceName(item, fallback);
}

function itemLocation(item: ItineraryItem) {
  return (
    item.customLocation?.label ??
    item.tripPlace?.place.snapshot?.address ??
    item.tripPlace?.place.providerAddress ??
    null
  );
}

/**
 * The place a labelled stop refers to.
 *
 * "Breakfast before the drive" is a plan, not a door. When the traveller's own
 * label is the title, the place it stands for leads the line beneath it and the
 * address follows. A stop with no label is already titled by its place, and so
 * is one whose label repeats it - which is most of an AI-planned day.
 */
function itemPlace(item: ItineraryItem, locale: string) {
  const label = item.customLabel?.trim();
  if (!label || !item.tripPlace) return null;

  const name = resolveTripPlaceName(item.tripPlace, { custom: '', provider: '' }).trim();
  if (!name || name.localeCompare(label, locale, { sensitivity: 'accent' }) === 0) return null;
  return name;
}

/** Where a stop is: the place it refers to, then the street it is on. */
function ItemWhere({ item }: Readonly<{ item: ItineraryItem }>) {
  const locale = useLocale();
  const place = itemPlace(item, locale);
  const location = itemLocation(item);
  if (!place && !location) return null;

  return (
    <span className="inline-flex min-w-0 items-start gap-2">
      <MapPin aria-hidden="true" className="mt-1 size-4 shrink-0" />
      <span className="min-w-0">
        {place ? <span className="font-medium text-foreground">{place}</span> : null}
        {place && location ? <span aria-hidden="true"> · </span> : null}
        {location}
      </span>
    </span>
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

function photoSubject(item: ItineraryItem | null): EditorialSubject | null {
  const providerName = item?.tripPlace ? resolvePlacePhotoName(item.tripPlace) : null;
  if (!item?.tripPlace || !providerName) return null;
  return {
    category: item.tripPlace.place.snapshot?.category,
    name: providerName,
    placeId: item.tripPlace.place.id,
  };
}

/**
 * The hero above a place's name is a claim about that place, so it takes only a
 * photograph of it. A generic or contextual match would be a picture of
 * somewhere else under the words naming here; the branded tile for the place's
 * category is the honest stand-in.
 */
function exactPhoto(images: readonly EditorialImageReference[] | undefined) {
  return images?.find((image) => (image.matchKind ?? 'exact') === 'exact') ?? null;
}

/** One of the four things a traveller does at a stop, a thumb's width each. */
function QuickAction({
  children,
  disabled,
  href,
  icon,
  label,
  onClick,
  tone = 'muted',
}: Readonly<{
  children: ReactNode;
  disabled?: boolean;
  href?: string;
  icon: ReactNode;
  label?: string;
  onClick?: () => void;
  tone?: 'brand' | 'muted';
}>) {
  const className = cn(
    'h-14 flex-col gap-1 rounded-[var(--radius-lg)] px-1 text-xs font-semibold whitespace-normal',
    tone === 'brand'
      ? 'border-transparent bg-secondary text-secondary-foreground'
      : 'border-transparent bg-muted text-foreground hover:bg-surface-hover',
  );
  return href ? (
    <Button
      aria-label={label}
      className={className}
      nativeButton={false}
      render={<Link href={href} />}
      variant="ghost"
    >
      {icon}
      {children}
    </Button>
  ) : (
    <Button
      aria-label={label}
      className={className}
      disabled={disabled}
      onClick={onClick}
      variant="ghost"
    >
      {icon}
      {children}
    </Button>
  );
}

function TripModeNowSkeleton({ label }: Readonly<{ label: string }>) {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-4" role="status">
      <span className="sr-only">{label}</span>
      <div className="space-y-2.5">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-1 w-full" />
      </div>
      <Skeleton className="h-96 w-full rounded-[var(--radius-2xl)]" />
      <Skeleton className="h-44 w-full rounded-[1.75rem]" />
    </div>
  );
}

type Feedback = {
  message: string;
  undo?: { itemId: string; travelStatus: ItineraryTravelStatus };
};

export function TripModeNowView({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('tripMode.views.now');
  const memoryTranslations = useTranslations('memories.capture');
  const tasksT = useTranslations('tripMode.tasks');
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locale = useLocale();
  const { preferences, profile } = usePreferences();
  const online = useOnlineStatus();
  const { isPreview, withPreviewHref } = useTripModePreview();
  const { openPlaceDetails } = useTripModePlaceDetails();
  const {
    context,
    itinerary,
    refresh,
    reservations: loadedReservations,
    status,
  } = useTripModeData();
  const tripModeTasks = useTripModeTasks();
  // Stored hours for the day being shown; nothing is bought to fill a gap.
  const placeHours = useTripPlaceHours(tripId, context?.selectedDate ?? null, Boolean(context));
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
  // The free, decorative track only, for the two stops on screen.
  const currentSubject = photoSubject(currentItem);
  const nextSubject = photoSubject(nextItem);
  const photoSubjects = [currentSubject, nextSubject].filter(
    (subject): subject is EditorialSubject => subject !== null,
  );
  const editorialImages = useEditorialImages(photoSubjects);

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
        icon={<Icons.Error aria-hidden="true" />}
        kind="error"
        title={t('loadError')}
      />
    );
  }

  const readyContext = context;
  // The traveller's own clock. A trip keeps a reference zone for its lifecycle,
  // which deliberately does not move when its owner flies - but what time it is
  // right now is a question about where they are standing, not where the trip
  // was planned. Preview keeps the trip's zone, since nobody is standing in the
  // day being previewed.
  const nowZone = isPreview
    ? (readyContext.day?.defaultTimeZone ?? readyContext.trip.referenceTimeZone)
    : (deviceTimeZone() ??
      readyContext.day?.defaultTimeZone ??
      readyContext.trip.referenceTimeZone);
  const clockAt = isPreview ? readyContext.contextAt : now.toISOString();
  // What time it is where the traveller left. Worth a line only while it is a
  // different answer from the clock above - at home, or on a trip that never
  // crossed a zone, it would just say the same thing twice.
  const homeZone =
    profile?.homeTimeZone && profile.homeTimeZone !== nowZone ? profile.homeTimeZone : null;
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: 'full',
    timeZone: 'UTC',
  }).format(new Date(`${readyContext.selectedDate}T00:00:00.000Z`));
  const shortDate = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
      weekday: 'short',
    }).format(new Date(`${value}T00:00:00.000Z`));
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
      // An instant is shown on the clock the traveller is reading, the same one
      // the rest of Trip Mode measures against.
      const timeZone = nowZone;
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

  const day = readyContext.day;
  const itineraryDay = itinerary?.days.find((candidate) => candidate.id === day?.id) ?? null;
  const dayTitle =
    day?.name?.trim() ||
    (itineraryDay && itinerary ? dayTown(itineraryDay, itinerary.tripPlaces) : null) ||
    shortDate(readyContext.selectedDate);
  const dayItems = day?.items ?? [];
  const settledCount = dayItems.filter((item) => item.travelStatus !== 'upcoming').length;
  const currentIndex = currentItem ? dayItems.findIndex((item) => item.id === currentItem.id) : -1;
  /**
   * How far through the stop in progress the clock is, when the plan says how
   * long it lasts. A stop with no length shows as under way rather than at a
   * made-up fraction.
   */
  const currentFraction = (() => {
    if (!currentItem?.startInstant || !currentItem.durationMinutes) return 1;
    const elapsed = new Date(clockAt).getTime() - new Date(currentItem.startInstant).getTime();
    return Math.min(1, Math.max(0.04, elapsed / (currentItem.durationMinutes * 60_000)));
  })();

  const nextName = nextItem ? itemName(nextItem, t('placeFallback')) : null;
  const hasNext = Boolean(nextItem && nextName);
  const route =
    readyContext.leaveBy?.destinationItemId === nextItem?.id ? readyContext.leaveBy : null;
  /**
   * How long is left, not what the clock will say.
   *
   * "Leave by 14:05" makes a traveller do arithmetic against a watch they have
   * to find first; "Leave in 12 min" is the same fact already answered. The
   * absolute time stays beside it, because it is the one that survives the
   * screen being put away.
   *
   * Re-read from the same instant the rest of the view is drawn at, so it ticks
   * with the minute in live mode and stands still in preview.
   */
  const leaveInMinutes = route
    ? Math.round((new Date(route.at).getTime() - new Date(clockAt).getTime()) / 60_000)
    : null;
  const leaveCountdown =
    leaveInMinutes === null
      ? null
      : leaveInMinutes <= 0
        ? t('leaveNow')
        : leaveInMinutes < 60
          ? t('leaveInMinutes', { minutes: leaveInMinutes })
          : t('leaveInHours', {
              hours: Math.floor(leaveInMinutes / 60),
              minutes: leaveInMinutes % 60,
            });
  const leavingSoon = leaveInMinutes !== null && leaveInMinutes <= LEAVE_SOON_MINUTES;
  const dock = dockTone(leavingSoon);
  // The leg into the next item is owned by the current item. A flight has no
  // leave-by because Trove never estimates one, which is a different thing to say
  // than an estimate that has not arrived yet.
  const nextLegIsFlight = currentItem?.travelModeToNext === 'flight';
  const directions = online && nextItem && nextName ? directionsHref(nextItem, nextName) : null;
  // The two stops themselves. It draws the morning out of the daily base and
  // the evening back to it, which is most of a day and all of what a routed
  // estimate cannot reach.
  const legBar = readyContext.leg ? <TripLegBar context={readyContext} inverse /> : null;
  const selectedDayId = day?.id;
  const reservationDate = (reservation: Reservation) =>
    reservation.localDate ??
    reservation.flight?.departure?.localDate ??
    reservation.checkInDate ??
    null;
  const nextReservation = nextItem
    ? (reservations.find((reservation) => reservation.itineraryItem?.id === nextItem.id) ?? null)
    : null;
  const currentReservation = currentItem
    ? (reservations.find((reservation) => reservation.itineraryItem?.id === currentItem.id) ?? null)
    : null;
  // Kept close only when neither stop on screen already carries it as a button.
  const dayReservation =
    nextReservation || currentReservation
      ? null
      : (reservations.find(
          (reservation) =>
            reservationDate(reservation) === readyContext.selectedDate ||
            reservation.applicableDays.some((candidate) => candidate.id === selectedDayId),
        ) ?? null);
  const taskGroups = nowTaskGroups(tripModeTasks.data?.tasks ?? [], currentItem?.id, nextItem?.id);
  const openCount = (kind: 'here' | 'next') =>
    taskGroups.find((group) => group.kind === kind)?.tasks.filter((task) => !task.completed)
      .length ?? 0;
  const hereTaskCount = openCount('here');
  const nextTaskCount = openCount('next');
  const canComplete = Boolean(currentItem && currentItem.travelStatus === 'upcoming');
  const freeTime = readyContext.state === 'free_time' && !currentItem;
  const dayComplete = readyContext.state === 'no_next_item' && !currentItem && dayItems.length > 0;

  const placeUse = itinerary ? scheduledPlaceUse(itinerary) : {};
  /**
   * Trip Places nobody has put on a day yet, within a walk of where the plan
   * puts the traveller - never where their device is, which Now does not ask
   * for. The leg's own origin is that position: the stop just left, or the base.
   */
  const plannedPosition =
    readyContext.leg?.origin.coordinate ?? nextItem?.tripPlace?.place.location ?? null;
  const nearbyPlaces =
    freeTime && itinerary && plannedPosition
      ? itinerary.tripPlaces
          .filter((tripPlace) => tripPlace.place.location && !placeUse[tripPlace.id]?.itemCount)
          .map((tripPlace) => ({
            distance: haversineMeters(plannedPosition, tripPlace.place.location!),
            tripPlace,
          }))
          .filter(({ distance }) => distance <= FREE_TIME_NEARBY_RADIUS_METERS)
          .sort((a, b) => a.distance - b.distance)
          .slice(0, FREE_TIME_NEARBY_LIMIT)
      : [];
  const tomorrowIndex = itinerary
    ? itinerary.days.findIndex((candidate) => candidate.date === readyContext.selectedDate) + 1
    : 0;
  const tomorrow = dayComplete && itinerary ? (itinerary.days[tomorrowIndex] ?? null) : null;
  const tomorrowFirst = tomorrow?.items[0] ?? null;

  const subjectPhoto = (subject: EditorialSubject | null) =>
    subject ? editorialImages.get(editorialSubjectKey(subject)) : undefined;
  const currentPhoto = exactPhoto(subjectPhoto(currentSubject));
  const nextThumb = nextSubject
    ? editorialCoverImage(subjectPhoto(nextSubject), nextSubject.placeId ?? nextSubject.name)
    : null;

  async function setTravelStatus(item: ItineraryItem, travelStatus: ItineraryTravelStatus) {
    const previous = item.travelStatus;
    setBusyItemId(item.id);
    setError(null);
    setFeedback(null);
    try {
      await updateItineraryItemTravelStatus(tripId, item.id, travelStatus);
      await refresh();
      setFeedback({
        message: t('feedbackDone', { name: itemName(item, t('placeFallback')) }),
        undo: { itemId: item.id, travelStatus: previous },
      });
    } catch {
      setError(t('actionError'));
    } finally {
      setBusyItemId(null);
    }
  }

  async function undoTravelStatus() {
    const undo = feedback?.undo;
    if (!undo) return;
    setBusyItemId(undo.itemId);
    setError(null);
    try {
      await updateItineraryItemTravelStatus(tripId, undo.itemId, undo.travelStatus);
      await refresh();
      setFeedback({ message: t('feedbackUndone') });
    } catch {
      setError(t('actionError'));
    } finally {
      setBusyItemId(null);
    }
  }

  const openStopTasks = () =>
    hereTaskCount
      ? document
          .getElementById('trip-mode-nearby-tasks')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      : currentItem && tripModeTasks.openCreate({ itineraryItemId: currentItem.id, kind: 'item' });

  const currentName = currentItem ? itemName(currentItem, t('placeFallback')) : null;
  const currentSchedule = currentItem ? formatSchedule(currentItem) : null;
  const hereRow = Boolean(currentItem && leavingSoon && hasNext);

  return (
    <div className="space-y-4">
      {/* Where the day is, in one line, and how far through it the traveller
          is. The header above holds only the way out and the trip's name. */}
      <section aria-labelledby="trip-mode-day-heading" className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2
            className="min-w-0 truncate text-[0.9375rem] leading-6 font-semibold text-foreground"
            id="trip-mode-day-heading"
          >
            {day ? t('dayLine', { name: dayTitle, number: day.number }) : date}
          </h2>
          {dayItems.length ? (
            <p className="shrink-0 text-[length:var(--text-metadata)] text-muted-foreground tabular-nums">
              {currentIndex >= 0
                ? t('stopProgress', { current: currentIndex + 1, total: dayItems.length })
                : t('doneProgress', { done: settledCount, total: dayItems.length })}
            </p>
          ) : null}
        </div>
        {dayItems.length ? (
          <div aria-hidden="true" className="flex gap-1">
            {dayItems.map((item) => {
              const isCurrent = item.id === currentItem?.id;
              return item.travelStatus === 'skipped' ? (
                <span
                  className="mt-px h-0.5 flex-1 border-t-2 border-dotted border-border-strong"
                  key={item.id}
                />
              ) : (
                <span
                  className="flex h-1 flex-1 overflow-hidden rounded-full bg-border"
                  key={item.id}
                >
                  {item.travelStatus === 'completed' ? (
                    <span className="w-full rounded-full bg-brand" />
                  ) : isCurrent ? (
                    <span
                      className="rounded-full bg-accent-strong"
                      style={{ width: `${Math.round(currentFraction * 100)}%` }}
                    />
                  ) : null}
                </span>
              );
            })}
          </div>
        ) : null}
        {/* Home time earns its line only when it is a different answer. */}
        {homeZone ? (
          <p className="text-[length:var(--text-metadata)] leading-5 text-text-subtle tabular-nums">
            {t('homeTime', {
              time: timeFormat(clockAt, homeZone),
              timeZone: homeZone,
            })}
          </p>
        ) : null}
      </section>

      {day ? (
        <TripModeMemorySheet
          dayDate={date}
          dayId={day.id}
          defaultItemId={currentItem?.id ?? null}
          items={day.items}
          onOpenChange={setMemoryOpen}
          onSaved={() => setMemoryOpen(false)}
          open={memoryOpen}
          timeZone={day.defaultTimeZone}
          tripId={tripId}
        />
      ) : null}

      {/* Here. Leaving soon, it steps back to one row so the move can lead. */}
      {currentItem && currentName && readyContext.currentOrRelevant ? (
        hereRow ? (
          <section
            aria-labelledby="trip-mode-current-heading"
            className="flex items-center gap-3 rounded-[var(--radius-xl)] border border-border-subtle bg-card p-3 shadow-[var(--shadow-control)]"
          >
            <PlaceMedia
              alt=""
              category={currentItem.tripPlace?.place.snapshot?.category}
              className="size-13 shrink-0 rounded-[var(--radius-md)]"
              sizes="3.25rem"
              source={resolvePlaceMediaSource({ editorial: currentPhoto })}
              variant="thumbnail"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[length:var(--text-metadata)] text-muted-foreground tabular-nums">
                {t('wrappingUp', { schedule: currentSchedule ?? '' })}
              </p>
              <h3
                className="truncate text-base font-semibold text-foreground"
                id="trip-mode-current-heading"
              >
                {currentName}
              </h3>
            </div>
            {canComplete ? (
              <Button
                aria-label={t('completeItem', { name: currentName })}
                disabled={busyItemId === currentItem.id}
                onClick={() => void setTravelStatus(currentItem, 'completed')}
                variant="secondary"
              >
                <Check aria-hidden="true" data-icon="inline-start" />
                {t('done')}
              </Button>
            ) : null}
          </section>
        ) : (
          <section
            aria-labelledby="trip-mode-current-heading"
            className="overflow-hidden rounded-[var(--radius-2xl)] border border-border-subtle bg-card shadow-[var(--shadow-card)]"
          >
            <div className="relative">
              <PlaceMedia
                alt=""
                category={currentItem.tripPlace?.place.snapshot?.category}
                className="h-44 w-full rounded-none sm:h-56"
                sizes="(max-width: 72rem) 100vw, 72rem"
                source={resolvePlaceMediaSource({ editorial: currentPhoto })}
                variant="banner"
              />
              <p className="absolute start-3 top-3 inline-flex h-8 items-center gap-2 rounded-full bg-[color:var(--score-media-background)] px-3 text-[length:var(--text-metadata)] font-semibold text-[color:var(--score-media-foreground)]">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
                {t(`currentKind.${readyContext.currentOrRelevant.kind}`)}
              </p>
            </div>
            <div className="space-y-4 p-4 sm:p-5">
              <div>
                {/* Where the traveller is standing is the answer this screen
                    exists to give, so it is set in the voice Trove keeps for
                    places that matter. */}
                <h3
                  className="font-journal text-[2.125rem] leading-[1.05] font-normal tracking-[-0.01em] text-balance text-foreground [overflow-wrap:anywhere]"
                  id="trip-mode-current-heading"
                >
                  {currentName}
                </h3>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm leading-6 text-muted-foreground">
                  <span className="inline-flex items-center gap-2 tabular-nums">
                    <Clock3 aria-hidden="true" className="size-4 shrink-0" />
                    {currentSchedule}
                  </span>
                  <PlaceHoursNote
                    className="basis-full"
                    status={
                      currentItem.tripPlace
                        ? placeHours[currentItem.tripPlace.id]?.hours
                        : undefined
                    }
                  />
                  <ItemWhere item={currentItem} />
                </div>
                <p className="mt-1.5 text-xs leading-5 text-text-subtle">
                  {t('locationDisclaimer')}
                </p>
              </div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(4.25rem,1fr))] gap-2">
                {currentReservation ? (
                  <QuickAction
                    href={`/trips/${tripId}/reservations`}
                    icon={<Icons.Reservations aria-hidden="true" className="size-5" />}
                    label={t('bookingFor', { name: currentReservation.title })}
                  >
                    {t('booking')}
                  </QuickAction>
                ) : null}
                <QuickAction
                  disabled={tripModeTasks.status !== 'ready'}
                  icon={<Icons.Tasks aria-hidden="true" className="size-5" />}
                  onClick={openStopTasks}
                >
                  {hereTaskCount ? t('taskCount', { count: hereTaskCount }) : tasksT('add')}
                </QuickAction>
                <QuickAction
                  icon={<Camera aria-hidden="true" className="size-5" />}
                  label={memoryTranslations('quickAction')}
                  onClick={() => setMemoryOpen(true)}
                >
                  {t('capture')}
                </QuickAction>
                {canComplete ? (
                  <QuickAction
                    disabled={busyItemId === currentItem.id}
                    icon={<Check aria-hidden="true" className="size-5" />}
                    label={t('completeItem', { name: currentName })}
                    onClick={() => void setTravelStatus(currentItem, 'completed')}
                    tone="brand"
                  >
                    {t('done')}
                  </QuickAction>
                ) : null}
              </div>
            </div>
          </section>
        )
      ) : null}

      {freeTime ? (
        <section aria-labelledby="trip-mode-free-heading" className="space-y-4">
          <div className="pt-2">
            <p className="text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] text-brand uppercase">
              {t('freeTimeEyebrow')}
            </p>
            <h3
              className="mt-1 font-journal text-[2.5rem] leading-none font-normal tracking-[-0.01em] text-balance text-foreground"
              id="trip-mode-free-heading"
            >
              {route ? t('freeUntil', { time: timeFormat(route.at, nowZone) }) : t('freeTimeTitle')}
            </h3>
            <p className="mt-2 text-sm leading-6 text-pretty text-muted-foreground">
              {route && nextName
                ? t('freeTimeLeave', { name: nextName })
                : t('freeTimeDescription')}
            </p>
          </div>
          {nearbyPlaces.length ? (
            <div className="rounded-[var(--radius-2xl)] border border-border-subtle bg-card px-4 pt-1 pb-2 shadow-[var(--shadow-control)]">
              <div className="flex min-h-11 items-center justify-between gap-3">
                <h4 className="text-[0.9375rem] font-semibold text-foreground">
                  {t('nearbyTitle')}
                </h4>
                {/* Measured from where the plan puts the traveller, and saying
                    so: this is not their device's position. */}
                <p className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    aria-hidden="true"
                    className="size-2.5 rounded-full border-2 border-brand"
                  />
                  {t('nearbyPlanned')}
                </p>
              </div>
              <ul className="divide-y divide-border-subtle border-t border-border-subtle">
                {nearbyPlaces.map(({ distance, tripPlace }) => (
                  <NearbyPlaceRow
                    distanceMeters={distance}
                    key={tripPlace.id}
                    name={resolveTripPlaceName(tripPlace, {
                      custom: t('placeFallback'),
                      provider: t('placeFallback'),
                    })}
                    onOpen={() =>
                      openPlaceDetails(tripPlace, placeVisitDate(placeUse[tripPlace.id]))
                    }
                    tripPlace={tripPlace}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* The next move: one dark dock in the thumb's reach, the countdown its
          loudest line. Below the place it waits; leaving soon, it leads. */}
      {nextItem && nextName ? (
        <section
          aria-labelledby="trip-mode-next-heading"
          className={cn('rounded-[1.75rem] p-5 shadow-[var(--shadow-card)]', dock.surface)}
          data-leaving-soon={leavingSoon || undefined}
        >
          <div className="flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] uppercase',
                  dock.eyebrow,
                )}
              >
                {leavingSoon ? t('timeToGo') : route ? t('nextMove') : t('nextInPlan')}
              </p>
              {route && leaveCountdown ? (
                <>
                  <p
                    className={cn(
                      'mt-1 font-semibold tracking-[-0.03em] tabular-nums',
                      leavingSoon ? 'text-[2.75rem] leading-[1.02]' : 'text-[2rem] leading-[1.08]',
                      dock.countdown,
                    )}
                  >
                    {leaveCountdown}
                  </p>
                  {/* Computed against the traveller's clock, so it is read on it
                      too - otherwise "leave by" and the stop it is about would
                      name the same instant in two different hours. */}
                  <p className={cn('mt-1 text-sm leading-5 tabular-nums', dock.muted)}>
                    {t('leaveByAt', { time: timeFormat(route.at, nowZone) })}
                    <span aria-hidden="true"> · </span>
                    {t('travelEstimate', {
                      duration: formatDuration(route.routeDurationSeconds),
                      mode: t(`travelMode.${route.mode}`),
                    })}
                  </p>
                </>
              ) : (
                <>
                  <h3
                    className="mt-1 text-[1.625rem] leading-[1.15] font-semibold tracking-[-0.02em] text-pretty"
                    id="trip-mode-next-heading"
                  >
                    {nextName}
                  </h3>
                  <p className={cn('mt-1 text-sm leading-5 tabular-nums', dock.muted)}>
                    {formatSchedule(nextItem)}
                  </p>
                </>
              )}
            </div>
            {directions && !leavingSoon ? (
              <Button
                aria-label={t('directionsTo', { name: nextName })}
                className={cn('size-15 shrink-0 rounded-full border-0', dock.button)}
                nativeButton={false}
                render={<a href={directions} rel="noreferrer" target="_blank" />}
                size="icon"
                variant="ghost"
              >
                <Icons.Directions aria-hidden="true" className="size-6" />
              </Button>
            ) : null}
          </div>

          {/* When the countdown leads, the stop it is about sits beneath it. */}
          {route && leaveCountdown ? (
            <>
              <div aria-hidden="true" className={cn('my-4 border-t', dock.rule)} />
              <div className="flex items-center gap-3">
                <PlaceMedia
                  alt=""
                  category={nextItem.tripPlace?.place.snapshot?.category}
                  className="size-11 shrink-0 rounded-[var(--radius-md)]"
                  sizes="2.75rem"
                  source={resolvePlaceMediaSource({ editorial: nextThumb })}
                  variant="thumbnail"
                />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-base font-semibold" id="trip-mode-next-heading">
                    {nextName}
                  </h3>
                  <p className={cn('truncate text-[0.8125rem] leading-5 tabular-nums', dock.muted)}>
                    {formatSchedule(nextItem)}
                    {route.distanceMeters !== null ? (
                      <>
                        <span aria-hidden="true"> · </span>
                        {formatDistance(route.distanceMeters)}
                      </>
                    ) : null}
                    {nextTaskCount ? (
                      <>
                        <span aria-hidden="true"> · </span>
                        {t('taskCount', { count: nextTaskCount })}
                      </>
                    ) : null}
                  </p>
                </div>
                {nextReservation ? (
                  <Button
                    aria-label={t('bookingFor', { name: nextReservation.title })}
                    className={cn('shrink-0 rounded-full', dock.secondary)}
                    nativeButton={false}
                    render={<Link href={`/trips/${tripId}/reservations`} />}
                    variant="ghost"
                  >
                    {t('booking')}
                  </Button>
                ) : null}
              </div>
            </>
          ) : nextReservation ? (
            <Button
              aria-label={t('bookingFor', { name: nextReservation.title })}
              className={cn('mt-4 rounded-full', dock.secondary)}
              nativeButton={false}
              render={<Link href={`/trips/${tripId}/reservations`} />}
              variant="ghost"
            >
              <Icons.Reservations aria-hidden="true" data-icon="inline-start" />
              {t('booking')}
            </Button>
          ) : null}

          <PlaceHoursNote
            className={cn('mt-3', dock.muted)}
            status={nextItem.tripPlace ? placeHours[nextItem.tripPlace.id]?.hours : undefined}
          />

          {/* Leaving soon, Directions becomes the button the whole dock is for. */}
          {directions && leavingSoon ? (
            <Button
              aria-label={t('directionsTo', { name: nextName })}
              className={cn(
                'mt-4 h-14 w-full rounded-full border-0 text-base font-semibold',
                dock.button,
              )}
              nativeButton={false}
              render={<a href={directions} rel="noreferrer" target="_blank" />}
              variant="ghost"
            >
              <Icons.Directions aria-hidden="true" data-icon="inline-start" />
              {t('directions')}
            </Button>
          ) : null}

          {/* A leg that was never going to be estimated, an estimate that has
              not arrived, and an item with no fixed start are three different
              things, and each of them says which one it is. */}
          {route ? (
            route.bufferSeconds || route.measuredAt ? (
              <p className={cn('mt-3 text-xs leading-5', dock.muted)}>
                {route.bufferSeconds
                  ? t('leaveByBuffer', { minutes: Math.round(route.bufferSeconds / 60) })
                  : null}
                {/* Offline, the travel time is one measured earlier; say when. */}
                {route.measuredAt ? (
                  <span className="block">
                    {t('leaveByMeasured', {
                      date: new Intl.DateTimeFormat(locale, {
                        day: 'numeric',
                        month: 'short',
                      }).format(new Date(route.measuredAt)),
                    })}
                  </span>
                ) : null}
              </p>
            ) : null
          ) : nextLegIsFlight ? (
            <p className={cn('mt-3 text-sm leading-6', dock.muted)}>{t('routeFlight')}</p>
          ) : !nextItem.startInstant ? (
            <div className="mt-3 space-y-3">
              <p className={cn('text-sm leading-6', dock.muted)}>{t('timingFlexible')}</p>
              {/* Times are set where the day is edited; the link lands on this
                  stop rather than at the top of the list. */}
              <Button
                className="w-full rounded-full border-0 bg-[color:var(--score-media-foreground)] text-[color:var(--score-media-background)] hover:bg-[color:var(--score-media-foreground)]/90 hover:text-[color:var(--score-media-background)]"
                nativeButton={false}
                render={
                  <Link
                    href={withPreviewHref(
                      `/trips/${tripId}/mode/today#trip-mode-item-${nextItem.id}`,
                    )}
                  />
                }
                variant="ghost"
              >
                {t('setTime')}
              </Button>
            </div>
          ) : readyContext.leg ? null : (
            <p className={cn('mt-3 text-sm leading-6', dock.muted)}>{t('routeUnavailable')}</p>
          )}

          {legBar ? <div className={cn('mt-4 border-t pt-4', dock.rule)}>{legBar}</div> : null}
        </section>
      ) : dayComplete ? (
        <section aria-labelledby="trip-mode-day-complete-heading" className="space-y-5">
          <div className="pt-2">
            <h3
              className="font-journal text-[2.75rem] leading-[0.98] font-normal tracking-[-0.01em] text-balance text-foreground"
              id="trip-mode-day-complete-heading"
            >
              {t('dayCompleteTitle', { number: day?.number ?? 1 })}
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {t('dayCompleteSummary', {
                skipped: dayItems.filter((item) => item.travelStatus === 'skipped').length,
                visited: dayItems.filter((item) => item.travelStatus === 'completed').length,
              })}
            </p>
          </div>
          {day ? (
            <div className="space-y-2">
              <Button className="h-12 w-full rounded-full" onClick={() => setMemoryOpen(true)}>
                <Camera aria-hidden="true" data-icon="inline-start" />
                {t('dayCompleteMemory')}
              </Button>
              <p className="text-center text-[length:var(--text-metadata)] text-muted-foreground">
                {t('dayCompleteMemoryHint')}
              </p>
            </div>
          ) : null}
          {/* Nothing left to reach is not nothing left to do: the way back to
              where the day started is still a leg the traveller is on. */}
          {legBar || tomorrow ? (
            <div
              className={cn(
                'space-y-4 rounded-[1.75rem] p-5 shadow-[var(--shadow-card)]',
                dock.surface,
              )}
            >
              {tomorrow ? (
                <div>
                  <p
                    className={cn(
                      'text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] uppercase',
                      dock.eyebrow,
                    )}
                  >
                    {t('tomorrowLabel', { number: tomorrowIndex + 1 })}
                  </p>
                  <p className="mt-1 font-journal text-[1.75rem] leading-[1.1] font-normal">
                    {tomorrow.name?.trim() ||
                      (itinerary ? dayTown(tomorrow, itinerary.tripPlaces) : null) ||
                      shortDate(tomorrow.date)}
                  </p>
                  <p className={cn('mt-1 text-sm leading-6', dock.muted)}>
                    {tomorrowFirst
                      ? tomorrowFirst.localStartTime || tomorrowFirst.dayPart
                        ? t('tomorrowFirst', {
                            name: itemName(tomorrowFirst, t('placeFallback')),
                            schedule: formatSchedule(tomorrowFirst) ?? '',
                          })
                        : t('tomorrowFirstUntimed', {
                            name: itemName(tomorrowFirst, t('placeFallback')),
                          })
                      : t('tomorrowEmpty')}
                  </p>
                </div>
              ) : null}
              {legBar}
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
          {legBar ? (
            <div className={cn('rounded-[1.75rem] p-5 shadow-[var(--shadow-card)]', dock.surface)}>
              {legBar}
            </div>
          ) : null}
        </div>
      )}

      <div aria-live="polite" className="space-y-2">
        {feedback ? (
          <Alert>
            <Icons.Success aria-hidden="true" />
            <AlertDescription>{feedback.message}</AlertDescription>
            {feedback.undo ? (
              <AlertAction>
                <Button
                  disabled={busyItemId === feedback.undo.itemId}
                  onClick={() => void undoTravelStatus()}
                  size="xs"
                  variant="ghost"
                >
                  <RotateCcw aria-hidden="true" data-icon="inline-start" />
                  {t('undo')}
                </Button>
              </AlertAction>
            ) : null}
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <Icons.Error aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      <TripWeatherContext
        isPreview={isPreview}
        selectedDate={readyContext.selectedDate}
        tripId={tripId}
        variant="card"
      />

      <TripModeTasksNotice />

      {taskGroups.length ? (
        <section
          aria-labelledby="trip-mode-nearby-tasks-heading"
          className="scroll-mt-24 rounded-[var(--radius-2xl)] border border-border-subtle bg-card px-4 py-3 shadow-[var(--shadow-control)]"
          id="trip-mode-nearby-tasks"
        >
          <h3 className="sr-only" id="trip-mode-nearby-tasks-heading">
            {tasksT('nearbyTitle')}
          </h3>
          <div className="divide-y divide-border-subtle">
            {taskGroups.map((group) => {
              const item = group.itemId === currentItem?.id ? currentItem : nextItem;
              return (
                <div className="py-2.5 first:pt-1 last:pb-1" key={`${group.kind}-${group.itemId}`}>
                  <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                    {tasksT(group.kind)}
                    {item ? (
                      <>
                        <span aria-hidden="true"> · </span>
                        {itemName(item, t('placeFallback'))}
                      </>
                    ) : null}
                  </p>
                  <TripModeTaskList className="mt-1.5" tasks={group.tasks} />
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {dayReservation ? (
        <section aria-labelledby="trip-mode-context-heading">
          <h3 className="sr-only" id="trip-mode-context-heading">
            {t('supportingContext')}
          </h3>
          <Link
            className="flex min-h-16 items-center gap-3 rounded-[var(--radius-xl)] border border-border-subtle bg-card px-4 py-2.5 shadow-[var(--shadow-control)] outline-none transition-colors hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40"
            href={`/trips/${tripId}/reservations`}
          >
            <Icons.Reservations aria-hidden="true" className="size-5 shrink-0 text-brand" />
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-muted-foreground">{t('supportingContext')}</span>
              <span className="block truncate text-sm font-medium text-foreground">
                {dayReservation.title}
              </span>
              {dayReservation.bookingReference || dayReservation.localTime ? (
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {dayReservation.bookingReference
                    ? t('bookingReference', { reference: dayReservation.bookingReference })
                    : dayReservation.localTime}
                </span>
              ) : null}
            </span>
            <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-text-subtle" />
          </Link>
        </section>
      ) : null}

      {/* What the day offers doing, after the day has been described. A stop on
          screen already carries its own task and capture buttons. */}
      <div className="flex flex-wrap gap-2 pt-2">
        <Button
          disabled={tripModeTasks.status !== 'ready'}
          onClick={() =>
            tripModeTasks.openCreate(
              defaultTripModeTaskContext({
                currentItemId: currentItem?.id,
                dayId: day?.id,
                nextItemId: nextItem?.id,
              }),
            )
          }
          variant="outline"
        >
          <Icons.Tasks aria-hidden="true" data-icon="inline-start" />
          {tasksT('add')}
        </Button>
        {hasNext ? (
          <Button
            nativeButton={false}
            render={<Link href={withPreviewHref(`/trips/${tripId}/mode/today`)} />}
            variant="outline"
          >
            <Icons.Itinerary aria-hidden="true" data-icon="inline-start" />
            {t('openToday')}
          </Button>
        ) : null}
        {day && !currentItem && !dayComplete ? (
          <Button onClick={() => setMemoryOpen(true)} variant="outline">
            <Icons.Memories aria-hidden="true" data-icon="inline-start" />
            {memoryTranslations('quickAction')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A Trip Place within a walk. The distance is straight-line and says so - an
 * estimate, not a route Trove paid to measure.
 */
function NearbyPlaceRow({
  distanceMeters,
  name,
  onOpen,
  tripPlace,
}: Readonly<{
  distanceMeters: number;
  name: string;
  onOpen: () => void;
  tripPlace: ItineraryTripPlace;
}>) {
  const itineraryT = useTranslations('itinerary');
  const legT = useTranslations('tripProgress.leg');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const estimate = formatEstimatedDistance(distanceMeters, preferences.distanceUnit, locale);
  const distance = legT('distanceEstimate', {
    unit: legT(`unit.${estimate.unit}`),
    value: estimate.value,
  });
  return (
    <li>
      <button
        aria-label={itineraryT('viewDetailsFor', { name })}
        className="flex min-h-16 w-full items-center gap-3 py-2 text-left outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
        onClick={onOpen}
        type="button"
      >
        <PlaceMedia
          alt=""
          category={tripPlace.place.snapshot?.category}
          className="size-12 shrink-0 rounded-[var(--radius-md)]"
          sizes="3rem"
          source={resolvePlaceMediaSource({})}
          variant="thumbnail"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem] font-semibold text-foreground">
            {name}
          </span>
          <span className="block text-[0.8125rem] text-muted-foreground tabular-nums">
            {distance}
          </span>
        </span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-text-subtle" />
      </button>
    </li>
  );
}
