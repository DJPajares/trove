'use client';

import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Compass,
  Ellipsis,
  ExternalLink,
  ListChecks,
  MapPin,
  Pencil,
  Plus,
  RotateCcw,
  SkipForward,
  StickyNote,
  WalletCards,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';

import { PageState } from '@/components/page-state';
import { ItineraryCreateItemSheet } from '@/components/itinerary-create-item-sheet';
import { usePreferences } from '@/components/preferences-provider';
import { TimelineGroup, TimelineMarker, TimelineRow } from '@/components/timeline-row';
import { useTripModeData } from '@/components/trip-mode-data';
import { useTripModePlaceDetails, useTripModePreview } from '@/components/trip-mode-shell';
import { useOnlineStatus } from '@/components/trip-sync-status';
import { TripModeMemoryDialog } from '@/components/trip-mode-memory-dialog';
import { TripModePendingMemories } from '@/components/trip-mode-pending-memories';
import { TripWeatherContext } from '@/components/trip-weather-context';
import {
  TripModeTaskDisclosure,
  TripModeTasksNotice,
  useTripModeTasks,
} from '@/components/trip-mode-tasks';
import {
  TripModeScheduleFields,
  type TripModeSchedule,
} from '@/components/trip-mode-schedule-fields';
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
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
  organizeItineraryItem,
  type ItineraryItem,
  type ItineraryScheduleInput,
  type ItineraryTravelStatus,
  updateItineraryItem,
  updateItineraryItemTravelStatus,
} from '@/lib/itinerary/api';
import { buildDaySequence, resolveDailyBases } from '@/lib/itinerary/day-sequence';
import { formatItineraryTimeRange } from '@/lib/itinerary/item-timing';
import { scheduledPlaceUse } from '@/lib/itinerary/places';
import type { Reservation } from '@/lib/reservations/api';
import { tasksForItem, todayTaskRollup } from '@/lib/tasks/trip-mode';
import { cn } from '@/lib/utils';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import { useVisibleKeys } from '@/hooks/use-visible-keys';
import {
  editorialSubjectKey,
  MAX_EDITORIAL_IMAGE_SUBJECTS,
  type EditorialSubject,
} from '@/lib/media/editorial-images';
import { PlaceMedia } from '@/components/place-media';
import { dayLocality } from '@/lib/itinerary/day-place';
import { resolvePlaceMediaSource } from '@/lib/media/trip-media';
import { resolveProviderPlaceName } from '@/lib/trip-places/place-name';

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

const stopTitleClassName =
  'rounded-[var(--radius-sm)] text-left outline-none after:absolute after:inset-0 hover:underline focus-visible:ring-3 focus-visible:ring-ring/40';

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
  const itineraryT = useTranslations('itinerary');
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
  const reservations = loadedReservations ?? [];

  useEffect(() => {
    setUndoAction(null);
  }, [previewSelection?.date, previewSelection?.time]);

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

  // "Current" is the one thing here only the server can answer, and its answer
  // is about the day it was asked for. While it is still about the last one,
  // nothing on this day is current - which is truer than accenting a row
  // because a request has not come back yet.
  //
  // Resolved above the guards below because the scroll effect reads it, and a
  // hook may not sit after an early return.
  /**
   * A photograph for each stop the traveller can see.
   *
   * Asked for under the provider's name for the place, never the traveller's
   * nickname - "Mum's favourite bakery" is a photograph of nothing - and only
   * for rows near the viewport, so a seventeen-stop day resolves as it is
   * scrolled rather than losing its tail to the cap.
   *
   * This is the free track. Editorial photography is decorative, hotlinked and
   * cached for ninety days; a Google Places photo would be billable per render
   * and is what `resolvePlaceMediaSource` has no member for.
   */
  const { observe: observeStop, visibleKeys: visibleItemIds } = useVisibleKeys();
  const editorialSubjects: EditorialSubject[] = (day?.items ?? [])
    .filter((item) => item.tripPlace && visibleItemIds.has(item.id))
    .flatMap((item) => {
      const providerName = item.tripPlace ? resolveProviderPlaceName(item.tripPlace) : null;
      if (!providerName || !item.tripPlace) return [];

      return [
        {
          category: item.tripPlace.place.snapshot?.category,
          name: providerName,
          placeId: item.tripPlace.place.id,
        },
      ];
    })
    .slice(0, MAX_EDITORIAL_IMAGE_SUBJECTS);
  const editorialImages = useEditorialImages(editorialSubjects);
  /**
   * A photograph of this stop, or nothing.
   *
   * Exact matches only. When the provider cannot find the place it answers from
   * a pool keyed on the place's type, and that pool is not a photograph of
   * anywhere near it: asked for Whakarewarewa Forest Park it offers Qutub Minar
   * in Delhi, and for The Shire's Rest Cafe a restaurant in Spain. Beside the
   * name of a real place that is not decoration, it is the wrong continent.
   *
   * So a stop Trove cannot picture shows the branded tile for its category
   * instead - a green field and a leaf beside a forest park, which says what
   * kind of place it is without pretending to be a picture of it.
   */
  const editorialFor = (item: ItineraryItem) => {
    const providerName = item.tripPlace ? resolveProviderPlaceName(item.tripPlace) : null;
    if (!providerName || !item.tripPlace) return null;

    const image = editorialImages.get(
      editorialSubjectKey({
        category: item.tripPlace.place.snapshot?.category,
        name: providerName,
        placeId: item.tripPlace.place.id,
      }),
    )?.[0];

    return image?.matchKind === 'exact' ? image : null;
  };

  const currentItemId =
    context?.selectedDate === day?.date ? (context?.currentOrRelevant?.itemId ?? null) : null;

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
      element?.scrollIntoView({ block: 'center' });
      if (hash) element?.focus({ preventScroll: true });
    });
  }, [currentItemId, day]);

  if (status === 'loading') return <TodaySkeleton label={t('loading')} />;

  if (status === 'error' || !context || !itinerary) {
    return (
      <PageState
        actions={<Button onClick={() => void refresh()}>{t('tryAgain')}</Button>}
        description={t('loadErrorDescription')}
        headingLevel={2}
        icon={<Compass aria-hidden="true" />}
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

  // The snapshot travels with the itinerary, including the copy held offline, so
  // these no longer depend on being online to name a Place or show its address.
  const snapshotFor = (item: ItineraryItem) => item.tripPlace?.place.snapshot ?? null;
  const itemName = (item: ItineraryItem) =>
    item.customLabel ??
    item.tripPlace?.place.name ??
    snapshotFor(item)?.name ??
    item.tripPlace?.place.providerLabel ??
    t('itemFallback');
  const itemLocation = (item: ItineraryItem) =>
    item.customLocation?.label ??
    snapshotFor(item)?.address ??
    item.tripPlace?.place.providerAddress ??
    null;
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
  // a stop is the same stop whichever screen the traveller is standing on.
  // Legs are left out here: Trip Mode never asked the API for route segments,
  // and a day list is not worth a new round of them.
  const entries = buildDaySequence({ bases: resolveDailyBases({ day }), items: day.items });
  /**
   * What to call the day, in the order that is true.
   *
   * The traveller's own title wins. Failing that the town the day is mostly
   * spent in, which is read from addresses already in hand - almost no day is
   * ever named by anyone, so without this rung the hero would be blank on
   * nearly all of them. Failing both, nothing: the date is already on screen
   * and inventing a title for a day is how a mockup ends up saying
   * "Discovering local gems in a curated the North Drive".
   */
  const dayLocalityName = dayLocality(
    (day?.items ?? []).map((item) => item.tripPlace?.place.snapshot?.address ?? null),
  );
  const heroTitle =
    day?.name?.trim() || (dayLocalityName ? t('heroLocality', { place: dayLocalityName }) : null);
  /**
   * The day is pictured by its first stop that has a photograph of itself. A
   * day whose stops Trove cannot picture simply has no hero - the date below
   * already says what day it is.
   *
   * It costs no request of its own: the batch above has already resolved every
   * stop.
   */
  const heroItem = (day?.items ?? []).find((item) => editorialFor(item));
  const heroEditorial = heroItem ? editorialFor(heroItem) : null;
  const heroShown = Boolean(heroEditorial && heroTitle);

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
      located: Boolean(tripPlace.place.location),
      name:
        tripPlace.place.name ??
        tripPlace.place.snapshot?.name ??
        tripPlace.place.providerLabel ??
        t('itemFallback'),
      tripPlace,
    };
  };

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
                  ref={active ? activeDayChipRef : undefined}
                  className={cn(
                    'flex min-h-14 w-18 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-md)] border px-1 text-[length:var(--text-metadata)] leading-4 whitespace-nowrap outline-none transition-colors duration-[var(--motion-standard)] ease-[var(--ease-standard)] focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none',
                    active
                      ? 'border-brand bg-brand text-primary-foreground'
                      : 'border-border-subtle text-muted-foreground hover:bg-surface-hover hover:text-foreground',
                  )}
                  onClick={() =>
                    isPreview
                      ? updatePreview({ date: candidate.date })
                      : setViewedDate(candidate.date)
                  }
                  type="button"
                >
                  <span className="font-semibold tabular-nums">
                    {itineraryT('dayNumber', { number: index + 1 })}
                  </span>
                  <span className={cn('tabular-nums', active ? 'text-primary-foreground/85' : '')}>
                    {dayChipDate(candidate.date)}
                  </span>
                  {/* The day the traveller is actually in keeps a mark, so
                      finding the way back is not a counting exercise. */}
                  {isContextDay ? (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'h-1 w-1 rounded-full',
                        active ? 'bg-primary-foreground' : 'bg-brand',
                      )}
                    />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* The day as a place rather than a date. The photograph sits inset
          within the card rather than bleeding to its edge, which is what makes
          it read as a framed print instead of a banner. It appears only when
          there is both something to show and something true to call it. */}
      {heroShown ? (
        <section
          aria-labelledby="trip-mode-day-hero-heading"
          className="rounded-[var(--radius-2xl)] border border-border-subtle bg-card p-2 shadow-[var(--shadow-card)]"
        >
          <div className="relative isolate overflow-hidden rounded-[var(--radius-xl)]">
            <PlaceMedia
              alt=""
              category={heroItem?.tripPlace?.place.snapshot?.category}
              className="h-36 w-full rounded-none sm:h-44 lg:h-64"
              sizes="(max-width: 72rem) 100vw, 72rem"
              source={resolvePlaceMediaSource({ editorial: heroEditorial })}
              variant="banner"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-gradient-to-t from-surface-overlay/85 from-0% to-transparent to-42%"
            />
            <h2
              className="absolute inset-x-0 bottom-0 p-3 text-[length:var(--text-section-title)] leading-[1.18] font-semibold tracking-[-0.022em] text-balance text-white"
              id="trip-mode-day-hero-heading"
            >
              {heroTitle}
            </h2>
          </div>
          <p className="px-1 pt-2 pb-0.5 text-[length:var(--text-metadata)] leading-5 text-text-subtle">
            {day.notes?.trim() || t('heroStops', { count: day.items.length })}
          </p>
        </section>
      ) : null}

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {/* The hero above is the day's heading when it is there, so this one
              steps back to being the date rather than saying the same words a
              second time. */}
          {day.name && !heroShown ? (
            <h2 className="text-[length:var(--text-section-title)] leading-[1.18] font-semibold tracking-[-0.022em] text-pretty">
              {day.name}
            </h2>
          ) : (
            <h2 className="sr-only">{day.name ?? t('title')}</h2>
          )}
          <p className="text-[length:var(--text-metadata)] leading-5 font-medium text-muted-foreground tabular-nums">
            {day.name ? itineraryT('dayOption', { date, number: dayNumber }) : date}
          </p>
          <p className="mt-0.5 text-[length:var(--text-metadata)] leading-5 text-text-subtle">
            {/* The clock these times are read on, which for a traveller who
                has flown is theirs rather than the one the day was planned in. */}
            {t('timeZone', {
              timeZone: isPreview ? day.defaultTimeZone : (deviceTimeZone() ?? day.defaultTimeZone),
            })}
          </p>
        </div>
        {/* Adding to the day is the one action worth a control of its own here;
            the rest of what a day collects lives under the row it belongs to. */}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={tripModeTasks.status !== 'ready'}
            onClick={() => tripModeTasks.openCreate({ itineraryDayId: day.id, kind: 'day' })}
            size="sm"
            variant="outline"
          >
            <ListChecks aria-hidden="true" data-icon="inline-start" />
            {tasksT('add')}
          </Button>
          <Button onClick={() => setCreateItemOpen(true)} size="sm">
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t('addItem')}
          </Button>
        </div>
      </header>

      {/* Above the stops rather than beside them: the weather is what a
          traveller checks before deciding how the day's list gets done. */}
      <TripWeatherContext
        isPreview={isPreview}
        selectedDate={day.date}
        tripId={tripId}
        variant="card"
      />

      <TripModeTasksNotice />

      {day.notes ? (
        <section className="flex items-start gap-3 border-y border-border py-4">
          <StickyNote aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{t('dayNote')}</h3>
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {day.notes}
            </p>
          </div>
        </section>
      ) : null}

      <div aria-live="polite" className="space-y-2">
        {feedback ? (
          <Alert>
            <CheckCircle2 aria-hidden="true" />
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
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      {day.items.length ? (
        <TimelineGroup label={t('listLabel')}>
          {entries.map((entry, index) => {
            const connector =
              entries.length === 1
                ? 'none'
                : index === 0
                  ? 'after'
                  : index === entries.length - 1
                    ? 'before'
                    : 'both';

            if (entry.kind === 'base') {
              const base = resolveBase(entry.tripPlaceId);
              if (!base) return null;

              return (
                <TimelineRow
                  connector={connector}
                  description={entry.role === 'arrival' ? t('dayBaseStart') : t('dayBaseEnd')}
                  key={`base-${entry.role}`}
                  marker={
                    <TimelineMarker
                      label={t('stopNumber', { number: entry.stopNumber })}
                      variant={base.located ? 'base-wide' : 'base-wide-unlocated'}
                    >
                      {entry.stopNumber}
                    </TimelineMarker>
                  }
                  title={
                    <button
                      aria-label={itineraryT('viewDetailsFor', { name: base.name })}
                      className={stopTitleClassName}
                      onClick={() => openPlaceDetails(base.tripPlace)}
                      type="button"
                    >
                      {base.name}
                    </button>
                  }
                />
              );
            }

            if (entry.kind === 'leg') return null;

            const { item } = entry;
            const name = itemName(item);
            const location = itemLocation(item);
            const directions = directionsHref(item);
            const isCurrent = currentItemId === item.id;
            const busy = mutatingItemId === item.id;
            const upcoming = item.travelStatus === 'upcoming';
            const completed = item.travelStatus === 'completed';
            const upcomingIndex = upcomingItems.findIndex((candidate) => candidate.id === item.id);
            const linkedReservations = reservationsByItem.get(item.id) ?? [];
            const linkedTasks = tasksForItem(tripModeTasks.data?.tasks ?? [], item.id);
            const tripPlace = item.tripPlace;
            const undoLabel = item.travelStatus === 'completed' ? t('undoComplete') : t('undoSkip');

            return (
              <TimelineRow
                actions={
                  <div className="flex items-center gap-1">
                    {/* The affirmative action of the whole view, one tap away.
                        Everything else the row can do is labelled in the menu,
                        which is what keeps the title readable at 390px. */}
                    <Button
                      aria-label={upcoming ? t('completeItem', { name }) : undoLabel}
                      disabled={busy}
                      onClick={() => void changeStatus(item, upcoming ? 'completed' : 'upcoming')}
                      size="icon-sm"
                      variant={upcoming ? 'secondary' : 'ghost'}
                    >
                      {upcoming ? <Check aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
                    </Button>

                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label={t('moreActions', { name })}
                        disabled={busy}
                        render={<Button size="icon-sm" type="button" variant="ghost" />}
                      >
                        <Ellipsis aria-hidden="true" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-52">
                        {upcoming ? (
                          <DropdownMenuItem onClick={() => void changeStatus(item, 'skipped')}>
                            <SkipForward aria-hidden="true" />
                            {t('skip')}
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem onClick={() => openSchedule(item)}>
                          <Pencil aria-hidden="true" />
                          {t('editTime')}
                        </DropdownMenuItem>
                        <DropdownMenuLinkItem render={<Link href={expenseHref(item.id)} />}>
                          <WalletCards aria-hidden="true" />
                          {t('addExpense')}
                        </DropdownMenuLinkItem>
                        <DropdownMenuItem
                          disabled={tripModeTasks.status !== 'ready'}
                          onClick={() =>
                            tripModeTasks.openCreate({ itineraryItemId: item.id, kind: 'item' })
                          }
                        >
                          <ListChecks aria-hidden="true" />
                          {tasksT('add')}
                        </DropdownMenuItem>
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
                                    {candidate.name
                                      ? itineraryT('dayOptionNamed', {
                                          date: new Intl.DateTimeFormat(locale, {
                                            day: 'numeric',
                                            month: 'short',
                                            timeZone: 'UTC',
                                          }).format(new Date(`${candidate.date}T00:00:00.000Z`)),
                                          name: candidate.name,
                                          number: itinerary.days.indexOf(candidate) + 1,
                                        })
                                      : t('dayOption', {
                                          date: new Intl.DateTimeFormat(locale, {
                                            day: 'numeric',
                                            month: 'short',
                                            timeZone: 'UTC',
                                          }).format(new Date(`${candidate.date}T00:00:00.000Z`)),
                                          number: itinerary.days.indexOf(candidate) + 1,
                                        })}
                                  </DropdownMenuItem>
                                ))}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        ) : null}
                        {directions ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuLinkItem
                              render={
                                <a
                                  aria-label={t('directionsExternal', { name })}
                                  href={directions}
                                  rel="noreferrer"
                                  target="_blank"
                                />
                              }
                            >
                              <ExternalLink aria-hidden="true" />
                              {t('directions')}
                            </DropdownMenuLinkItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                }
                className={completed ? 'bg-muted/50' : undefined}
                connector={connector}
                description={
                  <>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium text-brand tabular-nums">
                        {itemSchedule(item)}
                      </span>
                      {location ? (
                        <span className="inline-flex min-w-0 items-start gap-1.5">
                          <MapPin aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                          <span className="min-w-0">{location}</span>
                        </span>
                      ) : null}
                    </span>
                    {item.notes || (item.tripPlace?.note && item.tripPlace.note !== item.notes) ? (
                      <span className="mt-1 flex items-start gap-1.5 text-text-subtle">
                        <StickyNote aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                        <span className="min-w-0 space-y-0.5">
                          {item.notes ? (
                            <span className="block line-clamp-2">{item.notes}</span>
                          ) : null}
                          {item.tripPlace?.note && item.tripPlace.note !== item.notes ? (
                            <span className="block line-clamp-2">{item.tripPlace.note}</span>
                          ) : null}
                        </span>
                      </span>
                    ) : null}
                    {linkedReservations.length ? (
                      <span className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                        <Link
                          className="relative z-10 inline-flex min-h-8 items-center gap-1.5 rounded-[var(--radius-sm)] outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
                          href={`/trips/${tripId}/reservations`}
                        >
                          <ClipboardCheck
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
                      </span>
                    ) : null}
                    {linkedTasks.length ? (
                      <TripModeTaskDisclosure
                        addContext={{ itineraryItemId: item.id, kind: 'item' }}
                        className="relative z-10 mt-1.5 border-t border-border-subtle pt-1"
                        tasks={linkedTasks}
                        title={tasksT('stopTitle')}
                      />
                    ) : null}
                  </>
                }
                id={`trip-mode-item-${item.id}`}
                key={item.id}
                marker={
                  /* The stop, as its own photograph. A place with none shows
                     the branded tile for its category, which is a designed
                     object rather than a hole - so the column reads evenly
                     whether or not a day's stops happen to be photogenic. The
                     number moves to the corner, because the day is still read
                     by it. */
                  <TimelineMarker
                    label={t('stopNumber', { number: entry.stopNumber })}
                    variant="photo"
                  >
                    <span className="block" ref={observeStop(item.id)}>
                      <PlaceMedia
                        alt=""
                        category={item.tripPlace?.place.snapshot?.category}
                        className="size-14 rounded-[var(--radius-md)]"
                        sizes="3.5rem"
                        source={resolvePlaceMediaSource({ editorial: editorialFor(item) })}
                        variant="thumbnail"
                      />
                    </span>
                    {/* Inside the tile rather than hung off its corner, so the
                        number costs the title none of its width and never sits
                        between the photograph and the words. */}
                    <span className="pointer-events-none absolute start-1 bottom-1 grid size-5 place-items-center rounded-full bg-neutral-950/65 text-[0.6875rem] leading-none font-semibold text-white backdrop-blur-sm tabular-nums">
                      {entry.stopNumber}
                    </span>
                  </TimelineMarker>
                }
                meta={
                  isCurrent || !upcoming ? (
                    completed ? (
                      <Badge variant="success">
                        <CheckCircle2 aria-hidden="true" />
                        {t('statusCompleted')}
                      </Badge>
                    ) : (
                      <span className="font-medium text-foreground">
                        {isCurrent ? t('current') : t('statusSkipped')}
                      </span>
                    )
                  ) : null
                }
                selected={isCurrent}
                tabIndex={-1}
                title={
                  tripPlace ? (
                    <button
                      aria-label={itineraryT('viewDetailsFor', { name })}
                      className={cn(
                        stopTitleClassName,
                        !upcoming && 'text-muted-foreground line-through decoration-1',
                      )}
                      onClick={() => openPlaceDetails(tripPlace)}
                      type="button"
                    >
                      {name}
                    </button>
                  ) : (
                    <span
                      className={cn(!upcoming && 'text-muted-foreground line-through decoration-1')}
                    >
                      {name}
                    </span>
                  )
                }
              />
            );
          })}
        </TimelineGroup>
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

      <section className="border-y border-border py-1" aria-label={tasksT('todayTitle')}>
        <TripModeTaskDisclosure
          addContext={{ itineraryDayId: day.id, kind: 'day' }}
          tasks={dailyTasks}
          title={tasksT('todayTitle')}
        />
      </section>

      <div className="flex flex-wrap gap-2 pt-4">
        <Button
          nativeButton={false}
          render={<Link href={expenseHref()} />}
          size="sm"
          variant="outline"
        >
          <Plus aria-hidden="true" data-icon="inline-start" />
          {t('expense')}
        </Button>
        <Button onClick={() => setMemoryOpen(true)} size="sm" variant="outline">
          <Plus aria-hidden="true" data-icon="inline-start" />
          {memoryTranslations('quickAction')}
        </Button>
      </div>

      <TripModePendingMemories key={pendingMemoriesKey} tripId={tripId} />

      <TripModeMemoryDialog
        dayDate={date}
        dayId={day.id}
        defaultItemId={currentItemId}
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
        <ItineraryCreateItemSheet
          dayId={day.id}
          onCreated={async () => {
            await refresh();
            setError(null);
            setUndoAction(null);
            setFeedback(t('feedback.added'));
          }}
          onOpenChange={setCreateItemOpen}
          onTripPlaceAdded={() => {
            void refresh().catch(() => undefined);
          }}
          open
          placeUse={placeUse}
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
