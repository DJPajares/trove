'use client';

import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  ChevronDown,
  Ellipsis,
  MapPin,
  Plus,
  RotateCcw,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { PageState } from '@/components/page-state';
import { PlaceHoursNote } from '@/components/place-hours-note';
import { StopEditorSheet } from '@/components/planner/stop-editor/stop-editor-sheet';
import { usePreferences } from '@/components/preferences-provider';
import { useTripModeData } from '@/components/trip-mode-data';
import { useTripPlaceHours } from '@/lib/trip-places/use-trip-place-hours';
import { useTripModePlaceDetails, useTripModePreview } from '@/components/trip-mode-shell';
import { useOnlineStatus } from '@/components/trip-sync-status';
import { TripModeMemorySheet } from '@/components/trip-mode-memory-sheet';
import { TripModePendingMemories } from '@/components/trip-mode-pending-memories';
import { TripInsights } from '@/components/trip-insights';
import { TripWeatherContext } from '@/components/trip-weather-context';
import {
  TripModeTaskDisclosure,
  TripModeTaskList,
  TripModeTasksNotice,
  useTripModeTasks,
} from '@/components/trip-mode-tasks';
import { TripModeActionButton, tripModeCardClass } from '@/components/trip-mode-ui';
import {
  TripModeScheduleFields,
  type TripModeSchedule,
} from '@/components/trip-mode-schedule-fields';
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import {
  deviceTimeZone,
  fetchItineraryDayRoutes,
  organizeItineraryItem,
  type ItineraryItem,
  type ItineraryRouteSegment,
  type ItineraryScheduleInput,
  type ItineraryTravelStatus,
  updateItineraryItem,
  updateItineraryItemTravelStatus,
} from '@/lib/itinerary/api';
import { buildDaySequence, resolveDailyBases } from '@/lib/itinerary/day-sequence';
import { formatDistanceValue } from '@/lib/itinerary/format-distance';
import { formatItineraryTimeRange, itineraryLocalEndTime } from '@/lib/itinerary/item-timing';
import { formatTravelDuration } from '@/lib/itinerary/route-format';
import { itineraryDayRouteRevision } from '@/lib/itinerary/routes';
import { queryKeys } from '@/lib/query/keys';
import { scheduledPlaceUse } from '@/lib/itinerary/places';
import type { Reservation } from '@/lib/reservations/api';
import { tasksForItem, todayTaskRollup } from '@/lib/tasks/trip-mode';
import { cn } from '@/lib/utils';
import { useDayHeaderPhotos } from '@/hooks/use-day-header-photos';
import { DayHeaderMedia } from '@/components/day-header-media';
import { dayTown } from '@/lib/itinerary/day-place';
import { resolveItineraryItemPlaceName, resolveTripPlaceName } from '@/lib/trip-places/place-name';
import * as Icons from '@/lib/icons';

type UndoAction =
  | { itemId: string; kind: 'organize'; itineraryDayId: string; position: number }
  | {
      durationMinutes: number | null;
      itemId: string;
      kind: 'schedule';
      localEndTime: string | null;
      schedule: ItineraryScheduleInput;
    }
  | { itemId: string; kind: 'status'; travelStatus: ItineraryTravelStatus };

function providerId(item: ItineraryItem) {
  return item.tripPlace?.place.providerRefs.find((ref) => ref.provider === 'google')
    ?.externalPlaceId;
}

function scheduleInput(schedule: TripModeSchedule, exactTime: string): ItineraryScheduleInput {
  if (schedule === 'exact') return { kind: 'exact', localTime: exactTime };
  if (schedule === 'none') return { kind: 'none' };
  return { dayPart: schedule, kind: 'day_part' };
}

function scheduleInputFromItem(item: ItineraryItem): ItineraryScheduleInput {
  if (item.localStartTime) return { kind: 'exact', localTime: item.localStartTime };
  if (item.dayPart) return { dayPart: item.dayPart, kind: 'day_part' };
  return { kind: 'none' };
}

function TodaySkeleton({ label }: Readonly<{ label: string }>) {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-6" role="status">
      <span className="sr-only">{label}</span>
      <div className="space-y-3">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-5 w-64" />
      </div>
      <div className="space-y-0 border-y border-border-subtle">
        <Skeleton className="h-20 rounded-none" />
        <Skeleton className="mt-px h-20 rounded-none" />
        <Skeleton className="mt-px h-20 rounded-none" />
      </div>
    </div>
  );
}

export function TripModeTodayView({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('tripMode.views.today');
  const nowT = useTranslations('tripMode.views.now');
  const itineraryT = useTranslations('itinerary');
  const routesT = useTranslations('itinerary.routes');
  const tripPlacesT = useTranslations('tripPlaces');
  const memoryTranslations = useTranslations('memories.capture');
  const tasksT = useTranslations('tripMode.tasks');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const online = useOnlineStatus();
  const { isPreview, previewSelection, updatePreview } = useTripModePreview();
  const {
    context,
    itinerary,
    refresh,
    reservations: loadedReservations,
    setItinerary,
    status,
  } = useTripModeData();
  const { openPlaceDetails } = useTripModePlaceDetails();
  const tripModeTasks = useTripModeTasks();
  const [mutatingItemId, setMutatingItemId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * The day being read, when it is not the day being lived.
   *
   * Trip Mode was anchored to the server's answer for "today" with no way to
   * look at tomorrow, so checking what the morning holds meant leaving the mode
   * entirely. This is a reading position only: `currentItemId` is still cleared
   * whenever the viewed day is not the context's own, so nothing on another day
   * is ever accented as happening now.
   *
   * Null means "follow the traveller" - the default, and what a new day
   * silently returns to.
   */
  const [viewedDate, setViewedDate] = useState<string | null>(null);
  const activeDayChipRef = useRef<HTMLButtonElement | null>(null);
  const [createItemOpen, setCreateItemOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [pendingMemoriesKey, setPendingMemoriesKey] = useState(0);
  const [scheduleItem, setScheduleItem] = useState<ItineraryItem | null>(null);
  const [schedule, setSchedule] = useState<TripModeSchedule>('none');
  const [exactTime, setExactTime] = useState('');
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  /**
   * Whether the stops already behind the traveller are drawn. On a day under
   * way they fold into one line, so the list opens on what is left to do; a
   * hash pointing at one of them unfolds it.
   */
  const [showSettled, setShowSettled] = useState(false);
  const pendingHashRef = useRef<string | null>(null);
  const reservations = loadedReservations ?? [];

  useEffect(() => {
    setUndoAction(null);
  }, [previewSelection?.date, previewSelection?.time]);

  useEffect(() => {
    setShowSettled(false);
    setExpandedItemId(undefined);
    setOpenTasksItemId(null);
  }, [previewSelection?.date, viewedDate]);

  // The day the traveller asked for, not the one the server has echoed back yet.
  // Preview steps through days the itinerary already holds in full, so the list
  // turns over on the click and the context request catches up behind it. Live
  // has no stepper: there, which day it is remains the server's answer.
  const selectedDate = previewSelection?.date ?? viewedDate ?? context?.selectedDate ?? null;
  const day = useMemo(() => {
    if (!selectedDate || !itinerary) return null;
    return itinerary.days.find((candidate) => candidate.date === selectedDate) ?? null;
  }, [itinerary, selectedDate]);
  const placeUse = useMemo(() => (itinerary ? scheduledPlaceUse(itinerary) : {}), [itinerary]);
  // Stored hours for the day being shown; nothing is bought to fill a gap.
  const placeHours = useTripPlaceHours(tripId, day?.date ?? null, Boolean(day));
  const reservationsByItem = useMemo(() => {
    const grouped = new Map<string, Reservation[]>();
    for (const reservation of reservations) {
      if (!reservation.itineraryItem) continue;
      const current = grouped.get(reservation.itineraryItem.id) ?? [];
      current.push(reservation);
      grouped.set(reservation.itineraryItem.id, current);
    }
    return grouped;
  }, [reservations]);

  const dayPhotos = useDayHeaderPhotos(day, itinerary?.tripPlaces ?? []);
  // The legs between the stops, through the Map view's own request: the same
  // key and the same function, so the two views share one answer and one cache
  // entry rather than each buying the day's routes. Keyed on the day's ordering,
  // so a reorder invalidates the legs on show; the server reuses its stored
  // route evidence, so a planned day is mostly answered without a provider call.
  const routeRevision = itineraryDayRouteRevision(day);
  const routesQuery = useQuery({
    enabled: Boolean(day && online),
    queryFn: ({ signal }) =>
      fetchItineraryDayRoutes(tripId, day?.id as string, {
        includePolyline: true,
        languageCode: locale,
        revision: routeRevision,
        signal,
      }),
    queryKey: queryKeys.itineraryDayRoutes(tripId, day?.id ?? '', routeRevision, true, locale),
  });

  // "Current" is the one thing here only the server can answer, and its answer
  // is about the day it was asked for. While it is still about the last one,
  // nothing on this day is current - which is truer than accenting a row
  // because a request has not come back yet.
  //
  // Resolved above the guards below because the scroll effect reads it, and a
  // hook may not sit after an early return.
  const currentItemId =
    context?.selectedDate === day?.date ? (context?.currentOrRelevant?.itemId ?? null) : null;
  /**
   * Which stop shows its actions. Undefined follows the traveller: the stop in
   * progress opens by itself, and any other opens on a tap - one at a time, so
   * the day stays a list rather than a stack of cards.
   */
  const [expandedItemId, setExpandedItemId] = useState<string | null | undefined>(undefined);
  const expandedId = expandedItemId === undefined ? currentItemId : expandedItemId;
  // A collapsed stop's own task list, opened from its task count.
  const [openTasksItemId, setOpenTasksItemId] = useState<string | null>(null);
  // The stop a memory is about when it is captured from a stop's own actions.
  const [memoryItemId, setMemoryItemId] = useState<string | null>(null);

  // Day 9 of a 17-day trip is off the end of the strip on a phone, so the strip
  // is scrolled to wherever the traveller actually is rather than parked at day
  // one. `nearest` vertically, so bringing a chip into view never also moves the
  // page.
  useEffect(() => {
    activeDayChipRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [selectedDate]);

  /**
   * Land on the stop the traveller asked about, or failing that on the one they
   * are living.
   *
   * A hash wins because it is an explicit request - the Map hands off that way.
   * Otherwise a day that is under way opens at its current row rather than at
   * breakfast, which on a long day is several screens of scrolling to reach the
   * only row that matters.
   *
   * Focus moves only for the hash: an unasked-for scroll should not also take
   * the keyboard somewhere the traveller did not point it.
   */
  useEffect(() => {
    if (!day) return;
    const hash = window.location.hash.startsWith('#trip-mode-item-')
      ? window.location.hash.slice(1)
      : null;
    const target = hash ?? (currentItemId ? `trip-mode-item-${currentItemId}` : null);
    if (!target) return;

    window.requestAnimationFrame(() => {
      const element = document.getElementById(target);
      // Asked for a stop that is folded away: unfold, then land on it.
      if (!element && hash) {
        pendingHashRef.current = hash;
        setShowSettled(true);
        return;
      }
      element?.scrollIntoView({ block: 'center' });
      if (hash) element?.focus({ preventScroll: true });
    });
  }, [currentItemId, day]);

  useEffect(() => {
    const pending = pendingHashRef.current;
    if (!showSettled || !pending) return;
    pendingHashRef.current = null;
    window.requestAnimationFrame(() => {
      const element = document.getElementById(pending);
      element?.scrollIntoView({ block: 'center' });
      element?.focus({ preventScroll: true });
    });
  }, [showSettled]);

  if (status === 'loading') return <TodaySkeleton label={t('loading')} />;

  if (status === 'error' || !context || !itinerary) {
    return (
      <PageState
        actions={<Button onClick={() => void refresh()}>{t('tryAgain')}</Button>}
        description={t('loadErrorDescription')}
        headingLevel={2}
        icon={<Icons.Error aria-hidden="true" />}
        kind="error"
        title={t('loadError')}
      />
    );
  }

  const shownDate = selectedDate ?? context.selectedDate;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }).format(
    new Date(`${shownDate}T00:00:00.000Z`),
  );
  // Which day this is, counted from the itinerary rather than waited for: the
  // server says the same thing a moment later, and a heading that renumbers
  // itself is the lag this screen is trying to stop showing.
  const dayNumber = itinerary.days.findIndex((candidate) => candidate.id === day?.id) + 1 || 1;
  // Short enough for a chip: "13 Sep" rather than the full sentence the
  // header below already carries.
  const dayChipDate = (value: string) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
      new Date(`${value}T00:00:00.000Z`),
    );
  const dayChipWeekday = (value: string) =>
    new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short' }).format(
      new Date(`${value}T00:00:00.000Z`),
    );
  const dayChipNumber = (value: string) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${value}T00:00:00.000Z`),
    );

  // The snapshot travels with the itinerary, including the copy held offline, so
  // these no longer depend on being online to name a Place or show its address.
  const snapshotFor = (item: ItineraryItem) => item.tripPlace?.place.snapshot ?? null;
  /**
   * What a stop is called, through the one chain the rest of the app uses.
   *
   * This used to have its own copy, and that copy skipped `tripPlace.customName`
   * - the name a traveller gives a stop through "Name it". `place.name` is the
   * *Place's* own name and is null for every Google-backed one, so their name
   * was dropped and Google's shown instead.
   */
  const itemName = (item: ItineraryItem) => resolveItineraryItemPlaceName(item, t('itemFallback'));
  const itemLocation = (item: ItineraryItem) =>
    item.customLocation?.label ??
    snapshotFor(item)?.address ??
    item.tripPlace?.place.providerAddress ??
    null;
  /**
   * The place a labelled stop refers to.
   *
   * A stop the traveller named - "Breakfast before the drive" - says nothing
   * about which door to walk through, and the place behind it went unmentioned
   * anywhere on the row: the title was the label and the line beneath it was the
   * street address alone. So when the title is the item's own label, the place
   * leads that line and the address follows it.
   *
   * A stop with no label of its own is already titled by its place, and so is
   * one whose label repeats it - which is most of an AI-planned day, where the
   * label is written as the place's own name. Neither says it twice.
   */
  const itemPlace = (item: ItineraryItem) => {
    const label = item.customLabel?.trim();
    if (!label || !item.tripPlace) return null;

    const name = resolveTripPlaceName(item.tripPlace, { custom: '', provider: '' }).trim();
    if (!name || name.localeCompare(label, locale, { sensitivity: 'accent' }) === 0) return null;
    return name;
  };
  const itemSchedule = (item: ItineraryItem) =>
    item.localStartTime
      ? formatItineraryTimeRange(item, locale, preferences.timeFormat)
      : item.dayPart
        ? t(`schedule.${item.dayPart}`)
        : t('schedule.none');
  const directionsHref = (item: ItineraryItem) => {
    if (!online) return null;
    const externalPlaceId = providerId(item);
    const location = item.tripPlace?.place.location;
    if (!externalPlaceId && !location) return null;
    const destination = location ? `${location.latitude},${location.longitude}` : itemName(item);
    const query = new URLSearchParams({ api: '1', destination });
    if (externalPlaceId) query.set('destination_place_id', externalPlaceId);
    return `https://www.google.com/maps/dir/?${query.toString()}`;
  };
  const expenseHref = (itineraryItemId?: string) => {
    const query = new URLSearchParams({ create: '1', date: shownDate });
    if (itineraryItemId) query.set('itineraryItemId', itineraryItemId);
    return `/trips/${tripId}/expenses?${query.toString()}`;
  };

  const setLocalStatus = (itemId: string, travelStatus: ItineraryTravelStatus) => {
    setItinerary((current) => {
      if (!current) return current;
      return {
        ...current,
        days: current.days.map((candidate) => ({
          ...candidate,
          items: candidate.items.map((item) =>
            item.id === itemId ? { ...item, travelStatus } : item,
          ),
        })),
      };
    });
  };

  async function changeStatus(item: ItineraryItem, travelStatus: ItineraryTravelStatus) {
    const previous = item.travelStatus;
    setMutatingItemId(item.id);
    setError(null);
    setFeedback(null);
    setUndoAction(null);
    setLocalStatus(item.id, travelStatus);
    try {
      await updateItineraryItemTravelStatus(tripId, item.id, travelStatus);
      await refresh();
      if (isPreview) {
        setUndoAction({ itemId: item.id, kind: 'status', travelStatus: previous });
      }
      setFeedback(t(`feedback.${travelStatus}`));
    } catch {
      setLocalStatus(item.id, previous);
      setError(t('actionError'));
    } finally {
      setMutatingItemId(null);
    }
  }

  const upcomingItems = day?.items.filter((item) => item.travelStatus === 'upcoming') ?? [];

  async function reorder(item: ItineraryItem, direction: 'earlier' | 'later') {
    if (!day) return;
    const upcomingIndex = upcomingItems.findIndex((candidate) => candidate.id === item.id);
    const target = upcomingItems[upcomingIndex + (direction === 'earlier' ? -1 : 1)];
    if (!target) return;
    const previousPosition = day.items.findIndex((candidate) => candidate.id === item.id);
    const targetPosition = day.items.findIndex((candidate) => candidate.id === target.id);
    setMutatingItemId(item.id);
    setError(null);
    setFeedback(null);
    setUndoAction(null);
    try {
      await organizeItineraryItem(tripId, item.id, {
        itineraryDayId: day.id,
        position: targetPosition,
      });
      await refresh();
      if (isPreview) {
        setUndoAction({
          itemId: item.id,
          itineraryDayId: day.id,
          kind: 'organize',
          position: previousPosition,
        });
      }
      setFeedback(t('feedback.reordered'));
    } catch {
      setError(t('actionError'));
    } finally {
      setMutatingItemId(null);
    }
  }

  async function moveToDay(item: ItineraryItem, itineraryDayId: string) {
    if (!day) return;
    const previousPosition = day.items.findIndex((candidate) => candidate.id === item.id);
    setMutatingItemId(item.id);
    setError(null);
    setFeedback(null);
    setUndoAction(null);
    try {
      await organizeItineraryItem(tripId, item.id, { itineraryDayId, position: 999 });
      await refresh();
      if (isPreview) {
        setUndoAction({
          itemId: item.id,
          itineraryDayId: day.id,
          kind: 'organize',
          position: previousPosition,
        });
      }
      setFeedback(t('feedback.moved'));
    } catch {
      setError(t('actionError'));
    } finally {
      setMutatingItemId(null);
    }
  }

  function openSchedule(item: ItineraryItem) {
    setScheduleItem(item);
    setSchedule(item.localStartTime ? 'exact' : (item.dayPart ?? 'none'));
    setExactTime(item.localStartTime ?? '');
    setScheduleError(null);
  }

  async function saveSchedule() {
    if (!scheduleItem) return;
    if (schedule === 'exact' && !exactTime) {
      setScheduleError(t('scheduleEditor.exactTimeError'));
      return;
    }
    setMutatingItemId(scheduleItem.id);
    setScheduleError(null);
    setUndoAction(null);
    try {
      const previousSchedule = scheduleInputFromItem(scheduleItem);
      const nextSchedule = scheduleInput(schedule, exactTime);
      await updateItineraryItem(tripId, scheduleItem.id, {
        ...(nextSchedule.kind === 'exact' || !scheduleItem.localEndTime
          ? {}
          : { localEndTime: null }),
        schedule: nextSchedule,
      });
      await refresh();
      if (isPreview) {
        setUndoAction({
          itemId: scheduleItem.id,
          kind: 'schedule',
          durationMinutes: scheduleItem.durationMinutes,
          localEndTime: scheduleItem.localEndTime ?? null,
          schedule: previousSchedule,
        });
      }
      setScheduleItem(null);
      setFeedback(t('feedback.schedule'));
    } catch {
      setScheduleError(t('scheduleEditor.saveError'));
    } finally {
      setMutatingItemId(null);
    }
  }

  async function undoLastAction() {
    const action = undoAction;
    if (!action) return;
    setMutatingItemId(action.itemId);
    setError(null);
    try {
      if (action.kind === 'status') {
        await updateItineraryItemTravelStatus(tripId, action.itemId, action.travelStatus);
      } else if (action.kind === 'organize') {
        await organizeItineraryItem(tripId, action.itemId, {
          itineraryDayId: action.itineraryDayId,
          position: action.position,
        });
      } else {
        await updateItineraryItem(tripId, action.itemId, {
          durationMinutes: action.localEndTime ? null : action.durationMinutes,
          localEndTime: action.localEndTime,
          schedule: action.schedule,
        });
      }
      await refresh();
      setUndoAction(null);
      setFeedback(t('feedback.undone'));
    } catch {
      setError(t('actionError'));
    } finally {
      setMutatingItemId(null);
    }
  }

  if (!day) {
    return (
      <PageState
        description={t('noDayDescription', { date })}
        headingLevel={2}
        icon={<CalendarDays aria-hidden="true" />}
        title={t('noDayTitle')}
      />
    );
  }

  // The same running order, numbering and base rows the planning day uses, so
  // a stop is the same stop whichever screen the traveller is standing on - now
  // with the legs between them, from the routes read above.
  const routeData = routesQuery.data ?? null;
  const staleRoutes = routeData?.source === 'cache';
  const allEntries = buildDaySequence({
    bases: resolveDailyBases({ day }),
    items: day.items,
    routeSegments: routeData?.segments,
  });
  // Only on the day being lived and only once it is under way: on any other day
  // nothing is behind anyone, and a finished day is read as a whole.
  const firstOpenIndex = currentItemId
    ? allEntries.findIndex(
        (entry) => entry.kind === 'stop' && entry.item.travelStatus === 'upcoming',
      )
    : -1;
  const settledStops =
    firstOpenIndex > 0
      ? allEntries
          .slice(0, firstOpenIndex)
          .flatMap((entry) => (entry.kind === 'stop' ? [entry.item] : []))
      : [];
  // Folded, the list resumes at the leg that reaches the first stop still ahead.
  const foldEnd =
    firstOpenIndex > 0 && allEntries[firstOpenIndex - 1]?.kind === 'leg'
      ? firstOpenIndex - 1
      : firstOpenIndex;
  const entries = settledStops.length && !showSettled ? allEntries.slice(foldEnd) : allEntries;
  // The leg the traveller is about to walk, as the context measured it, so the
  // leave-by time here and on Now is the same one.
  const legOut = context.selectedDate === day.date && context.leaveBy ? context.leaveBy : null;
  const legZone = isPreview ? day.defaultTimeZone : (deviceTimeZone() ?? day.defaultTimeZone);
  const legTime = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      hour12: preferences.timeFormat === '12h',
      minute: '2-digit',
      timeZone: legZone,
    }).format(new Date(value));
  const wallClock = (value: string) => {
    const [hour = 0, minute = 0] = value.split(':').map(Number);
    return new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      hour12: preferences.timeFormat === '12h',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
  };
  const travelTotal =
    routeData &&
    routeData.summary.localSegmentCount > 0 &&
    routeData.summary.durationSeconds !== null
      ? t('travelTotal', {
          duration: formatTravelDuration(routeData.summary.durationSeconds, locale),
        })
      : null;
  const legText = (segment: ItineraryRouteSegment) => {
    const available =
      segment.status === 'ok' &&
      segment.durationSeconds !== null &&
      segment.distanceMeters !== null;
    const metrics = available
      ? routesT(staleRoutes ? 'segmentCachedMetrics' : 'segmentEstimateMetrics', {
          distance: formatDistanceValue(segment.distanceMeters!, preferences.distanceUnit, locale),
          duration: formatTravelDuration(segment.durationSeconds!, locale),
          unit: routesT(`units.${preferences.distanceUnit}`),
        })
      : segment.status === 'not_estimated'
        ? routesT('segmentNotEstimatedMetrics')
        : routesT('segmentUnavailableMetrics');
    return [
      routesT(`mode.${segment.mode}`),
      metrics,
      ...(segment.scope === 'long_distance' ? [routesT('segmentLongDistance')] : []),
      ...(segment.destination.kind === 'daily_base'
        ? [
            routesT('segmentDestination', {
              destination: segment.destination.label ?? routesT('point.daily_base'),
            }),
          ]
        : []),
      ...(legOut &&
      segment.destination.kind === 'itinerary_item' &&
      segment.destination.id === legOut.destinationItemId
        ? [nowT('leaveByAt', { time: legTime(legOut.at) })]
        : []),
    ].join(' · ');
  };
  // Use the day's own name, safe town, or date with the shared photo ladder.
  const dayLocalityName = dayTown(day, itinerary.tripPlaces);
  const heroTitle = day.name?.trim() || dayLocalityName || date;

  const dailyTasks = todayTaskRollup({
    date: day.date,
    dayId: day.id,
    itemIds: day.items.map((item) => item.id),
    tasks: tripModeTasks.data?.tasks ?? [],
  });
  const resolveBase = (tripPlaceId: string) => {
    const tripPlace = itinerary.tripPlaces.find((candidate) => candidate.id === tripPlaceId);
    if (!tripPlace) return null;

    return {
      // The same chain the stops use, so an accommodation the traveller renamed
      // is not called by Google's name at the head and foot of every day.
      name: resolveTripPlaceName(tripPlace, {
        custom: t('itemFallback'),
        provider: t('itemFallback'),
      }),
      tripPlace,
    };
  };
  const openMemoryFor = (itemId: string | null) => {
    setMemoryItemId(itemId);
    setMemoryOpen(true);
  };
  const moveToDayLabel = (candidate: (typeof itinerary.days)[number]) => {
    const shortDate = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${candidate.date}T00:00:00.000Z`));
    const number = itinerary.days.indexOf(candidate) + 1;
    return candidate.name
      ? itineraryT('dayOptionNamed', { date: shortDate, name: candidate.name, number })
      : t('dayOption', { date: shortDate, number });
  };

  /** The marker on the rail: what the stop's state is, readable without colour. */
  const railNode = (kind: 'base' | 'completed' | 'current' | 'skipped' | 'upcoming'): ReactNode => (
    <span
      aria-hidden="true"
      className={cn(
        'relative z-[1] grid shrink-0 place-items-center bg-background',
        kind === 'base' && 'size-3.5 rounded-[0.3rem] border-2 border-border-strong',
        kind === 'completed' && 'size-[1.125rem] rounded-full bg-brand text-primary-foreground',
        kind === 'current' && 'size-[1.125rem] rounded-full border-[5px] border-accent-strong',
        kind === 'skipped' && 'size-3.5 rounded-full border-2 border-dotted border-border-strong',
        kind === 'upcoming' && 'size-3.5 rounded-full border-2 border-border-strong',
      )}
    >
      {kind === 'completed' ? <Check className="size-3" strokeWidth={3.5} /> : null}
    </span>
  );
  const rowGrid = 'relative grid grid-cols-[3.75rem_1.25rem_minmax(0,1fr)] gap-x-3';

  return (
    <div className="space-y-6">
      {/* Every day of the trip, reachable without leaving Trip Mode. Today was
          pinned to the server's answer for "now", so a traveller wondering what
          the morning held had to go back to Planning to find out. The strip is
          a reading position, not a claim about where anyone is. */}
      <nav aria-label={t('dayStripLabel')} className="-mx-[var(--gutter-inline-start)]">
        <ul className="interaction-scrollbar flex snap-x snap-mandatory gap-2 overflow-x-auto px-[var(--gutter-inline-start)] pb-1">
          {itinerary.days.map((candidate, index) => {
            const active = candidate.date === day.date;
            const isContextDay = candidate.date === context.selectedDate;

            return (
              <li className="snap-start" key={candidate.id}>
                <button
                  aria-current={active ? 'true' : undefined}
                  // The chip shows the calendar; its name keeps the trip's own
                  // count, which is how the rest of Trove refers to a day.
                  aria-label={t('dayOption', {
                    date: dayChipDate(candidate.date),
                    number: index + 1,
                  })}
                  ref={active ? activeDayChipRef : undefined}
                  className={cn(
                    'flex min-h-15 w-13 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-lg)] px-1 whitespace-nowrap outline-none transition-colors duration-[var(--motion-standard)] ease-[var(--ease-standard)] focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none',
                    // The day being read is filled, the day being lived is
                    // outlined in the brand, and every other day stays quiet.
                    active
                      ? 'bg-foreground text-background'
                      : isContextDay
                        ? 'border border-brand text-foreground hover:bg-surface-hover'
                        : 'border border-border-subtle text-foreground hover:bg-surface-hover',
                  )}
                  onClick={() =>
                    isPreview
                      ? updatePreview({ date: candidate.date })
                      : setViewedDate(candidate.date)
                  }
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'text-[0.6875rem] leading-4',
                      active ? 'text-background/80' : 'text-muted-foreground',
                    )}
                  >
                    {isContextDay && !isPreview ? t('todayChip') : dayChipWeekday(candidate.date)}
                  </span>
                  <span aria-hidden="true" className="text-lg leading-5 font-semibold tabular-nums">
                    {dayChipNumber(candidate.date)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Every day has a photographic header, including an empty or unnamed day.
          The name sits on its own opaque plate rather than on a scrim: the
          photograph never decides whether the words can be read. */}
      <section
        aria-labelledby="trip-mode-day-hero-heading"
        className="relative isolate overflow-hidden rounded-[var(--radius-2xl)] shadow-[var(--shadow-card)]"
      >
        <DayHeaderMedia
          alt=""
          dataSlot="trip-mode-day-photo"
          resolution={dayPhotos}
          className="h-44 w-full rounded-none sm:h-52 lg:h-64"
          sizes="(max-width: 72rem) 100vw, 72rem"
          variant="banner"
        />
        <div className="absolute inset-x-3 bottom-3 rounded-[var(--radius-xl)] bg-[color:var(--score-media-background)] px-4 py-3 text-[color:var(--score-media-foreground)]">
          <h2
            className="font-journal text-[1.875rem] leading-[1.05] font-normal tracking-[-0.01em] text-balance [overflow-wrap:anywhere]"
            id="trip-mode-day-hero-heading"
          >
            {heroTitle}
          </h2>
          {/* The date, said once: here when the heading is a name, not at all
              when the heading already is the date. */}
          <p className="mt-0.5 text-[length:var(--text-metadata)] leading-5 text-[color:var(--score-media-muted)] tabular-nums">
            {heroTitle === date
              ? itineraryT('dayNumber', { number: dayNumber })
              : t('heroDate', { date, number: dayNumber })}
          </p>
        </div>
      </section>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-sm leading-5 text-muted-foreground">
          {t('heroStops', { count: day.items.length })}
          {travelTotal ? (
            <>
              <span aria-hidden="true"> · </span>
              {travelTotal}
            </>
          ) : null}
        </p>
        {/* A task for the day is worth a control of its own here; the rest of
            what a day collects lives under the stop it belongs to. */}
        <TripModeActionButton
          className="h-10"
          disabled={tripModeTasks.status !== 'ready'}
          onClick={() => tripModeTasks.openCreate({ itineraryDayId: day.id, kind: 'day' })}
        >
          <Plus aria-hidden="true" data-icon="inline-start" />
          {t('taskShort')}
        </TripModeActionButton>
      </header>

      <TripModeTasksNotice />

      <div aria-live="polite" className="space-y-2">
        {feedback ? (
          <Alert>
            <Icons.Success aria-hidden="true" />
            <AlertDescription>{feedback}</AlertDescription>
            {undoAction ? (
              <AlertAction>
                <Button
                  disabled={mutatingItemId === undoAction.itemId}
                  onClick={() => void undoLastAction()}
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

      {day.items.length ? (
        <div className="space-y-3">
          {/* The day as a line through time: the clock on the left, the rail and
              its markers beside it, the stops and the legs between them on the
              right. One rail is drawn for the whole list so it never breaks
              between rows; each marker sits on a ring of page colour over it. */}
          <ol aria-label={t('listLabel')} className="relative">
            <span
              aria-hidden="true"
              className="absolute top-4 bottom-4 start-[calc(5.125rem-1px)] w-0.5 rounded-full bg-border"
            />
            {settledStops.length ? (
              <li className={rowGrid}>
                <span className="pt-3 text-[0.8125rem] leading-5 text-muted-foreground tabular-nums">
                  {settledStops[0]?.localStartTime
                    ? wallClock(settledStops[0].localStartTime)
                    : null}
                </span>
                <span className="flex justify-center pt-3.5">{railNode('completed')}</span>
                <button
                  aria-expanded={showSettled}
                  className="flex min-h-11 min-w-0 items-center gap-2 rounded-[var(--radius-md)] py-2 text-left text-[0.9375rem] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
                  onClick={() => setShowSettled((open) => !open)}
                  type="button"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {t('settledSummary', {
                      count: settledStops.length,
                      names: new Intl.ListFormat(locale, {
                        style: 'short',
                        type: 'conjunction',
                      }).format(settledStops.map(itemName)),
                    })}
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className={cn(
                      'size-4 shrink-0 transition-transform duration-[var(--motion-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none',
                      showSettled && 'rotate-180',
                    )}
                  />
                </button>
              </li>
            ) : null}

            {entries.map((entry) => {
              if (entry.kind === 'leg') {
                return (
                  <li className={rowGrid} key={`leg-${entry.segment.id}`}>
                    <span />
                    <span />
                    <p
                      className={cn(
                        'py-1.5 text-[0.8125rem] leading-5 text-muted-foreground tabular-nums',
                        staleRoutes && entry.segment.status === 'ok' && 'text-status-warning',
                      )}
                    >
                      {legText(entry.segment)}
                    </p>
                  </li>
                );
              }

              if (entry.kind === 'base') {
                const base = resolveBase(entry.tripPlaceId);
                if (!base) return null;

                return (
                  <li className={rowGrid} key={`base-${entry.role}`}>
                    <span />
                    <span className="flex justify-center pt-4">{railNode('base')}</span>
                    <div className="min-w-0 py-2.5">
                      <button
                        aria-label={itineraryT('viewDetailsFor', { name: base.name })}
                        className="block max-w-full truncate rounded-[var(--radius-sm)] text-left text-[0.9375rem] font-semibold text-foreground outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
                        onClick={() => openPlaceDetails(base.tripPlace, day.date)}
                        type="button"
                      >
                        {base.name}
                      </button>
                      <p className="text-[0.8125rem] text-muted-foreground">
                        {entry.role === 'arrival' ? t('dayBaseStart') : t('dayBaseEnd')}
                      </p>
                    </div>
                  </li>
                );
              }

              const { item } = entry;
              const name = itemName(item);
              const location = itemLocation(item);
              const place = itemPlace(item);
              const directions = directionsHref(item);
              const isCurrent = currentItemId === item.id;
              const expanded = expandedId === item.id;
              const busy = mutatingItemId === item.id;
              const upcoming = item.travelStatus === 'upcoming';
              const upcomingIndex = upcomingItems.findIndex(
                (candidate) => candidate.id === item.id,
              );
              const linkedReservations = reservationsByItem.get(item.id) ?? [];
              const linkedTasks = tasksForItem(tripModeTasks.data?.tasks ?? [], item.id);
              const openTaskCount = linkedTasks.filter((task) => !task.completed).length;
              const tripPlace = item.tripPlace;
              const endTime = item.localStartTime ? itineraryLocalEndTime(item) : null;
              const node = isCurrent ? 'current' : upcoming ? 'upcoming' : item.travelStatus;
              const where =
                place || location ? (
                  <span className="flex min-w-0 items-start gap-1.5">
                    <MapPin aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      {place ? <span className="font-medium text-foreground">{place}</span> : null}
                      {place && location ? <span aria-hidden="true"> · </span> : null}
                      {location}
                    </span>
                  </span>
                ) : null;
              const toggle = () => setExpandedItemId(expanded ? null : item.id);

              return (
                <li
                  className={rowGrid}
                  id={`trip-mode-item-${item.id}`}
                  key={item.id}
                  tabIndex={-1}
                >
                  {/* The clock, outside the stop: the column a day is read down. */}
                  <span
                    className={cn(
                      'pt-3 text-[0.8125rem] leading-5 tabular-nums',
                      expanded && 'pt-4',
                      isCurrent
                        ? 'text-accent-strong'
                        : upcoming
                          ? 'text-foreground'
                          : 'text-muted-foreground',
                    )}
                  >
                    {item.localStartTime ? (
                      <>
                        <span className="block font-semibold">
                          {wallClock(item.localStartTime)}
                        </span>
                        {isCurrent && endTime ? (
                          <span className="block text-muted-foreground">{wallClock(endTime)}</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="block text-xs leading-4 [overflow-wrap:anywhere] text-muted-foreground">
                        {item.dayPart ? t(`schedule.${item.dayPart}`) : null}
                      </span>
                    )}
                  </span>
                  <span
                    className={cn('flex justify-center', expanded ? 'pt-[1.125rem]' : 'pt-3.5')}
                  >
                    {railNode(node)}
                  </span>

                  {expanded ? (
                    // The stop open: everything a traveller does at it, labelled,
                    // in the thumb's reach rather than behind a menu.
                    <article
                      className={cn(
                        'my-1 min-w-0 p-4',
                        tripModeCardClass,
                        isCurrent && 'border-accent-strong/30',
                      )}
                    >
                      <button
                        aria-expanded="true"
                        aria-label={t('hideActions', { name })}
                        className="block w-full rounded-[var(--radius-sm)] text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                        onClick={toggle}
                        type="button"
                      >
                        {isCurrent && context.currentOrRelevant ? (
                          <span className="block text-xs font-semibold tracking-[0.08em] text-accent-strong uppercase">
                            {nowT(`currentKind.${context.currentOrRelevant.kind}`)}
                          </span>
                        ) : !upcoming ? (
                          <span className="block text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                            {item.travelStatus === 'completed'
                              ? t('statusCompleted')
                              : t('statusSkipped')}
                          </span>
                        ) : null}
                        <span
                          className={cn(
                            'mt-0.5 block text-lg leading-6 font-semibold text-foreground',
                            !upcoming && 'text-muted-foreground line-through decoration-1',
                          )}
                        >
                          {name}
                        </span>
                      </button>
                      <div className="mt-1 space-y-1 text-[0.8125rem] leading-5 text-muted-foreground">
                        {/* The clock is in the column beside the card; the card
                            says only what that column cannot - and the schedule
                            when there is no time or day part to put there. */}
                        {item.priority || (!item.localStartTime && !item.dayPart) ? (
                          <p>
                            {[
                              item.priority ? tripPlacesT(`priority.${item.priority}`) : null,
                              !item.localStartTime && !item.dayPart ? itemSchedule(item) : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        ) : null}
                        <PlaceHoursNote
                          status={tripPlace ? placeHours[tripPlace.id]?.hours : undefined}
                        />
                        {where}
                        {item.notes || (tripPlace?.note && tripPlace.note !== item.notes) ? (
                          <p className="flex items-start gap-1.5 text-text-subtle">
                            <Icons.Notes aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                            <span className="min-w-0 line-clamp-2">
                              {item.notes ?? tripPlace?.note}
                            </span>
                          </p>
                        ) : null}
                        {linkedReservations.length ? (
                          <Link
                            className="inline-flex min-h-8 items-center gap-1.5 rounded-[var(--radius-sm)] outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
                            href={`/trips/${tripId}/reservations`}
                          >
                            <Icons.Reservations
                              aria-hidden="true"
                              className="size-3.5 shrink-0 text-brand"
                            />
                            <span className="min-w-0 truncate">{linkedReservations[0]!.title}</span>
                            {linkedReservations.length > 1 ? (
                              <span className="shrink-0 text-text-subtle">
                                {t('moreReservations', { count: linkedReservations.length - 1 })}
                              </span>
                            ) : null}
                          </Link>
                        ) : null}
                      </div>

                      <div className="mt-3 grid grid-cols-3 gap-1.5">
                        {upcoming ? (
                          <>
                            <Button
                              aria-label={t('completeItem', { name })}
                              className="h-11 rounded-[var(--radius-lg)] border-transparent bg-secondary px-1 text-[0.8125rem] font-semibold text-secondary-foreground hover:bg-secondary/80"
                              disabled={busy}
                              onClick={() => void changeStatus(item, 'completed')}
                              variant="ghost"
                            >
                              {t('done')}
                            </Button>
                            <Button
                              className="h-11 rounded-[var(--radius-lg)] bg-muted px-1 text-[0.8125rem] font-semibold text-foreground hover:bg-surface-hover"
                              disabled={busy}
                              onClick={() => void changeStatus(item, 'skipped')}
                              variant="ghost"
                            >
                              {t('skip')}
                            </Button>
                          </>
                        ) : (
                          <Button
                            className="col-span-2 h-11 rounded-[var(--radius-lg)] bg-muted px-1 text-[0.8125rem] font-semibold text-foreground hover:bg-surface-hover"
                            disabled={busy}
                            onClick={() => void changeStatus(item, 'upcoming')}
                            variant="ghost"
                          >
                            <RotateCcw aria-hidden="true" data-icon="inline-start" />
                            {item.travelStatus === 'completed' ? t('undoComplete') : t('undoSkip')}
                          </Button>
                        )}
                        {directions ? (
                          <Button
                            className="h-11 rounded-[var(--radius-lg)] bg-muted px-1 text-[0.8125rem] font-semibold text-foreground hover:bg-surface-hover"
                            nativeButton={false}
                            render={
                              <a
                                aria-label={t('directionsExternal', { name })}
                                href={directions}
                                rel="noreferrer"
                                target="_blank"
                              />
                            }
                            variant="ghost"
                          >
                            {t('directions')}
                          </Button>
                        ) : (
                          <Button
                            className="h-11 rounded-[var(--radius-lg)] bg-muted px-1 text-[0.8125rem] font-semibold text-foreground hover:bg-surface-hover"
                            disabled={busy}
                            onClick={() => openSchedule(item)}
                            variant="ghost"
                          >
                            {t('timeShort')}
                          </Button>
                        )}
                      </div>

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {directions ? (
                          <Button
                            className="h-9 rounded-full px-3.5 font-normal shadow-none"
                            disabled={busy}
                            onClick={() => openSchedule(item)}
                            variant="outline"
                          >
                            {t('timeShort')}
                          </Button>
                        ) : null}
                        <Button
                          className="h-9 rounded-full px-3.5 font-normal shadow-none"
                          onClick={() => openMemoryFor(item.id)}
                          variant="outline"
                        >
                          {memoryTranslations('quickAction')}
                        </Button>
                        <Button
                          className="h-9 rounded-full px-3.5 font-normal shadow-none"
                          nativeButton={false}
                          render={<Link href={expenseHref(item.id)} />}
                          variant="outline"
                        >
                          {t('expense')}
                        </Button>
                        {tripPlace ? (
                          <Button
                            aria-label={itineraryT('viewDetailsFor', { name })}
                            className="h-9 rounded-full px-3.5 font-normal shadow-none"
                            onClick={() => openPlaceDetails(tripPlace, day.date)}
                            variant="outline"
                          >
                            {t('details')}
                          </Button>
                        ) : null}
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            aria-label={t('moreActions', { name })}
                            disabled={busy}
                            render={
                              <Button
                                className="size-9 rounded-full shadow-none"
                                size="icon"
                                type="button"
                                variant="outline"
                              />
                            }
                          >
                            <Ellipsis aria-hidden="true" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-52">
                            {upcoming ? (
                              <>
                                <DropdownMenuItem
                                  disabled={upcomingIndex <= 0}
                                  onClick={() => void reorder(item, 'earlier')}
                                >
                                  <ArrowUp aria-hidden="true" />
                                  {t('moveEarlier')}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={upcomingIndex >= upcomingItems.length - 1}
                                  onClick={() => void reorder(item, 'later')}
                                >
                                  <ArrowDown aria-hidden="true" />
                                  {t('moveLater')}
                                </DropdownMenuItem>
                              </>
                            ) : null}
                            {itinerary.days.length > 1 ? (
                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger>
                                  <CalendarDays aria-hidden="true" />
                                  {t('moveToDay')}
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                                  {itinerary.days
                                    .filter((candidate) => candidate.id !== day.id)
                                    .map((candidate) => (
                                      <DropdownMenuItem
                                        key={candidate.id}
                                        onClick={() => void moveToDay(item, candidate.id)}
                                      >
                                        {moveToDayLabel(candidate)}
                                      </DropdownMenuItem>
                                    ))}
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      <TripModeTaskDisclosure
                        addContext={{ itineraryItemId: item.id, kind: 'item' }}
                        className="mt-3 border-t border-border-subtle pt-1"
                        tasks={linkedTasks}
                        title={tasksT('stopTitle')}
                      />
                    </article>
                  ) : (
                    <div className="min-w-0 py-2">
                      <div className="flex items-start gap-2">
                        <button
                          aria-expanded="false"
                          aria-label={t('showActions', { name })}
                          className="min-h-11 min-w-0 flex-1 rounded-[var(--radius-sm)] text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                          onClick={toggle}
                          type="button"
                        >
                          <span
                            className={cn(
                              'block text-base leading-6 font-semibold text-foreground',
                              !upcoming &&
                                'font-medium text-muted-foreground line-through decoration-1',
                            )}
                          >
                            {name}
                          </span>
                          <span className="block truncate text-[0.8125rem] leading-5 text-muted-foreground">
                            {[
                              item.localStartTime || item.dayPart ? null : itemSchedule(item),
                              item.priority ? tripPlacesT(`priority.${item.priority}`) : null,
                              place ?? location,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </button>
                        {linkedReservations.length ? (
                          <span className="mt-1 shrink-0 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">
                            {t('booked')}
                          </span>
                        ) : null}
                        {upcoming ? (
                          <Button
                            aria-expanded={
                              linkedTasks.length ? openTasksItemId === item.id : undefined
                            }
                            aria-label={
                              linkedTasks.length
                                ? t('stopTasks', { count: openTaskCount, name })
                                : t('addStopTask', { name })
                            }
                            className="-me-2 h-11 shrink-0 gap-1 px-2 text-xs font-semibold text-muted-foreground"
                            disabled={tripModeTasks.status !== 'ready'}
                            onClick={() =>
                              linkedTasks.length
                                ? setOpenTasksItemId((open) => (open === item.id ? null : item.id))
                                : tripModeTasks.openCreate({
                                    itineraryItemId: item.id,
                                    kind: 'item',
                                  })
                            }
                            variant="ghost"
                          >
                            <Icons.Tasks aria-hidden="true" className="size-[1.125rem]" />
                            {openTaskCount ? openTaskCount : null}
                          </Button>
                        ) : null}
                      </div>
                      <PlaceHoursNote
                        status={tripPlace ? placeHours[tripPlace.id]?.hours : undefined}
                      />
                      {openTasksItemId === item.id && linkedTasks.length ? (
                        <div className="mt-1 space-y-2 rounded-[var(--radius-lg)] bg-muted/50 px-3 py-2">
                          <TripModeTaskList tasks={linkedTasks} />
                          <Button
                            onClick={() =>
                              tripModeTasks.openCreate({ itineraryItemId: item.id, kind: 'item' })
                            }
                            size="xs"
                            variant="ghost"
                          >
                            <Plus aria-hidden="true" data-icon="inline-start" />
                            {tasksT('add')}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {/* Adding to the day follows the day, where the next stop would go. */}
          <Button
            className="h-12 w-full rounded-[var(--radius-lg)] border-dashed border-border-strong bg-transparent shadow-none"
            onClick={() => setCreateItemOpen(true)}
            variant="outline"
          >
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t('addItem')}
          </Button>
        </div>
      ) : (
        <PageState
          actions={
            <Button onClick={() => setCreateItemOpen(true)}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('addFirstItem')}
            </Button>
          }
          className="py-8"
          description={t('emptyDescription')}
          headingLevel={2}
          icon={<CalendarDays aria-hidden="true" />}
          title={t('emptyTitle')}
        />
      )}

      <section aria-label={tasksT('todayTitle')} className={cn('px-4 py-1', tripModeCardClass)}>
        <TripModeTaskDisclosure
          addContext={{ itineraryDayId: day.id, kind: 'day' }}
          tasks={dailyTasks}
          title={tasksT('todayTitle')}
        />
      </section>

      <TripWeatherContext isPreview={isPreview} selectedDate={day.date} tripId={tripId} />

      {/* What to know about the day sits beside its weather rather than in it:
          a holiday or a month's typical pattern is not a forecast. */}
      <TripInsights dayId={day.id} tripId={tripId} />

      {day.notes ? (
        <section className={cn('flex items-start gap-3 p-4', tripModeCardClass)}>
          <Icons.Notes aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{t('dayNote')}</h3>
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {day.notes}
            </p>
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <TripModeActionButton nativeButton={false} render={<Link href={expenseHref()} />}>
          <Icons.Expenses aria-hidden="true" data-icon="inline-start" />
          {t('expense')}
        </TripModeActionButton>
        <TripModeActionButton onClick={() => openMemoryFor(null)}>
          <Icons.Memories aria-hidden="true" data-icon="inline-start" />
          {memoryTranslations('quickAction')}
        </TripModeActionButton>
      </div>

      <TripModePendingMemories key={pendingMemoriesKey} tripId={tripId} />

      <TripModeMemorySheet
        dayDate={date}
        dayId={day.id}
        defaultItemId={memoryItemId ?? currentItemId}
        items={day.items}
        onOpenChange={setMemoryOpen}
        onSaved={(queued) => {
          setUndoAction(null);
          setPendingMemoriesKey((current) => current + 1);
          setFeedback(memoryTranslations(queued ? 'savedOffline' : 'saved'));
        }}
        open={memoryOpen}
        timeZone={day.defaultTimeZone}
        tripId={tripId}
      />

      {createItemOpen ? (
        <StopEditorSheet
          id={0}
          locationBias={null}
          onClose={() => setCreateItemOpen(false)}
          onSaved={async () => {
            setCreateItemOpen(false);
            await refresh();
            setError(null);
            setUndoAction(null);
            setFeedback(t('feedback.added'));
          }}
          onTripPlaceAdded={() => {
            void refresh().catch(() => undefined);
          }}
          open
          placeUse={placeUse}
          request={{
            dayId: day.id,
            dayLabel: itineraryT('dayNumber', { number: dayNumber }),
            kind: 'create',
          }}
          tripId={tripId}
          tripPlaces={itinerary.tripPlaces}
        />
      ) : null}

      <Sheet
        onOpenChange={(open) => {
          if (!open) {
            setScheduleItem(null);
            setScheduleError(null);
          }
        }}
        open={Boolean(scheduleItem)}
      >
        <SheetContent closeLabel={t('scheduleEditor.close')} side="right">
          <SheetHeader>
            <SheetTitle>{t('scheduleEditor.title')}</SheetTitle>
            <SheetDescription>
              {scheduleItem
                ? t('scheduleEditor.description', { name: itemName(scheduleItem) })
                : null}
            </SheetDescription>
          </SheetHeader>
          <div className="overflow-y-auto px-5 pb-5">
            {scheduleError ? (
              <Alert className="mb-4" variant="destructive">
                <Icons.Error aria-hidden="true" />
                <AlertDescription>{scheduleError}</AlertDescription>
              </Alert>
            ) : null}
            <TripModeScheduleFields
              exactTime={exactTime}
              onExactTimeChange={setExactTime}
              onScheduleChange={setSchedule}
              schedule={schedule}
            />
          </div>
          <SheetFooter>
            <Button
              disabled={Boolean(scheduleItem && mutatingItemId === scheduleItem.id)}
              onClick={() => void saveSchedule()}
            >
              {t('scheduleEditor.save')}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
