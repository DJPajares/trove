'use client';

import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  Ellipsis,
  ExternalLink,
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
import { useCallback, useEffect, useMemo, useState } from 'react';

import { PageState } from '@/components/page-state';
import { usePreferences } from '@/components/preferences-provider';
import { TimelineGroup, TimelineMarker, TimelineRow } from '@/components/timeline-row';
import { useTripModePlaceDetails, useTripModePreview } from '@/components/trip-mode-shell';
import { useOfflineDataRefreshKey, useOnlineStatus } from '@/components/trip-sync-status';
import { TripModeAddItemDialog } from '@/components/trip-mode-add-item-dialog';
import { TripModeMemoryDialog } from '@/components/trip-mode-memory-dialog';
import { TripModePendingMemories } from '@/components/trip-mode-pending-memories';
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
  fetchItinerary,
  fetchTripModeContext,
  organizeItineraryItem,
  type Itinerary,
  type ItineraryItem,
  type ItineraryScheduleInput,
  type ItineraryTravelStatus,
  type TripModeContext,
  updateItineraryItem,
  updateItineraryItemTravelStatus,
} from '@/lib/itinerary/api';
import { buildDaySequence, resolveDailyBases } from '@/lib/itinerary/day-sequence';
import { formatItineraryTimeRange } from '@/lib/itinerary/item-timing';
import { fetchReservations, type Reservation } from '@/lib/reservations/api';
import { fetchTasks, type Task } from '@/lib/tasks/api';
import { cn } from '@/lib/utils';

type LoadState =
  | { data: null; status: 'error' }
  | { data: null; status: 'loading' }
  | { data: { context: TripModeContext; itinerary: Itinerary }; status: 'ready' };

type SupportingContext = { reservations: Reservation[]; tasks: Task[] };

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
  const locale = useLocale();
  const { preferences } = usePreferences();
  const online = useOnlineStatus();
  const offlineDataRefreshKey = useOfflineDataRefreshKey();
  const { contextOptions, isPreview } = useTripModePreview();
  const { openPlaceDetails } = useTripModePlaceDetails();
  const [state, setState] = useState<LoadState>({ data: null, status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [mutatingItemId, setMutatingItemId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [pendingMemoriesKey, setPendingMemoriesKey] = useState(0);
  const [scheduleItem, setScheduleItem] = useState<ItineraryItem | null>(null);
  const [schedule, setSchedule] = useState<TripModeSchedule>('none');
  const [exactTime, setExactTime] = useState('');
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [supporting, setSupporting] = useState<SupportingContext>({ reservations: [], tasks: [] });

  const refresh = useCallback(async () => {
    const [context, itinerary] = await Promise.all([
      fetchTripModeContext(tripId, contextOptions()),
      fetchItinerary(tripId),
    ]);
    setState({ data: { context, itinerary }, status: 'ready' });
  }, [contextOptions, tripId]);

  useEffect(() => {
    let active = true;
    setState({ data: null, status: 'loading' });
    setSupporting({ reservations: [], tasks: [] });
    setUndoAction(null);
    void Promise.all([fetchTripModeContext(tripId, contextOptions()), fetchItinerary(tripId)])
      .then(([context, itinerary]) => {
        if (active) setState({ data: { context, itinerary }, status: 'ready' });
      })
      .catch(() => {
        if (active) setState({ data: null, status: 'error' });
      });
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
  }, [contextOptions, offlineDataRefreshKey, reloadKey, tripId]);

  const day = useMemo(() => {
    if (state.status !== 'ready') return null;
    return (
      state.data.itinerary.days.find(
        (candidate) => candidate.date === state.data.context.selectedDate,
      ) ?? null
    );
  }, [state]);
  const reservationsByItem = useMemo(() => {
    const grouped = new Map<string, Reservation[]>();
    for (const reservation of supporting.reservations) {
      if (!reservation.itineraryItem) continue;
      const current = grouped.get(reservation.itineraryItem.id) ?? [];
      current.push(reservation);
      grouped.set(reservation.itineraryItem.id, current);
    }
    return grouped;
  }, [supporting.reservations]);
  const openTasksByItem = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    for (const task of supporting.tasks) {
      if (task.completed || task.context.kind !== 'item') continue;
      const current = grouped.get(task.context.itineraryItemId) ?? [];
      current.push(task);
      grouped.set(task.context.itineraryItemId, current);
    }
    return grouped;
  }, [supporting.tasks]);

  useEffect(() => {
    if (!day || !window.location.hash.startsWith('#trip-mode-item-')) return;
    window.requestAnimationFrame(() => {
      const element = document.getElementById(window.location.hash.slice(1));
      element?.scrollIntoView({ block: 'center' });
      element?.focus({ preventScroll: true });
    });
  }, [day]);

  if (state.status === 'loading') return <TodaySkeleton label={t('loading')} />;

  if (state.status === 'error') {
    return (
      <PageState
        actions={
          <Button onClick={() => setReloadKey((value) => value + 1)}>{t('tryAgain')}</Button>
        }
        description={t('loadErrorDescription')}
        headingLevel={2}
        icon={<CircleAlert aria-hidden="true" />}
        kind="error"
        title={t('loadError')}
      />
    );
  }

  const { context, itinerary } = state.data;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }).format(
    new Date(`${context.selectedDate}T00:00:00.000Z`),
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
    const query = new URLSearchParams({ create: '1', date: context.selectedDate });
    if (itineraryItemId) query.set('itineraryItemId', itineraryItemId);
    return `/trips/${tripId}/expenses?${query.toString()}`;
  };

  const setLocalStatus = (itemId: string, travelStatus: ItineraryTravelStatus) => {
    setState((current) => {
      if (current.status !== 'ready') return current;
      return {
        ...current,
        data: {
          ...current.data,
          itinerary: {
            ...current.data.itinerary,
            days: current.data.itinerary.days.map((candidate) => ({
              ...candidate,
              items: candidate.items.map((item) =>
                item.id === itemId ? { ...item, travelStatus } : item,
              ),
            })),
          },
        },
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
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {day.name ? (
            <h2 className="text-base font-semibold tracking-tight sm:text-lg">{day.name}</h2>
          ) : (
            <h2 className="sr-only">{t('title')}</h2>
          )}
          <p className="text-[length:var(--text-metadata)] leading-5 font-medium text-muted-foreground tabular-nums">
            {day.name ? itineraryT('dayOption', { date, number: context.day?.number ?? 1 }) : date}
          </p>
          <p className="mt-0.5 text-[length:var(--text-metadata)] leading-5 text-text-subtle">
            {t('timeZone', { timeZone: day.defaultTimeZone })}
          </p>
        </div>
        {/* Adding to the day is the one action worth a control of its own here;
            the rest of what a day collects lives under the row it belongs to. */}
        <Button onClick={() => setAddOpen(true)} size="sm">
          <Plus aria-hidden="true" data-icon="inline-start" />
          {t('addItem')}
        </Button>
      </header>

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
                      variant={base.located ? 'base' : 'base-unlocated'}
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
            const isCurrent = context.currentOrRelevant?.itemId === item.id;
            const busy = mutatingItemId === item.id;
            const upcoming = item.travelStatus === 'upcoming';
            const completed = item.travelStatus === 'completed';
            const upcomingIndex = upcomingItems.findIndex((candidate) => candidate.id === item.id);
            const linkedReservations = reservationsByItem.get(item.id) ?? [];
            const linkedTasks = openTasksByItem.get(item.id) ?? [];
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
                    {linkedReservations.length || linkedTasks.length ? (
                      <span className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                        {linkedReservations.length ? (
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
                        ) : null}
                        {linkedTasks.length ? (
                          <Link
                            className="relative z-10 inline-flex min-h-8 items-center gap-1.5 rounded-[var(--radius-sm)] outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
                            href={`/trips/${tripId}/tasks`}
                          >
                            <CheckCircle2
                              aria-hidden="true"
                              className="size-3.5 shrink-0 text-brand"
                            />
                            {t('linkedTasks', { count: linkedTasks.length })}
                          </Link>
                        ) : null}
                      </span>
                    ) : null}
                  </>
                }
                id={`trip-mode-item-${item.id}`}
                key={item.id}
                marker={
                  <TimelineMarker
                    label={t('stopNumber', { number: entry.stopNumber })}
                    variant={item.tripPlace?.place.location ? 'stop' : 'stop-unlocated'}
                  >
                    {entry.stopNumber}
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
            <Button onClick={() => setAddOpen(true)}>
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
        defaultItemId={context.currentOrRelevant?.itemId ?? null}
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

      <TripModeAddItemDialog
        dayId={day.id}
        onAdded={async () => {
          await refresh();
          setUndoAction(null);
          setFeedback(t('feedback.added'));
        }}
        onOpenChange={setAddOpen}
        open={addOpen}
        tripId={tripId}
        tripPlaces={itinerary.tripPlaces}
      />

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
