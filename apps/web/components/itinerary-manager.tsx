'use client';
import type { SchedulingOutcome } from '@trove/types';
import { TimingReviewNotice } from '@/components/planner/timing-review';
import { TIMING_REVIEW_EVENT } from '@/lib/itinerary/timing-review';
import {
  fetchItineraryDayTimeSuggestions,
  readItineraryTimingPending,
  readItineraryTimingReview,
} from '@/lib/itinerary/api';
import { DayPlanningContextSheet } from '@/components/day-planning-context';

import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Clock3, Plus } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { ItineraryGapSuggestions } from '@/components/itinerary-gap-suggestions';
import { ItineraryPlaceGroups } from '@/components/itinerary-place-groups';
import { ItineraryBetterOrder } from '@/components/itinerary-better-order';
import { ItineraryDayTimeSuggestions } from '@/components/itinerary-day-time-suggestions';
import { PageState } from '@/components/page-state';
import { ItineraryPlanningMap } from '@/components/itinerary-planning-map';
import { ItineraryTripMap } from '@/components/itinerary-trip-map';
import { useRegisterTripPlacesDay, useTripPlacesDrawer } from '@/components/trip-places-provider';
import type { TripPlacesDayContext } from '@/components/trip-places-drawer';
import { LocatePlaceSheet } from '@/components/locate-place-sheet';
import { PlaceDetailsSheet, type PlaceDetailsRow } from '@/components/place-details-sheet';
import { PlanScoreChip, PlanScorePanel } from '@/components/plan-score-panel';
import { ScoreProblemNote, AttentionNote } from '@/components/planner/attention-note';
import { DayMasthead, type DayStay } from '@/components/planner/day-masthead';
import { DAY_SKETCH_BOX, DayRouteSketch } from '@/components/planner/day-route-sketch';
import { DayEmpty } from '@/components/planner/day-empty';
import { DayMenu } from '@/components/planner/day-menu';
import { DayTimeline } from '@/components/planner/day-timeline';
import { PlanScoreSheet } from '@/components/planner/plan-score-sheet';
import { PlannerDayView } from '@/components/planner/planner-day-view';
import { PlannerMapPane } from '@/components/planner/planner-map-pane';
import { MoveToDaySheet } from '@/components/planner/move-to-day-sheet';
import { TripBoard, type TripBoardDisplay } from '@/components/planner/overview/trip-board';
import { PlannerRibbon } from '@/components/planner/planner-ribbon';
import { StaySheet } from '@/components/planner/stay-sheet';
import { TimingSheet } from '@/components/planner/timing-sheet';
import {
  StopEditorSheet,
  type StopEditorRequest,
} from '@/components/planner/stop-editor/stop-editor-sheet';
import { UnscheduledTray } from '@/components/planner/unscheduled-tray';
import { TripInsights } from '@/components/trip-insights';
import { useRegisterPrimaryAction } from '@/components/primary-action-provider';
import { usePreferences } from '@/components/preferences-provider';
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  createItineraryItem,
  deleteItineraryItem,
  duplicateItineraryItem,
  fetchItinerary,
  fetchItineraryDayRoutes,
  fetchPlaceHoursNotices,
  type Itinerary,
  ItineraryApiError,
  type ItineraryDay,
  type ItineraryItem,
  type ItineraryRouteSegment,
  type ItineraryTripPlace,
  localDateInTimeZone,
  type RouteTravelMode,
  organizeItineraryItem,
  moveItineraryDayPlan,
  setItineraryDayBase,
  updateItineraryDayNote,
  updateItineraryDayName,
  updateItineraryDayPlanningContext,
  updateItineraryDayRouteMode,
  updateItineraryItemRouteMode,
} from '@/lib/itinerary/api';
import { useOnlineStatus } from '@/components/trip-sync-status';
import { useTripContext } from '@/components/trip-provider';
import { useCompactItinerary } from '@/hooks/use-compact-itinerary';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import { useDayHeaderPhotos } from '@/hooks/use-day-header-photos';
import { useVisibleKeys } from '@/hooks/use-visible-keys';
import { plannerStopPhoto, plannerStopPhotoSubjects } from '@/lib/itinerary/stop-photos';
import { withDayPartBands } from '@/lib/itinerary/day-bands';
import { dayFacts, dayHeading } from '@/lib/itinerary/day-facts';
import { localityFromAddress, sameTown } from '@/lib/itinerary/day-place';
import { buildDaySequence, dayStopNumbers, resolveDailyBases } from '@/lib/itinerary/day-sequence';
import { daySketchPlaces } from '@/lib/itinerary/day-sketch';
import { plannerDays } from '@/lib/itinerary/planner-days';
import { stayChapters } from '@/lib/itinerary/stay-chapters';
import {
  DuplicateAttemptTracker,
  refreshedItineraryContainsCopy,
} from '@/lib/itinerary/duplicate-attempt';
import {
  itineraryTripPlaceFromTripPlace,
  placeVisitDate,
  scheduledPlaceUse,
} from '@/lib/itinerary/places';
import { optimisticItineraryEdit } from '@/lib/itinerary/optimistic';
import { itineraryDayRouteRevision } from '@/lib/itinerary/routes';
import { itineraryViewHref, resolveItineraryView } from '@/lib/itinerary/view';
import {
  buildItineraryMapPoints,
  dailyBasePoints,
  type ItineraryMapPoint,
} from '@/lib/maps/itinerary-map';
import { useTripPlaceHours } from '@/lib/trip-places/use-trip-place-hours';
import { untimedItems } from '@/lib/itinerary/day-time-suggestions';
import { overviewMapLifecycle, planningMapLifecycle } from '@/lib/maps/map-retention';
import { routeSketch } from '@/lib/maps/route-sketch';
import { editorialSubjectKey, type EditorialSubject } from '@/lib/media/editorial-images';
import { problemsByStop } from '@/lib/plan-score/attention';
import { serverNow } from '@/lib/plan-score/clock';
import { currentAssessment } from '@/lib/plan-score/presentation';
import { useInViewOnce } from '@/lib/plan-score/use-in-view-once';
import { useTripPlanScore } from '@/lib/plan-score/use-trip-plan-score';
import { googleMapsPlaceHref } from '@/lib/saved/api';
import { type TripPlace, type TripPlacePriority } from '@/lib/trip-places/api';
import { setTripPlacePriority } from '@/lib/trip-places/priority';
import { sortTripPlaces } from '@/lib/trip-places/sort';
import { destinationLocationBias } from '@/lib/saved/provider-search-session';
import { dayPreviewHref } from '@/lib/trips/navigation';
import { tripWeatherForDate, useTripWeather } from '@/lib/weather/use-trip-weather';
import { queryKeys } from '@/lib/query/keys';
import {
  ITINERARY_EDIT_QUERY_ROOTS,
  invalidateTripQueries,
  PLACE_LOCATION_QUERY_ROOTS,
} from '@/lib/query/trip-invalidation';
import * as Icons from '@/lib/icons';

function useDesktopMapLayout() {
  const [matches, setMatches] = useState<boolean | null>(null);

  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const update = () => setMatches(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return matches;
}

/**
 * The whole trip's score and what is worth knowing about it, on the Overview.
 * The score is the planner's own - asked for when the planner opened - so this
 * shows it and asks for nothing; Insights waits until it is scrolled to.
 */
function TripScoreAndInsights({
  planScore,
  planScoreEnabled,
  resolveAction,
  tripId,
}: Readonly<{
  planScore: ReturnType<typeof useTripPlanScore>;
  planScoreEnabled: boolean;
  resolveAction: (
    explanation: import('@trove/types').PlanScoreExplanation,
  ) => import('@/lib/plan-score/presentation').ScoreAction | null;
  tripId: string;
}>) {
  const planScoreTranslations = useTranslations('planScore');
  const { openPlaces } = useTripPlacesDrawer();
  const { hasBeenVisible, ref } = useInViewOnce<HTMLDivElement>();
  const planScoreHidden =
    !planScoreEnabled ||
    planScore.status === 'disabled' ||
    Boolean(planScore.data?.withheldReasons.includes('ADMINISTRATIVELY_DISABLED'));

  // One element, so a surrounding `gap` spaces the sentinel and the cards as a
  // single block. How good the plan is comes first; what to know follows.
  return (
    <div className="space-y-4">
      <div aria-hidden="true" className="h-px" ref={ref} />
      {!planScoreHidden ? (
        <PlanScorePanel
          onOpenTripPlaces={openPlaces}
          completeness={planScore.data?.completeness ?? null}
          confidence={planScore.data?.confidence ?? null}
          explanations={
            planScore.data?.explanations ?? { uncertainty: [], whatWorks: [], worthImproving: [] }
          }
          assessment={planScore.data}
          change={planScore.changeFor('trip')}
          onRetry={planScore.retry}
          resolveAction={resolveAction}
          score={planScore.data?.score ?? null}
          scope="trip"
          status={planScore.status}
          surface="card"
          title={planScoreTranslations('title')}
        />
      ) : null}
      <TripInsights
        enabled={hasBeenVisible}
        resolveAction={resolveAction}
        surface="card"
        tripId={tripId}
      />
    </div>
  );
}

export function ItineraryManager({
  planScoreEnabled,
  tripId,
}: Readonly<{ planScoreEnabled: boolean; tripId: string }>) {
  const t = useTranslations('itinerary');
  const tripPlacesTranslations = useTranslations('tripPlaces');
  const plannerT = useTranslations('itinerary.planner');
  const planScoreTranslations = useTranslations('planScore');
  const locale = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedDayId = searchParams.get('day');
  const requestedView = searchParams.get('view');
  const { preferences } = usePreferences();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const itineraryQuery = useQuery({
    queryFn: () => fetchItinerary(tripId),
    queryKey: queryKeys.itinerary(tripId),
  });
  const itinerary = itineraryQuery.data ?? null;
  // One answer for the whole trip. The day rail, the day header and the overview
  // each read a day out of it rather than asking per day - that fan-out is the
  // thing this endpoint exists to avoid.
  const { data: weather } = useTripWeather(tripId);
  const itineraryView = useMemo(
    () =>
      resolveItineraryView(
        requestedView,
        requestedDayId,
        itinerary?.days.map((day) => day.id) ?? [],
      ),
    [itinerary?.days, requestedDayId, requestedView],
  );
  const activeView = itineraryView.view;

  /**
   * Writes a server-confirmed itinerary change straight into the shared entry.
   *
   * Keeping the setState signature means the edits below did not have to move,
   * and because Trip Mode and the Memories screen read the same entry, a change
   * made here shows up there without any of them refetching.
   */
  const setItinerary = useCallback(
    (update: (current: Itinerary | null) => Itinerary | null) => {
      queryClient.setQueryData(
        queryKeys.itinerary(tripId),
        (current: Itinerary | undefined) =>
          (update(current ?? null) ?? undefined) as Itinerary | undefined,
      );
    },
    [queryClient, tripId],
  );
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const status = itineraryQuery.isPending ? 'loading' : itineraryQuery.error ? 'error' : 'idle';
  const [error, setError] = useState<string | null>(null);
  const prioritySaves = useRef(new Set<string>());
  const [savingPriorityIds, setSavingPriorityIds] = useState<ReadonlySet<string>>(() => new Set());
  // The stop editor: what it was opened for, whether it is showing, and an id
  // that changes with every opening, so each one starts from its own stop.
  const [stopEditor, setStopEditor] = useState<{
    id: number;
    open: boolean;
    request: StopEditorRequest | null;
  }>({ id: 0, open: false, request: null });
  const [itemToDelete, setItemToDelete] = useState<ItineraryItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [dayNoteEditor, setDayNoteEditor] = useState<ItineraryDay | null>(null);
  const [contextDay, setContextDay] = useState<ItineraryDay | null>(null);
  const [dayNameEditor, setDayNameEditor] = useState<ItineraryDay | null>(null);
  // Where the open day starts and ends, and the stop whose time is being changed.
  const [stayOpen, setStayOpen] = useState(false);
  const [timingItem, setTimingItem] = useState<ItineraryItem | null>(null);
  const [dayTimesOpen, setDayTimesOpen] = useState(false);
  const [betterOrderDay, setBetterOrderDay] = useState<ItineraryDay | null>(null);
  const { compact, setCompactItinerary } = useCompactItinerary();
  const [dayNoteValue, setDayNoteValue] = useState('');
  const [dayNameValue, setDayNameValue] = useState('');
  const [savingDayNote, setSavingDayNote] = useState(false);
  const [savingDayName, setSavingDayName] = useState(false);
  const [dayNameError, setDayNameError] = useState<string | null>(null);
  const [dayMoveSourceId, setDayMoveSourceId] = useState<string | null>(null);
  const [dayMoveTargetId, setDayMoveTargetId] = useState('');
  const [dayMoveStrategy, setDayMoveStrategy] = useState<'append' | 'swap'>('append');
  const [dayMoveError, setDayMoveError] = useState<string | null>(null);
  const [movingDay, setMovingDay] = useState(false);
  const [timeZoneConsequence, setTimeZoneConsequence] = useState(false);
  const [timingReview, setTimingReview] = useState<SchedulingOutcome | null>(null);
  const [timingPending, setTimingPending] = useState(false);
  useEffect(() => {
    let active = true;
    void readItineraryTimingReview(tripId).then((outcome) => {
      if (active) setTimingReview(outcome);
    });
    void readItineraryTimingPending(tripId).then((pending) => {
      if (active) setTimingPending(pending);
    });
    const receive = (event: Event) => {
      const detail = (
        event as CustomEvent<{ tripId: string; outcome?: SchedulingOutcome; pending?: boolean }>
      ).detail;
      if (detail.tripId === tripId) {
        if (detail.outcome) setTimingReview(detail.outcome);
        setTimingPending(Boolean(detail.pending));
      }
    };
    window.addEventListener(TIMING_REVIEW_EVENT, receive);
    return () => {
      active = false;
      window.removeEventListener(TIMING_REVIEW_EVENT, receive);
    };
  }, [tripId]);
  const [organizingItemId, setOrganizingItemId] = useState<string | null>(null);
  // A stop on its way to another day, or out of Unscheduled onto one.
  const [moveTarget, setMoveTarget] = useState<{
    allowUnscheduled: boolean;
    item: ItineraryItem;
  } | null>(null);
  const duplicateAttempts = useRef(new DuplicateAttemptTracker());
  // A phone shows the day's map in place of the day only once it is asked for.
  const [phoneMapOpen, setPhoneMapOpen] = useState(false);
  const [planningMapMounted, setPlanningMapMounted] = useState(false);
  const [selectedMapPointId, setSelectedMapPointId] = useState<string | null>(null);
  const [selectedMapItemId, setSelectedMapItemId] = useState<string | null>(null);
  const [savingRouteOwner, setSavingRouteOwner] = useState<string | null>(null);
  const { openPlaces } = useTripPlacesDrawer();
  const desktopMapLayout = useDesktopMapLayout();
  // A map that has been built is kept, hidden, while Overview is showing, so
  // coming back to the day does not build (and pay for) another one.
  const {
    mount: shouldMountPlanningMap,
    renderDayView,
    visible: planningMapVisible,
  } = planningMapLifecycle({
    activeView,
    desktopMapLayout,
    mobileView: phoneMapOpen ? 'map' : 'list',
    mounted: planningMapMounted,
  });

  // Desktop opens the map immediately. Remember that construction so resizing
  // to the mobile list does not discard a map the user has already paid to load.
  useEffect(() => {
    if (activeView === 'day' && desktopMapLayout === true) setPlanningMapMounted(true);
  }, [activeView, desktopMapLayout]);

  // The whole trip's map waits to be asked for at every width, and is kept,
  // hidden, once it has been - behind the list and behind the Day view alike.
  const [overviewDisplay, setOverviewDisplay] = useState<TripBoardDisplay>('list');
  const [tripMapMounted, setTripMapMounted] = useState(false);
  const {
    mount: shouldMountTripMap,
    renderOverview,
    visible: tripMapVisible,
  } = overviewMapLifecycle({
    activeView,
    display: overviewDisplay,
    mounted: tripMapMounted,
  });
  // A stop opened from the trip's map, waiting for its day to be on screen.
  const [pendingDayItemId, setPendingDayItemId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    await invalidateTripQueries(queryClient, tripId, ITINERARY_EDIT_QUERY_ROOTS);
  }, [queryClient, tripId]);

  /**
   * The URL records which day you are planning; it does not decide it.
   *
   * Which day you are on is still part of where you are, so a reload, a shared
   * link and the back button all land on it. But `router.replace` treats that
   * query string as a destination: the App Router fetches the route again and
   * `useSearchParams` only moves once it lands. A fast run down the day rail
   * therefore had two answers in flight at once - the click, and a URL still
   * catching up - and the late one won, which is why the day kept changing
   * after the traveller stopped clicking. Next patches the history API into the
   * same router state, so this writes the address bar without asking the server
   * what it means.
   *
   * `mirroredDayId` is how the effect below tells our own write from a real
   * navigation. Only the latter may move the selection.
   */
  const mirroredDayId = useRef<string | null>(null);
  const writeDayToUrl = useCallback(
    (dayId: string | null, entry: 'push' | 'replace') => {
      mirroredDayId.current = dayId;
      const href = itineraryViewHref(pathname, searchParams.toString(), dayId);
      if (entry === 'push') window.history.pushState(null, '', href);
      else window.history.replaceState(null, '', href);
    },
    [pathname, searchParams],
  );

  // The selected day follows the itinerary rather than the fetch, so a day that
  // survives an edit stays selected and a day that does not falls back to the
  // first one. It follows the URL too - but only when the URL moved on its own.
  useEffect(() => {
    if (!itinerary) return;
    const navigated = requestedDayId !== mirroredDayId.current;
    setSelectedDayId((current) => {
      const preferred =
        navigated && itineraryView.view === 'day' ? itineraryView.selectedDayId : current;
      return preferred && itinerary.days.some((day) => day.id === preferred)
        ? preferred
        : (itinerary.days[0]?.id ?? null);
    });
  }, [itinerary, itineraryView, requestedDayId]);

  // A stale shared link is not a different view. Clean it back to the day the
  // itinerary actually opened on instead of leaving a day that is not there.
  useEffect(() => {
    if (!itinerary || !itineraryView.invalidRequestedDay) return;
    writeDayToUrl(itineraryView.selectedDayId, 'replace');
  }, [itinerary, itineraryView.invalidRequestedDay, itineraryView.selectedDayId, writeDayToUrl]);

  // Stepping between days is not a place you go back to; opening one is, and
  // that is the one that pushes.
  useEffect(() => {
    if (activeView !== 'day' || !selectedDayId || requestedDayId === selectedDayId) return;
    writeDayToUrl(selectedDayId, 'replace');
  }, [activeView, requestedDayId, selectedDayId, writeDayToUrl]);

  const selectedDay = useMemo(
    () => itinerary?.days.find((day) => day.id === selectedDayId) ?? null,
    [itinerary, selectedDayId],
  );
  const timingAssessment = useQuery({
    queryKey: [
      'itinerary-timing',
      tripId,
      selectedDay?.id,
      JSON.stringify([
        selectedDay?.planningContext,
        selectedDay?.items.map((item) => [item.id, item.updatedAt, item.position]),
      ]),
    ],
    enabled: online && Boolean(selectedDay),
    queryFn: () => fetchItineraryDayTimeSuggestions(tripId, selectedDay!.id),
  });

  // What Trove has stored about each place on the selected day: whether it is
  // open that day, and how it is rated. Stored evidence only.
  const dayPlaceSignals = useTripPlaceHours(
    tripId,
    selectedDay?.date ?? null,
    activeView === 'day' && selectedDay !== null,
  );

  // Planning a day, the nearest thing to make is a stop on it, so the bottom
  // bar's create button makes that instead of another trip. The day it adds to
  // is the one the URL is already showing, which is why switching days needs no
  // bookkeeping here. The whole-trip overview names no day and so claims
  // nothing: the button keeps its global meaning there rather than guessing.
  useRegisterPrimaryAction({
    enabled: activeView === 'day' && selectedDay !== null,
    label: t('addItem'),
    onTrigger: () => {
      if (selectedDay) openCreate(selectedDay);
    },
  });

  const dayMoveSource = useMemo(
    () => itinerary?.days.find((day) => day.id === dayMoveSourceId) ?? null,
    [dayMoveSourceId, itinerary],
  );
  const dayMoveTarget = useMemo(
    () => itinerary?.days.find((day) => day.id === dayMoveTargetId) ?? null,
    [dayMoveTargetId, itinerary],
  );
  /**
   * What the dialog will actually do, which is not always what it was opened
   * for: a day with nothing on it has nothing to trade back, so swapping onto
   * one is a move, and saying otherwise would promise something that does not
   * happen. `handleDayMove` sends the same answer.
   *
   * Until a day has been chosen there is nothing to correct, so the dialog goes
   * on saying what it was opened to do.
   */
  const effectiveDayMoveStrategy =
    dayMoveTarget && !dayMoveTarget.items.length ? 'append' : dayMoveStrategy;
  const routeRevision = itineraryDayRouteRevision(selectedDay);
  const includeRoutePolylines = planningMapVisible;
  /**
   * A day's legs, keyed by the ordering they were computed for.
   *
   * The revision is in the key because a leg chain is a chain between adjacent
   * stops: replaying an older one would confidently name origins that no longer
   * come before their destination. Reordering a day therefore asks a new
   * question rather than invalidating an answer.
   *
   * Polylines are a second dimension of the same question, and a set fetched
   * with them answers a request without them too - so if the map has already
   * paid for this day, the list reuses that instead of buying it again.
   *
   * Asked as a query rather than read off the client, because this answer is
   * part of the key below. `getQueryData` during render subscribes to nothing,
   * so it used to flip on whatever unrelated re-render happened next - changing
   * the key mid-flight, abandoning the request already paid for and buying the
   * same day twice, which the map then redrew twice. `skipToken` is how v5
   * spells a query that never fetches and only watches the entry the map
   * fills in - `enabled: false` says the same thing, but leaves the query
   * without a function, which logs an error per render.
   */
  const polylineRoutesQuery = useQuery({
    queryFn: skipToken,
    queryKey: queryKeys.itineraryDayRoutes(
      tripId,
      selectedDay?.id ?? '',
      routeRevision,
      true,
      locale,
    ),
  });
  const requestRoutePolylines = includeRoutePolylines || polylineRoutesQuery.data !== undefined;

  const routesQuery = useQuery({
    enabled: activeView === 'day' && selectedDay !== null && desktopMapLayout !== null,
    queryFn: ({ signal }) =>
      fetchItineraryDayRoutes(tripId, selectedDay?.id as string, {
        includePolyline: requestRoutePolylines,
        languageCode: locale,
        revision: routeRevision,
        signal,
      }),
    queryKey: queryKeys.itineraryDayRoutes(
      tripId,
      selectedDay?.id ?? '',
      routeRevision,
      requestRoutePolylines,
      locale,
    ),
  });

  const routes = routesQuery.data ?? null;
  const routeStatus: 'error' | 'idle' | 'loading' =
    activeView !== 'day' || !selectedDay || desktopMapLayout === null
      ? 'idle'
      : routesQuery.isPending
        ? 'loading'
        : routesQuery.error
          ? 'error'
          : 'idle';
  const routeLines = useMemo(
    () =>
      routes?.segments.flatMap((segment) =>
        segment.encodedPolyline
          ? [{ encodedPolyline: segment.encodedPolyline, mode: segment.mode }]
          : [],
      ) ?? [],
    [routes],
  );

  const selectedIndex = itinerary?.days.findIndex((day) => day.id === selectedDayId) ?? -1;
  // Shown in the Places drawer so nothing gets added to a day twice unnoticed.
  const placeUse = useMemo(() => (itinerary ? scheduledPlaceUse(itinerary) : {}), [itinerary]);
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
        weekday: 'short',
      }),
    [locale],
  );
  const longDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
        weekday: 'long',
        year: 'numeric',
      }),
    [locale],
  );
  const formatDate = (date: string, long = false) =>
    (long ? longDateFormatter : dateFormatter).format(new Date(`${date}T00:00:00.000Z`));

  const dayOption = (day: ItineraryDay, index: number) =>
    day.name
      ? t('dayOptionNamed', { date: formatDate(day.date), name: day.name, number: index + 1 })
      : t('dayOption', { date: formatDate(day.date), number: index + 1 });

  function placeName(tripPlace: ItineraryTripPlace | null) {
    if (!tripPlace) return null;
    // Every name is already here: the traveller's own, or the one Trove stored
    // when the Place was added. Nothing is pending, so nothing shows as loading.
    const custom = tripPlace.customName?.trim();
    if (custom) return custom;
    if (tripPlace.place.kind === 'custom') return tripPlace.place.name ?? t('customPlace');
    return tripPlace.place.snapshot?.name ?? tripPlace.place.providerLabel ?? t('providerPlace');
  }

  function itemName(item: ItineraryItem) {
    return item.customLabel ?? placeName(item.tripPlace) ?? t('untitledItem');
  }

  function placeLocation(tripPlace: ItineraryTripPlace) {
    // A provider Place's coordinates now arrive with it, so a pin is drawn on the
    // first render rather than appearing once a lookup returns.
    return tripPlace.place.location ?? null;
  }

  /**
   * The place whose details are open, and the one photograph that goes with it.
   *
   * Opening details shares canonical Place keys with the visible stop previews.
   * The resolver shares cached and in-flight work between both requests.
   */
  const [detailsPlace, setDetailsPlace] = useState<ItineraryTripPlace | null>(null);
  const [detailsVisitDate, setDetailsVisitDate] = useState<string | null>();
  function openPlaceDetails(tripPlace: ItineraryTripPlace | null, visitDate?: string | null) {
    setDetailsPlace(tripPlace);
    setDetailsVisitDate(visitDate);
  }
  const [locatePlace, setLocatePlace] = useState<ItineraryTripPlace | null>(null);

  /** A Custom Place can be found on Google, even one already given coordinates by hand. */
  const canLocate = (tripPlace: ItineraryTripPlace) => tripPlace.place.kind === 'custom';
  const detailsProviderName =
    detailsPlace && detailsPlace.place.kind === 'provider'
      ? (detailsPlace.place.snapshot?.name ?? detailsPlace.place.providerLabel)
      : null;
  const detailsSubjects: EditorialSubject[] =
    detailsPlace && detailsProviderName
      ? [
          {
            category: detailsPlace.place.snapshot?.category,
            name: detailsProviderName,
            placeId: detailsPlace.place.id,
          },
        ]
      : [];
  const detailsImages = useEditorialImages(detailsSubjects);
  const detailsEditorialImages = detailsSubjects[0]
    ? (detailsImages.get(editorialSubjectKey(detailsSubjects[0])) ?? [])
    : [];

  /** What the shared sheet cannot know: this place's standing on this trip. */
  function detailsMeta(tripPlace: ItineraryTripPlace): PlaceDetailsRow[] {
    return [
      tripPlace.priority
        ? { label: t('priorityLabel'), value: t(`priority.${tripPlace.priority}`) }
        : null,
      tripPlace.note ? { label: t('notes'), value: tripPlace.note } : null,
    ].filter((row): row is PlaceDetailsRow => row !== null);
  }

  // One reading of where the day starts and ends, and one counting of its stops,
  // shared by the list and the map so a row and a circle can never disagree.
  const dailyBases = useMemo(
    () => resolveDailyBases({ day: selectedDay, routeSegments: routes?.segments }),
    [routes, selectedDay],
  );
  const stopNumbers = useMemo(
    () => dayStopNumbers({ bases: dailyBases, itemCount: selectedDay?.items.length ?? 0 }),
    [dailyBases, selectedDay],
  );
  // The day in the order it is travelled, decided once rather than assembled
  // out of two loops at render time.
  const daySequence = useMemo(
    () =>
      buildDaySequence({
        bases: dailyBases,
        items: selectedDay?.items ?? [],
        routeSegments: routes?.segments,
      }),
    [dailyBases, routes, selectedDay],
  );
  // Compact hides the legs from the list, not from the day: the sequence itself
  // is still the full one, so the map keeps drawing the same route and stops
  // keep the numbers the map labels them with.
  const shownSequence = useMemo(
    () => (compact ? daySequence.filter((entry) => entry.kind !== 'leg') : daySequence),
    [compact, daySequence],
  );
  const tripPlaceById = (tripPlaceId: string | null) =>
    tripPlaceId
      ? (itinerary?.tripPlaces.find((tripPlace) => tripPlace.id === tripPlaceId) ?? null)
      : null;
  const alphabeticalTripPlaces = useMemo(
    () =>
      sortTripPlaces(
        itinerary?.tripPlaces ?? [],
        'name',
        (tripPlace) => placeName(tripPlace) ?? t('providerPlace'),
      ),
    [itinerary?.tripPlaces, t],
  );

  /**
   * The trip's one assessment, asked for as soon as the planner opens (PRD
   * 29.5) rather than when its card scrolls into view: the ribbon marks the days
   * with a problem worth a look, and each stop carries its own. It reads stored
   * evidence only. A number that is not current is not shown, here as anywhere.
   */
  const planScore = useTripPlanScore(planScoreEnabled ? tripId : null);
  const currentScore =
    planScore.data &&
    !['disabled', 'loading', 'offline', 'syncing'].includes(planScore.status) &&
    currentAssessment(planScore.data, serverNow())
      ? planScore.data
      : null;
  const [scoreSheetOpen, setScoreSheetOpen] = useState(false);

  // Read in the trip's own zone, so "today" is the traveller's today on the trip.
  const today = itinerary ? localDateInTimeZone(itinerary.trip.referenceTimeZone) : null;
  const ribbonDays = useMemo(
    () =>
      itinerary
        ? plannerDays({
            days: itinerary.days,
            planScoreDays: currentScore?.days,
            today,
            tripPlaces: itinerary.tripPlaces,
          })
        : [],
    [currentScore, itinerary, today],
  );
  const selectedRibbonDay = ribbonDays.find((day) => day.id === selectedDayId) ?? null;
  // The whole trip by where each night is spent, for the Overview.
  const chapters = useMemo(
    () => (itinerary ? stayChapters({ days: itinerary.days, plannerDays: ribbonDays }) : []),
    [itinerary, ribbonDays],
  );

  const { observe: observeStop, visibleKeys: visibleStopIds } = useVisibleKeys();
  const stopSubjects = plannerStopPhotoSubjects(selectedDay?.items ?? [], visibleStopIds);
  const stopImages = useEditorialImages(stopSubjects, { progressive: true });
  const dayPhotos = useDayHeaderPhotos(selectedDay ?? null, itinerary?.tripPlaces ?? []);

  // Special hours and holiday checks for the trip's stops, from stored evidence
  // only - the same entry the Insights card reads, so it is one request.
  const { data: hoursNotices } = useQuery({
    enabled: activeView === 'day',
    queryFn: ({ signal }) => fetchPlaceHoursNotices(tripId, { signal }),
    queryKey: queryKeys.hoursNotices(tripId),
    retry: false,
  });

  const scoreDay = planScore.data?.days.find((day) => day.dayId === selectedDayId) ?? null;
  const dayProblems = useMemo(
    () =>
      problemsByStop(
        currentScore?.days.find((day) => day.dayId === selectedDayId)?.explanations,
        selectedDay?.items.map((item) => item.id) ?? [],
      ),
    [currentScore, selectedDay, selectedDayId],
  );
  const bandedSequence = useMemo(() => withDayPartBands(shownSequence), [shownSequence]);
  const sketchPlaces = useMemo(
    () => (itinerary ? daySketchPlaces(daySequence, itinerary.tripPlaces) : []),
    [daySequence, itinerary],
  );
  const daySketch = useMemo(
    () => routeSketch(sketchPlaces, DAY_SKETCH_BOX, { minDistinct: 2 }),
    [sketchPlaces],
  );
  const { hasBeenVisible: insightsVisible, ref: insightsSentinelRef } =
    useInViewOnce<HTMLDivElement>();

  const mapPoints = useMemo(() => {
    if (activeView !== 'day' || !itinerary || !selectedDay) return [];
    const points = buildItineraryMapPoints({
      itinerary,
      orderOffset: stopNumbers.itemOffset,
      placeUse,
      resolveItemName: itemName,
      resolvePlaceLocation: placeLocation,
      resolvePlaceName: (tripPlace) => placeName(tripPlace) ?? t('providerPlace'),
      selectedDay,
      selectedDayNumber: selectedIndex + 1,
    });
    const bases = dailyBasePoints({
      bases: dailyBases,
      numbers: stopNumbers,
      resolvePlaceLocation: placeLocation,
      resolvePlaceName: (tripPlace) => placeName(tripPlace) ?? t('providerPlace'),
      scheduledTripPlaceIds: new Set(
        points.filter((point) => point.kind === 'scheduled').map((point) => point.tripPlaceId),
      ),
      tripPlaces: itinerary.tripPlaces,
    });
    // The base is the same pin either way, and being the day's base is the more
    // useful thing to say about it than being one of the trip's other Places.
    const basePlaceIds = new Set(bases.map((base) => base.tripPlaceId));
    return [
      ...points.filter(
        (point) => point.kind !== 'considered' || !basePlaceIds.has(point.tripPlaceId),
      ),
      ...bases,
    ];
  }, [activeView, dailyBases, itinerary, placeUse, selectedDay, selectedIndex, stopNumbers, t]);

  // Where the day already goes (its stops and base), for "nearest to this day".
  const dayAnchors = useMemo(
    () => mapPoints.filter((point) => point.kind !== 'considered'),
    [mapPoints],
  );
  // Where the day already is - its Stay or a stop on it, else the trip's own
  // destination - so a Google search from the stop editor prefers what is near.
  const tripContext = useTripContext();
  const tripDestinations = tripContext?.trip?.destinations;
  const tripLifecycle = tripContext?.trip?.lifecycle;
  const editorLocationBias = useMemo(
    () =>
      destinationLocationBias([
        ...dayAnchors.map((point) => ({
          location: { latitude: point.latitude, longitude: point.longitude },
        })),
        ...(tripDestinations ?? []),
      ]),
    [dayAnchors, tripDestinations],
  );

  /**
   * Shows the day's map on a phone. It is built on the first opening and kept,
   * hidden, after that, whichever way it was opened - the sketch, a stop's
   * number, or a Stay's - so going back and forth never builds a second one.
   */
  function openPhoneMap() {
    setPlanningMapMounted(true);
    setPhoneMapOpen(true);
  }

  // Leaving the map by its own way back returns focus to the control that
  // opened it; leaving it for a stop ("View item") puts focus on the stop.
  const restoreMapTrigger = useRef(false);
  const closePhoneMap = useCallback(() => {
    restoreMapTrigger.current = true;
    setPhoneMapOpen(false);
  }, []);
  useEffect(() => {
    if (phoneMapOpen || !restoreMapTrigger.current) return;
    restoreMapTrigger.current = false;
    document.querySelector<HTMLElement>('[data-planner-open-map]')?.focus();
  }, [phoneMapOpen]);

  /**
   * A base is a stop of the day, so it reads like one: numbered in travel order,
   * named, opening its place when clicked, and findable on the map from its own
   * menu. What that menu does not carry is a way to change it — where a day
   * starts and ends is set in day settings, not by editing a stop.
   */
  function selectBaseOnMap(tripPlaceId: string) {
    const point = mapPoints.find(
      (candidate) => candidate.kind === 'base' && candidate.tripPlaceId === tripPlaceId,
    );
    if (!point) return;
    setSelectedMapPointId(point.id);
    setSelectedMapItemId(null);
    if (!desktopMapLayout) openPhoneMap();
  }

  useEffect(() => {
    if (selectedMapPointId && !mapPoints.some((point) => point.id === selectedMapPointId)) {
      setSelectedMapPointId(null);
      setSelectedMapItemId(null);
    }
  }, [mapPoints, selectedMapPointId]);

  useEffect(() => {
    setSelectedMapPointId(null);
    setSelectedMapItemId(null);
  }, [selectedDayId]);

  // Lands on the stop opened from the trip's map, picked out on its day's list
  // and its day's map. Declared after the effect above, which clears the
  // selection whenever the day changes and would otherwise undo this.
  useEffect(() => {
    if (!pendingDayItemId || activeView !== 'day' || !selectedDay) return;
    const item = selectedDay.items.find((candidate) => candidate.id === pendingDayItemId);
    setPendingDayItemId(null);
    // Removed in the meantime: the day is still the right place to land.
    if (!item) return;
    setSelectedMapItemId(item.id);
    setSelectedMapPointId(
      item.tripPlace && placeLocation(item.tripPlace) ? item.tripPlace.id : null,
    );
    scrollToItem(item.id, true);
    // `placeLocation` and `scrollToItem` read nothing that changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, pendingDayItemId, selectedDay]);

  const clearMapSelection = useCallback(() => {
    setSelectedMapPointId(null);
    setSelectedMapItemId(null);
  }, []);

  function scrollToItem(itemId: string, focus = false) {
    window.requestAnimationFrame(() => {
      const element = document.getElementById(`itinerary-item-${itemId}`);
      // An explicit behavior overrides the global reduced-motion rule, so the
      // preference has to be read here rather than left to the stylesheet.
      element?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'center',
      });
      if (focus) element?.focus({ preventScroll: true });
    });
  }

  function selectItemOnMap(item: ItineraryItem) {
    if (!item.tripPlace || !placeLocation(item.tripPlace)) return;
    setSelectedMapPointId(item.tripPlace.id);
    setSelectedMapItemId(item.id);
    if (!desktopMapLayout) openPhoneMap();
  }

  function handleMapPointSelection(point: ItineraryMapPoint) {
    setSelectedMapPointId(point.id);
    setSelectedMapItemId(point.itemId);
    if (desktopMapLayout && point.itemId) scrollToItem(point.itemId);
  }

  function viewMapItem(itemId: string) {
    setSelectedMapItemId(itemId);
    if (!desktopMapLayout) setPhoneMapOpen(false);
    scrollToItem(itemId, true);
  }

  /** A new stop at the end of a day - already at a Trip Place when one was asked for. */
  function openCreate(day: ItineraryDay, options: { tripPlaceId?: string | null } = {}) {
    const number = (itinerary?.days.findIndex((candidate) => candidate.id === day.id) ?? -1) + 1;
    setStopEditor((current) => ({
      id: current.id + 1,
      open: true,
      request: {
        dayId: day.id,
        dayLabel: t('dayNumber', { number }),
        kind: 'create',
        tripPlaceId: options.tripPlaceId ?? null,
      },
    }));
  }

  /** A new stop between two others: `position` among the day's stops, after `afterName`. */
  function openInsert(day: ItineraryDay, position: number, afterName: string | null) {
    const number = (itinerary?.days.findIndex((candidate) => candidate.id === day.id) ?? -1) + 1;
    setStopEditor((current) => ({
      id: current.id + 1,
      open: true,
      request: {
        dayId: day.id,
        dayLabel: t('dayNumber', { number }),
        insert: { afterName, position },
        kind: 'create',
      },
    }));
  }

  function openEdit(item: ItineraryItem, focus?: 'place' | 'timing') {
    const dayId = item.itineraryDayId;
    if (!dayId) return;
    setStopEditor((current) => ({
      id: current.id + 1,
      open: true,
      request: { dayId, focus, item, kind: 'edit' },
    }));
  }

  function closeEditor() {
    setStopEditor((current) => ({ ...current, open: false }));
  }

  /** What a stop is missing that one tap can add: its Place, or a location for it. */
  function stopPartial(item: ItineraryItem) {
    // A plan meant to be somewhere can be given its Place; a free afternoon, a
    // transfer, a call or a workday is not missing one.
    if (!item.tripPlace) {
      return !item.blockType || item.blockType === 'activity'
        ? { label: plannerT('stop.linkPlace'), onAction: () => openEdit(item, 'place') }
        : null;
    }
    const tripPlace = item.tripPlace;
    return canLocate(tripPlace) && !placeLocation(tripPlace) && online
      ? { label: plannerT('stop.addLocation'), onAction: () => setLocatePlace(tripPlace) }
      : null;
  }

  function resolveScoreAction(
    explanation: import('@trove/types').PlanScoreExplanation,
  ): import('@/lib/plan-score/presentation').ScoreAction | null {
    if (!explanation.action || !itinerary) return null;
    for (const reference of explanation.references) {
      const item = [
        ...itinerary.days.flatMap((day) => day.items),
        ...itinerary.unscheduledItems,
      ].find((item) => item.id === reference);
      if (item) {
        const partial = explanation.action === 'LINK_PLACE' ? stopPartial(item) : null;
        return { onSelect: partial?.onAction ?? (() => openEdit(item)) };
      }
      const day = itinerary.days.find((day) => day.id === reference);
      // The order Plan Score compared against can be previewed and applied,
      // rather than leaving the traveller to find it by hand.
      if (day && explanation.action === 'REORDER_MANUALLY')
        return { onSelect: () => setBetterOrderDay(day) };
      if (day)
        return {
          onSelect: () => {
            openDay(day.id);
            requestAnimationFrame(() =>
              document.getElementById(`itinerary-day-${day.id}`)?.focus(),
            );
          },
        };
      const reservation = queryClient
        .getQueryData<import('@/lib/reservations/api').ReservationsResponse>(
          queryKeys.reservations(tripId),
        )
        ?.reservations.find((reservation) => reservation.id === reference);
      const target = queryClient.getQueryData<import('@trove/types').TripPlanScore>(
        queryKeys.planScore(tripId),
      )?.presentation?.referenceTargets?.[reference];
      if (reservation || target?.kind === 'reservation')
        return {
          href: `/trips/${tripId}/reservations?reservation=${encodeURIComponent(reference)}`,
        };
      const place = itinerary.tripPlaces.find((place) => place.id === reference);
      if (place && explanation.action === 'SCHEDULE_MUST_GO')
        return {
          onSelect: () => {
            const targetDay = selectedDay ?? itinerary.days[0];
            if (!targetDay) return;
            openCreate(targetDay, { tripPlaceId: place.id });
          },
        };
    }
    return null;
  }

  const handledScorePlace = useRef<string | null>(null);
  const scoreItemId = searchParams.get('item');
  const scorePlaceId = searchParams.get('place');
  useEffect(() => {
    if (!scorePlaceId) {
      handledScorePlace.current = null;
      return;
    }
    if (!itinerary || handledScorePlace.current === scorePlaceId) return;
    handledScorePlace.current = scorePlaceId;
    const place = itinerary.tripPlaces.find((place) => place.id === scorePlaceId);
    const day = itinerary.days.find((day) => day.id === requestedDayId) ?? itinerary.days[0];
    if (place && day) {
      openCreate(day, { tripPlaceId: place.id });
    }
    // Editor state owns the pending proposal after opening; reload must not reopen it.
    const params = new URLSearchParams(searchParams.toString());
    params.delete('place');
    window.history.replaceState(null, '', `${pathname}${params.size ? `?${params}` : ''}`);
  }, [scorePlaceId, itinerary]);

  const handledScoreItem = useRef<string | null>(null);
  useEffect(() => {
    if (!scoreItemId) {
      handledScoreItem.current = null;
      return;
    }
    if (!itinerary || handledScoreItem.current === scoreItemId) return;
    handledScoreItem.current = scoreItemId;
    const item = [
      ...itinerary.days.flatMap((day) => day.items),
      ...itinerary.unscheduledItems,
    ].find((item) => item.id === scoreItemId);
    if (item) openEdit(item);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('item');
    window.history.replaceState(null, '', `${pathname}${params.size ? `?${params}` : ''}`);
  }, [scoreItemId, itinerary]);

  async function handleDelete() {
    if (!itemToDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteItineraryItem(tripId, itemToDelete.id);
      setItemToDelete(null);
      closeEditor();
      await refresh();
    } catch {
      setDeleteError(t('deleteError'));
    } finally {
      setDeleting(false);
    }
  }

  async function handleOrganize(
    item: ItineraryItem,
    itineraryDayId: string | null,
    position: number,
  ) {
    setOrganizingItemId(item.id);
    setError(null);
    try {
      // Shown at once - dropped, moved earlier, sent to another day - through the
      // same replay the offline queue uses, and put back if the server says no.
      await optimisticItineraryEdit({
        commit: () =>
          organizeItineraryItem(tripId, item.id, {
            itineraryDayId,
            position,
            timingPolicy: 'reconcile_flexible',
          }),
        operation: {
          baseItem: item,
          input: { itineraryDayId, position, timingPolicy: 'reconcile_flexible' },
          itemId: item.id,
          kind: 'itinerary_item_organize',
        },
        queryClient,
        tripId,
      });
      if (!online) setTimingPending(true);
      await refresh();
    } catch {
      setError(t('organizeError'));
    } finally {
      setOrganizingItemId(null);
    }
  }

  async function handleDuplicate(item: ItineraryItem) {
    const clientItemId = duplicateAttempts.current.begin(item.id);
    if (!clientItemId) return;
    setOrganizingItemId(item.id);
    setError(null);
    let mutationConfirmed = false;
    try {
      const result = await duplicateItineraryItem(tripId, item.id, clientItemId);
      if (result.itemId !== clientItemId) throw new Error('unexpected_duplicate_item_id');
      mutationConfirmed = true;
      await refresh();
      const updated = queryClient.getQueryData<Itinerary>(queryKeys.itinerary(tripId));
      if (!refreshedItineraryContainsCopy(updated, clientItemId)) {
        throw new Error('duplicate_not_visible_after_refresh');
      }
      duplicateAttempts.current.complete(item.id);
    } catch (error) {
      if (
        !mutationConfirmed &&
        error instanceof ItineraryApiError &&
        error.status >= 400 &&
        error.status < 500
      ) {
        duplicateAttempts.current.complete(item.id);
        setError(t('organizeError'));
      } else {
        duplicateAttempts.current.failed(item.id);
        setError(t('duplicateUnconfirmed'));
      }
    } finally {
      setOrganizingItemId(null);
    }
  }

  /**
   * Adds a Place onto the open day and reconciles a supported flexible slot.
   * Reached from the Places drawer and
   * from a map marker for a Place that is not on this day yet.
   */
  const addTripPlaceToSelectedDay = useCallback(
    async (tripPlaceId: string) => {
      if (!selectedDay) return false;
      try {
        const result = await createItineraryItem(tripId, {
          itineraryDayId: selectedDay.id,
          timingPolicy: 'reconcile_flexible',
          schedule: { kind: 'none' },
          tripPlaceId,
        });
        if (!result.item.scheduling) setTimingPending(true);
        await refresh();
        return true;
      } catch {
        return false;
      }
    },
    [refresh, selectedDay, tripId],
  );

  const addPlaceToSelectedDay = useCallback(
    (tripPlace: TripPlace) => addTripPlaceToSelectedDay(tripPlace.id),
    [addTripPlaceToSelectedDay],
  );

  const placesDayContext = useMemo<TripPlacesDayContext | null>(
    () =>
      activeView === 'day' && selectedDay && status === 'idle'
        ? {
            anchors: dayAnchors,
            date: selectedDay.date,
            dayName: selectedDay.name,
            dayNumber: selectedIndex + 1,
            onAddToDay: addPlaceToSelectedDay,
            placeUse,
          }
        : null,
    [activeView, selectedDay, status, dayAnchors, selectedIndex, addPlaceToSelectedDay, placeUse],
  );
  useRegisterTripPlacesDay(placesDayContext);

  async function handleDailyBase(
    day: ItineraryDay,
    tripPlaceId: string | null,
    departureTripPlaceId?: string | null,
  ) {
    setError(null);
    try {
      await setItineraryDayBase(tripId, day.id, tripPlaceId, departureTripPlaceId);
      await refresh();
    } catch {
      setError(t('dailyBaseError'));
    }
  }

  async function handleRouteModeChange(segment: ItineraryRouteSegment, mode: RouteTravelMode) {
    if (mode === segment.mode) return;
    const ownerKey = `${segment.modeOwner.kind}:${segment.modeOwner.id}`;
    setSavingRouteOwner(ownerKey);
    setError(null);
    try {
      if (segment.modeOwner.kind === 'day_start') {
        await updateItineraryDayRouteMode(tripId, segment.modeOwner.id, mode);
      } else {
        await updateItineraryItemRouteMode(tripId, segment.modeOwner.id, mode);
      }
      await refresh();
    } catch {
      setError(t('routes.modeSaveError'));
    } finally {
      setSavingRouteOwner(null);
    }
  }

  async function handleDayNoteSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dayNoteEditor) return;

    setSavingDayNote(true);
    setError(null);
    try {
      const result = await updateItineraryDayNote(
        tripId,
        dayNoteEditor.id,
        dayNoteValue.trim() || null,
      );
      setItinerary((current) =>
        current
          ? {
              ...current,
              days: current.days.map((day) =>
                day.id === result.id ? { ...day, notes: result.notes } : day,
              ),
            }
          : current,
      );
      setDayNoteEditor(null);
    } catch {
      setError(t('dayNoteError'));
    } finally {
      setSavingDayNote(false);
    }
  }

  async function handleDayNameSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dayNameEditor) return;

    setSavingDayName(true);
    setDayNameError(null);
    try {
      const result = await updateItineraryDayName(
        tripId,
        dayNameEditor.id,
        dayNameValue.trim() || null,
      );
      setItinerary((current) =>
        current
          ? {
              ...current,
              days: current.days.map((day) =>
                day.id === result.id ? { ...day, name: result.name } : day,
              ),
            }
          : current,
      );
      setDayNameEditor(null);
    } catch {
      setDayNameError(t('dayNameError'));
    } finally {
      setSavingDayName(false);
    }
  }

  function openDayMove(day: ItineraryDay, strategy: 'append' | 'swap' = 'append') {
    setDayMoveSourceId(day.id);
    setDayMoveTargetId('');
    setDayMoveStrategy(strategy);
    setDayMoveError(null);
  }

  async function handleDayMove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dayMoveSource || !dayMoveTarget) return;
    setMovingDay(true);
    setDayMoveError(null);
    const targetId = dayMoveTarget.id;
    try {
      await moveItineraryDayPlan(tripId, dayMoveSource.id, {
        expectedSourceBase: {
          dailyBaseDepartureTripPlaceId: dayMoveSource.dailyBaseDepartureTripPlaceId,
          dailyBaseTripPlaceId: dayMoveSource.dailyBaseTripPlaceId,
        },
        expectedSourceItemIds: dayMoveSource.items.map(({ id }) => id),
        expectedTargetBase: {
          dailyBaseDepartureTripPlaceId: dayMoveTarget.dailyBaseDepartureTripPlaceId,
          dailyBaseTripPlaceId: dayMoveTarget.dailyBaseTripPlaceId,
        },
        expectedTargetItemIds: dayMoveTarget.items.map(({ id }) => id),
        strategy: dayMoveTarget.items.length ? dayMoveStrategy : 'append',
        targetItineraryDayId: targetId,
      });
      setDayMoveSourceId(null);
      setSelectedDayId(targetId);
      await refresh();
    } catch (error) {
      if (error instanceof ItineraryApiError && error.code === 'itinerary_day_conflict') {
        await refresh();
        setDayMoveError(t('dayMove.conflictError'));
      } else {
        setDayMoveError(t('dayMove.saveError'));
      }
    } finally {
      setMovingDay(false);
    }
  }

  function selectAdjacentDay(offset: number) {
    const day = itinerary?.days[selectedIndex + offset];
    if (day) setSelectedDayId(day.id);
  }

  async function changePlacePriority(item: ItineraryItem, priority: TripPlacePriority | null) {
    const place = item.tripPlace;
    if (!place || prioritySaves.current.has(place.id) || place.priority === priority) return;
    prioritySaves.current.add(place.id);
    setSavingPriorityIds(new Set(prioritySaves.current));
    setError(null);
    try {
      await setTripPlacePriority(queryClient, tripId, place.id, priority);
    } catch {
      setError(tripPlacesTranslations('actionError'));
    } finally {
      prioritySaves.current.delete(place.id);
      setSavingPriorityIds(new Set(prioritySaves.current));
    }
  }

  function openDay(dayId: string) {
    setSelectedDayId(dayId);
    writeDayToUrl(dayId, 'push');
  }

  function openOverviewItem(item: ItineraryItem) {
    if (!item.itineraryDayId) return;
    openDay(item.itineraryDayId);
    openEdit(item);
  }

  function openTripMapItem(itemId: string) {
    const day = itinerary?.days.find((candidate) =>
      candidate.items.some((item) => item.id === itemId),
    );
    if (!day) return;
    // A phone shows the day's list, where the stop is read and changed.
    setPhoneMapOpen(false);
    setPendingDayItemId(itemId);
    openDay(day.id);
  }

  function changeOverviewDisplay(display: TripBoardDisplay) {
    setOverviewDisplay(display);
    if (display === 'map') setTripMapMounted(true);
  }

  function changeItineraryView(value: string) {
    if (value === 'overview') {
      writeDayToUrl(null, 'push');
      return;
    }

    const dayId = selectedDayId ?? itinerary?.days[0]?.id;
    if (dayId) openDay(dayId);
  }

  if (status === 'loading') {
    return <PageState kind="loading" loadingShape="planner" title={t('loading')} />;
  }
  if (status === 'error' || !itinerary) {
    return (
      <PageState
        actions={<Button onClick={() => void refresh()}>{t('tryAgain')}</Button>}
        description={t('loadErrorDescription')}
        icon={<CircleAlert aria-hidden="true" />}
        kind="error"
        title={t('loadError')}
      />
    );
  }

  return (
    // `gap` rather than `space-y`: the Day view can sit in a `contents` wrapper,
    // and its children still need to be spaced as this section's own.
    <section
      // The height of the sticky stack the day scrolls under - the trip's tab
      // row on a phone, and the ribbon everywhere - so the map and a scrolled-to
      // stop can land just below it.
      className="flex flex-col gap-7 [--planner-sticky:calc(var(--safe-top)+var(--header-offset)+9.5rem)] md:[--planner-sticky:calc(var(--safe-top)+var(--header-offset)+6.25rem)]"
    >
      <PlannerRibbon
        days={ribbonDays}
        onSelectDay={(dayId) => (activeView === 'day' ? setSelectedDayId(dayId) : openDay(dayId))}
        onSelectOverview={() => {
          setPhoneMapOpen(false);
          changeItineraryView('overview');
        }}
        overviewActive={activeView === 'overview'}
        selectedDayId={selectedDayId}
        weatherFor={(date) => tripWeatherForDate(weather ?? null, date)}
      />

      {error ? (
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <TimingReviewNotice
        outcome={timingReview}
        pending={timingPending}
        nameFor={(id) => {
          const item = itinerary?.days.flatMap((day) => day.items).find((item) => item.id === id);
          return item ? itemName(item) : t('connectedTiming.stop');
        }}
      />
      {timeZoneConsequence ? (
        <Alert role="status" variant="info">
          <Clock3 aria-hidden="true" />
          <AlertDescription>{t('timeZoneConsequence')}</AlertDescription>
        </Alert>
      ) : null}
      {renderOverview ? (
        <div className={activeView === 'overview' ? 'contents' : 'hidden'}>
          <TripBoard
            actions={
              <Button
                aria-haspopup="dialog"
                data-trip-places-trigger
                onClick={openPlaces}
                size="sm"
                variant="outline"
              >
                <Icons.Places aria-hidden="true" data-icon="inline-start" />
                {tripPlacesTranslations('openPlaces')}
              </Button>
            }
            chapters={chapters}
            days={itinerary.days}
            display={overviewDisplay}
            itemName={itemName}
            mapPanel={
              shouldMountTripMap ? (
                <ItineraryTripMap
                  days={itinerary.days}
                  onOpenItem={openTripMapItem}
                  onViewPlaceDetails={(point, focusDate) => {
                    const tripPlace = tripPlaceById(point.tripPlaceId);
                    if (tripPlace)
                      openPlaceDetails(
                        tripPlace,
                        focusDate ?? placeVisitDate(placeUse[tripPlace.id]),
                      );
                  }}
                  resolveItemName={itemName}
                  resolvePlaceLocation={placeLocation}
                  resolvePlaceName={(tripPlace) => placeName(tripPlace) ?? t('providerPlace')}
                  suspendUpdates={!tripMapVisible}
                  tripId={tripId}
                  tripPlaces={itinerary.tripPlaces}
                />
              ) : null
            }
            onDisplayChange={changeOverviewDisplay}
            onEditItem={openOverviewItem}
            onOpenDay={openDay}
            sketchFor={(day) => {
              // Drawn from coordinates the trip already holds: no leg is routed
              // for the whole trip's view.
              const places = daySketchPlaces(
                buildDaySequence({ bases: resolveDailyBases({ day }), items: day.items }),
                itinerary.tripPlaces,
              );
              const sketch = routeSketch(places, DAY_SKETCH_BOX, { minDistinct: 2 });
              return sketch ? <DayRouteSketch places={places} sketch={sketch} /> : null;
            }}
            stayName={(tripPlaceId) => placeName(tripPlaceById(tripPlaceId))}
            timeFormat={preferences.timeFormat}
            weatherFor={(date) => tripWeatherForDate(weather ?? null, date)}
          />
        </div>
      ) : null}
      {renderDayView && selectedDay ? (
        <div className={activeView === 'day' ? 'contents' : 'hidden'}>
          <PlannerDayView
            map={
              <PlannerMapPane
                label={t('map.regionLabel')}
                mounted={shouldMountPlanningMap}
                onClose={closePhoneMap}
                open={phoneMapOpen}
              >
                <ItineraryPlanningMap
                  className="h-full min-h-0 lg:min-h-0"
                  onAddToDay={(point) => addTripPlaceToSelectedDay(point.tripPlaceId)}
                  onClearSelection={clearMapSelection}
                  onSelectPoint={handleMapPointSelection}
                  onViewItem={viewMapItem}
                  onViewPlaceDetails={(point) => {
                    const tripPlace = tripPlaceById(point.tripPlaceId);
                    if (tripPlace)
                      openPlaceDetails(
                        tripPlace,
                        point.kind === 'considered'
                          ? placeVisitDate(placeUse[tripPlace.id])
                          : selectedDay.date,
                      );
                  }}
                  points={mapPoints}
                  routeLines={routeLines}
                  selectedPointId={selectedMapPointId}
                  suspendUpdates={!planningMapVisible}
                />
              </PlannerMapPane>
            }
            phoneMapOpen={phoneMapOpen}
          >
            <DayMasthead
              actions={
                <>
                  {/* A phone adds a stop with the bottom bar's plus button. */}
                  <Button
                    className="hidden md:inline-flex"
                    onClick={() => openCreate(selectedDay)}
                    size="sm"
                    type="button"
                  >
                    <Plus aria-hidden="true" data-icon="inline-start" />
                    {plannerT('masthead.addStop')}
                  </Button>
                  <Button
                    aria-haspopup="dialog"
                    data-trip-places-trigger
                    onClick={openPlaces}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Icons.Places aria-hidden="true" data-icon="inline-start" />
                    {tripPlacesTranslations('openPlaces')}
                  </Button>
                  <Button
                    aria-label={plannerT('masthead.previewLabel', {
                      number: selectedIndex + 1,
                    })}
                    nativeButton={false}
                    render={
                      <Link
                        href={dayPreviewHref(
                          tripId,
                          selectedDay.date,
                          selectedDay.items
                            .flatMap((item) => (item.localStartTime ? [item.localStartTime] : []))
                            .toSorted()[0],
                        )}
                      />
                    }
                    size="sm"
                    variant="outline"
                  >
                    <Icons.Preview aria-hidden="true" data-icon="inline-start" />
                    {plannerT('masthead.preview')}
                  </Button>
                  {/* A day that has been lived has its memories; the journal opens on it. */}
                  {(tripLifecycle === 'active' || tripLifecycle === 'completed') &&
                  (!today || selectedDay.date <= today) ? (
                    <Button
                      nativeButton={false}
                      render={
                        <Link
                          href={`/trips/${tripId}/memories?date=${encodeURIComponent(selectedDay.date)}`}
                        />
                      }
                      size="sm"
                      variant="outline"
                    >
                      <Icons.Memories aria-hidden="true" data-icon="inline-start" />
                      {plannerT('masthead.memories')}
                    </Button>
                  ) : null}
                  <DayMenu
                    canCheckOrder={online && selectedDay.items.length > 1}
                    canSuggestTimes={online && untimedItems(selectedDay).length > 0}
                    compact={compact}
                    day={selectedDay}
                    onCheckOrder={() => setBetterOrderDay(selectedDay)}
                    onCompactChange={setCompactItinerary}
                    onEditContext={() => setContextDay(selectedDay)}
                    onEditName={() => {
                      setDayNameEditor(selectedDay);
                      setDayNameValue(selectedDay.name ?? '');
                      setDayNameError(null);
                    }}
                    onEditNote={() => {
                      setDayNoteEditor(selectedDay);
                      setDayNoteValue(selectedDay.notes ?? '');
                    }}
                    onEditStay={() => setStayOpen(true)}
                    onMoveDay={(strategy) => openDayMove(selectedDay, strategy)}
                    onSuggestTimes={() => setDayTimesOpen(true)}
                  />
                </>
              }
              attention={
                dayProblems.day[0] ? (
                  <ScoreProblemNote
                    problem={dayProblems.day[0]}
                    resolveAction={resolveScoreAction}
                  />
                ) : null
              }
              compactTravel={compact}
              date={selectedDay.date}
              dayId={selectedDay.id}
              dayNumber={selectedIndex + 1}
              facts={dayFacts(selectedDay, routes)}
              heading={dayHeading(selectedDay, selectedRibbonDay?.town ?? null)}
              photos={dayPhotos}
              isToday={selectedRibbonDay?.isToday ?? false}
              note={selectedDay.notes}
              onNextDay={
                selectedIndex < itinerary.days.length - 1 ? () => selectAdjacentDay(1) : undefined
              }
              onOpenMap={openPhoneMap}
              onPreviousDay={selectedIndex > 0 ? () => selectAdjacentDay(-1) : undefined}
              onStayClick={() => setStayOpen(true)}
              routeNotes={
                !compact &&
                (routes?.source === 'cache' ||
                  routes?.segments.some((segment) => segment.mode === 'walk')) ? (
                  <p className="flex flex-wrap gap-x-2 text-xs leading-5">
                    {routes?.source === 'cache' ? (
                      <span className="text-status-warning">
                        {t('routes.cachedRoute', {
                          date: new Intl.DateTimeFormat(locale, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          }).format(new Date(routes.generatedAt)),
                        })}
                      </span>
                    ) : null}
                  </p>
                ) : null
              }
              routesLoading={routeStatus === 'loading'}
              scoreChip={
                planScoreEnabled ? (
                  <PlanScoreChip
                    assessment={planScore.data}
                    explanations={
                      scoreDay?.explanations ?? {
                        uncertainty: [],
                        whatWorks: [],
                        worthImproving: [],
                      }
                    }
                    label={plannerT('masthead.scoreLabel', { number: selectedIndex + 1 })}
                    onOpen={() => setScoreSheetOpen(true)}
                    score={scoreDay?.score ?? null}
                    status={planScore.status}
                    tone="media"
                  />
                ) : null
              }
              sketch={
                daySketch ? <DayRouteSketch places={sketchPlaces} sketch={daySketch} /> : null
              }
              stay={(() => {
                const start = tripPlaceById(dailyBases.arrivalTripPlaceId);
                const end = tripPlaceById(dailyBases.departureTripPlaceId);
                if (start && end && start.id !== end.id) {
                  return {
                    from: placeName(start) ?? t('providerPlace'),
                    kind: 'transition',
                    to: placeName(end) ?? t('providerPlace'),
                  } satisfies DayStay;
                }
                const stay = start ?? end;
                return stay
                  ? ({
                      kind: 'same',
                      name: placeName(stay) ?? t('providerPlace'),
                    } satisfies DayStay)
                  : ({ kind: 'none' } satisfies DayStay);
              })()}
              weather={tripWeatherForDate(weather ?? null, selectedDay.date)}
            />

            {selectedDay.items.length ? (
              <DayTimeline
                observeItem={observeStop}
                attentionFor={(item) => {
                  // A stop already offering its missing Place or location in one
                  // tap is not told about it twice.
                  const problems = (dayProblems.byItem.get(item.id) ?? []).filter(
                    (problem) => problem.action !== 'LINK_PLACE' || !stopPartial(item),
                  );
                  const holidays = (hoursNotices?.notices ?? []).filter(
                    (notice) =>
                      notice.kind === 'holiday_check' &&
                      notice.dayId === selectedDay.id &&
                      notice.tripPlaceId === item.tripPlace?.id,
                  );
                  const timingIssues = (timingAssessment.data?.issues ?? []).filter(
                    (issue) => issue.itemId === item.id,
                  );
                  if (!problems.length && !holidays.length && !timingIssues.length) return null;
                  return (
                    <>
                      {timingIssues.map((issue) => (
                        <AttentionNote
                          className={
                            issue.severity === 'conflict'
                              ? 'bg-destructive/8 [&_svg]:text-destructive'
                              : undefined
                          }
                          key={issue.code}
                        >
                          <Button
                            className="h-auto whitespace-normal px-0 text-left text-sm"
                            type="button"
                            variant="link"
                            onClick={() => setTimingItem(item)}
                          >
                            <span className="sr-only">
                              {t(`connectedTiming.issueLabel.${issue.severity}`)}:{' '}
                            </span>
                            {t(`connectedTiming.issue.${issue.code}`)}
                          </Button>
                        </AttentionNote>
                      ))}
                      {problems.map((problem, index) => (
                        <ScoreProblemNote
                          key={`${problem.code}-${index}`}
                          problem={problem}
                          resolveAction={resolveScoreAction}
                        />
                      ))}
                      {holidays.map((notice) =>
                        notice.kind === 'holiday_check' ? (
                          <AttentionNote key={`${notice.dayId}-${notice.tripPlaceId}`}>
                            {plannerT('stop.holidayCheck', { holiday: notice.holidayName })}
                          </AttentionNote>
                        ) : null,
                      )}
                    </>
                  );
                }}
                defaultTimeZone={selectedDay.defaultTimeZone}
                distanceUnit={preferences.distanceUnit}
                entries={bandedSequence}
                hoursFor={(item) =>
                  item.tripPlace ? dayPlaceSignals[item.tripPlace.id]?.hours : undefined
                }
                itemCount={selectedDay.items.length}
                label={t('itemListLabel')}
                menuActions={{
                  onDeleteItem: setItemToDelete,
                  onDuplicateItem: (item) => void handleDuplicate(item),
                  onEditItem: openEdit,
                  onMoveItem: (item, dayId, position) => void handleOrganize(item, dayId, position),
                  onMoveToDay: (item) => setMoveTarget({ allowUnscheduled: true, item }),
                  onPlacePriorityChange: (item, priority) =>
                    void changePlacePriority(item, priority),
                  onSelectItem: selectItemOnMap,
                  organizingItemId,
                  savingPriorityIds,
                  selectedDayId: selectedDay.id,
                }}
                onInsert={(position, afterName) => openInsert(selectedDay, position, afterName)}
                onEditTiming={setTimingItem}
                onModeChange={(segment, mode) => void handleRouteModeChange(segment, mode)}
                onReorder={(item, position) => void handleOrganize(item, selectedDay.id, position)}
                onSelectBase={selectBaseOnMap}
                onSelectItem={selectItemOnMap}
                onViewBaseDetails={(tripPlaceId) =>
                  openPlaceDetails(tripPlaceById(tripPlaceId) ?? null, selectedDay.date)
                }
                onViewItemDetails={(item) => openPlaceDetails(item.tripPlace, selectedDay.date)}
                resolveBase={(tripPlaceId) => {
                  const tripPlace = tripPlaceById(tripPlaceId);
                  if (!tripPlace) return null;
                  const point = mapPoints.find(
                    (candidate) =>
                      candidate.kind === 'base' && candidate.tripPlaceId === tripPlace.id,
                  );
                  return {
                    located: Boolean(point),
                    name: placeName(tripPlace) ?? t('providerPlace'),
                    selected: Boolean(point && selectedMapPointId === point.id),
                  };
                }}
                resolveItem={(item) => {
                  const locality = localityFromAddress(
                    item.tripPlace?.place.snapshot?.address ??
                      item.tripPlace?.place.providerAddress,
                  );
                  return {
                    category: item.tripPlace?.place.snapshot?.category,
                    detailed: Boolean(item.tripPlace),
                    locality:
                      locality && !sameTown(locality, selectedRibbonDay?.town) ? locality : null,
                    located: Boolean(item.tripPlace && placeLocation(item.tripPlace)),
                    mapsHref: item.tripPlace ? googleMapsPlaceHref(item.tripPlace.place) : null,
                    name: itemName(item),
                    photo: plannerStopPhoto(item, stopImages),
                    selected: selectedMapItemId === item.id,
                  };
                }}
                partialFor={stopPartial}
                routesStale={routes?.stale ?? false}
                savingRouteOwner={savingRouteOwner}
              />
            ) : (
              <DayEmpty
                dayNumber={selectedIndex + 1}
                mustGo={itinerary.tripPlaces.filter(
                  (tripPlace) =>
                    tripPlace.priority === 'must_go' && !placeUse[tripPlace.id]?.dayDates.length,
                )}
                onAddMustGo={async (tripPlace) => {
                  // An idea already kept for it in Unscheduled is scheduled, with
                  // its notes and timing, rather than added a second time.
                  const idea = itinerary.unscheduledItems.find(
                    (item) => item.tripPlace?.id === tripPlace.id,
                  );
                  if (idea) await handleOrganize(idea, selectedDay.id, selectedDay.items.length);
                  else await addTripPlaceToSelectedDay(tripPlace.id);
                }}
                onAddStop={() => openCreate(selectedDay)}
                onBrowsePlaces={openPlaces}
                placeName={(tripPlace) => placeName(tripPlace) ?? t('providerPlace')}
                town={selectedRibbonDay?.town ?? null}
                tripIsEmpty={itinerary.days.every((day) => !day.items.length)}
              />
            )}

            <ItineraryGapSuggestions
              dayId={selectedDay.id}
              onAdded={refresh}
              placeName={(tripPlace) => placeName(tripPlace) ?? t('providerPlace')}
              tripId={tripId}
              tripPlaces={itinerary.tripPlaces}
            />
            <div aria-hidden="true" className="h-px" ref={insightsSentinelRef} />
            <TripInsights
              dayId={selectedDay.id}
              enabled={insightsVisible}
              resolveAction={resolveScoreAction}
              surface="card"
              tripId={tripId}
            />
          </PlannerDayView>
        </div>
      ) : null}

      {activeView === 'overview' ? (
        <ItineraryPlaceGroups
          dayLabel={(day) => t('dayNumber', { number: itinerary.days.indexOf(day) + 1 })}
          days={itinerary.days}
          onAdded={refresh}
          placeName={(tripPlace) => placeName(tripPlace) ?? t('providerPlace')}
          tripId={tripId}
          tripPlaces={itinerary.tripPlaces}
        />
      ) : null}

      {activeView === 'overview' ? (
        <TripScoreAndInsights
          planScore={planScore}
          planScoreEnabled={planScoreEnabled}
          resolveAction={resolveScoreAction}
          tripId={tripId}
        />
      ) : null}

      <UnscheduledTray
        items={itinerary.unscheduledItems}
        onDelete={setItemToDelete}
        onDuplicate={(item) => void handleDuplicate(item)}
        onSchedule={(item) => setMoveTarget({ allowUnscheduled: false, item })}
        onViewDetails={(item) => openPlaceDetails(item.tripPlace)}
        organizingItemId={organizingItemId}
        resolveItem={(item) => ({
          category: item.tripPlace?.place.snapshot?.category,
          name: itemName(item),
        })}
      />

      {selectedDay ? (
        <StaySheet
          day={selectedDay}
          onChange={(tripPlaceId, departureTripPlaceId) =>
            void handleDailyBase(selectedDay, tripPlaceId, departureTripPlaceId)
          }
          onOpenChange={setStayOpen}
          open={stayOpen}
          placeName={placeName}
          tripPlaces={alphabeticalTripPlaces}
        />
      ) : null}

      {selectedDay ? (
        <TimingSheet
          dayId={selectedDay.id}
          item={timingItem}
          name={timingItem ? itemName(timingItem) : ''}
          onClose={() => setTimingItem(null)}
          onSaved={async ({ timeZoneConsequence: consequence, scheduling }) => {
            if (scheduling) setTimingReview(scheduling);
            if (!scheduling) setTimingPending(true);
            setTimeZoneConsequence(consequence);
            setTimingItem(null);
            await refresh();
          }}
          open={Boolean(timingItem)}
          tripId={tripId}
        />
      ) : null}

      {moveTarget ? (
        <MoveToDaySheet
          allowUnscheduled={moveTarget.allowUnscheduled}
          currentDayId={moveTarget.item.itineraryDayId}
          days={ribbonDays}
          itemName={itemName(moveTarget.item)}
          key={moveTarget.item.id}
          onMove={(dayId, position) => void handleOrganize(moveTarget.item, dayId, position)}
          onOpenChange={(open) => !open && setMoveTarget(null)}
          open
        />
      ) : null}

      {planScoreEnabled && selectedDay ? (
        <PlanScoreSheet
          onOpenChange={setScoreSheetOpen}
          open={scoreSheetOpen}
          panel={{
            assessment: planScore.data,
            change: planScore.changeFor(selectedDay.id),
            completeness: scoreDay?.completeness ?? null,
            confidence: scoreDay?.confidence ?? null,
            dayId: selectedDay.id,
            disabled: scoreDay?.withheldReasons.includes('ADMINISTRATIVELY_DISABLED'),
            explanations: scoreDay?.explanations ?? {
              uncertainty: [],
              whatWorks: [],
              worthImproving: [],
            },
            factors: scoreDay?.factors,
            onRetry: planScore.retry,
            // An action that opens something here closes the sheet first, so
            // what it opens is not behind it.
            resolveAction: (explanation) => {
              const action = resolveScoreAction(explanation);
              return action && 'onSelect' in action
                ? {
                    onSelect: () => {
                      setScoreSheetOpen(false);
                      action.onSelect();
                    },
                  }
                : action;
            },
            score: scoreDay?.score ?? null,
            scope: 'day',
            status: planScore.status,
            title: planScoreTranslations('dayTitle'),
            onOpenTripPlaces: openPlaces,
          }}
          title={dayOption(selectedDay, selectedIndex)}
        />
      ) : null}

      <StopEditorSheet
        id={stopEditor.id}
        locationBias={editorLocationBias}
        onClose={closeEditor}
        onDelete={setItemToDelete}
        onSaved={async ({ timeZoneConsequence: consequence, scheduling }) => {
          if (scheduling) setTimingReview(scheduling);
          if (!scheduling) setTimingPending(true);
          setTimeZoneConsequence(consequence);
          closeEditor();
          await refresh();
        }}
        onTripPlaceAdded={(tripPlace) =>
          setItinerary((current) =>
            current && !current.tripPlaces.some((place) => place.id === tripPlace.id)
              ? {
                  ...current,
                  tripPlaces: [...current.tripPlaces, itineraryTripPlaceFromTripPlace(tripPlace)],
                }
              : current,
          )
        }
        open={stopEditor.open}
        placeUse={placeUse}
        request={stopEditor.request}
        tripId={tripId}
        tripPlaces={itinerary?.tripPlaces ?? []}
      />

      <ItineraryBetterOrder
        day={betterOrderDay}
        itemName={itemName}
        onApplied={refresh}
        onOpenChange={(open) => !open && setBetterOrderDay(null)}
        tripId={tripId}
      />

      {selectedDay ? (
        <ItineraryDayTimeSuggestions
          day={selectedDay}
          itemName={itemName}
          onApplied={refresh}
          onOpenChange={setDayTimesOpen}
          open={dayTimesOpen}
          tripId={tripId}
        />
      ) : null}

      <Sheet
        open={Boolean(dayMoveSource)}
        onOpenChange={(open) => {
          if (!open && !movingDay) {
            setDayMoveSourceId(null);
            setDayMoveError(null);
          }
        }}
      >
        <SheetContent closeLabel={t('close')}>
          {dayMoveSource ? (
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleDayMove}>
              <SheetHeader className="border-b">
                <SheetTitle>
                  {effectiveDayMoveStrategy === 'swap'
                    ? t('dayMove.swapTitle')
                    : t('dayMove.title')}
                </SheetTitle>
                <SheetDescription>
                  {t('dayMove.description', {
                    count: dayMoveSource.items.length,
                    day: dayOption(
                      dayMoveSource,
                      itinerary.days.findIndex(({ id }) => id === dayMoveSource.id),
                    ),
                  })}
                </SheetDescription>
              </SheetHeader>
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="itinerary-day-move-target">
                      {t('dayMove.targetLabel')}
                    </FieldLabel>
                    <Select
                      onValueChange={(value) => {
                        // The strategy is not reset here. It is now how the
                        // sheet was opened, and a traveller who asked to swap
                        // has not changed their mind by naming the other day.
                        setDayMoveTargetId(value ?? '');
                        setDayMoveError(null);
                      }}
                      value={dayMoveTargetId}
                    >
                      <SelectTrigger id="itinerary-day-move-target" className="w-full">
                        <SelectValue>
                          {dayMoveTarget
                            ? t('dayMove.targetOption', {
                                count: dayMoveTarget.items.length,
                                day: dayOption(
                                  dayMoveTarget,
                                  itinerary.days.findIndex(({ id }) => id === dayMoveTarget.id),
                                ),
                              })
                            : t('dayMove.targetPlaceholder')}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {itinerary.days.map((day, index) =>
                          day.id === dayMoveSource.id ? null : (
                            <SelectItem key={day.id} value={day.id}>
                              {t('dayMove.targetOption', {
                                count: day.items.length,
                                day: dayOption(day, index),
                              })}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </Field>

                  {dayMoveTarget?.items.length ? (
                    <Field>
                      <FieldLabel htmlFor="itinerary-day-move-strategy">
                        {t('dayMove.strategyLabel')}
                      </FieldLabel>
                      <Select
                        onValueChange={(value) =>
                          setDayMoveStrategy(value === 'swap' ? 'swap' : 'append')
                        }
                        value={dayMoveStrategy}
                      >
                        <SelectTrigger id="itinerary-day-move-strategy" className="w-full">
                          <SelectValue>
                            {t(dayMoveStrategy === 'swap' ? 'dayMove.swap' : 'dayMove.append')}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="append">{t('dayMove.append')}</SelectItem>
                          <SelectItem value="swap">{t('dayMove.swap')}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        {dayMoveStrategy === 'swap'
                          ? t('dayMove.swapDescription', {
                              count: dayMoveTarget.items.length,
                            })
                          : t('dayMove.appendDescription', {
                              count: dayMoveTarget.items.length,
                            })}
                      </FieldDescription>
                    </Field>
                  ) : null}
                </FieldGroup>

                <p className="rounded-[var(--radius-md)] bg-muted px-3 py-2.5 text-sm leading-5 text-muted-foreground">
                  {t('dayMove.settingsStay')}
                </p>

                {dayMoveError ? (
                  <Alert role="alert" variant="destructive">
                    <CircleAlert aria-hidden="true" />
                    <AlertDescription>{dayMoveError}</AlertDescription>
                  </Alert>
                ) : null}
              </div>
              <SheetFooter className="flex-col-reverse sm:flex-row sm:justify-end">
                <Button
                  disabled={movingDay}
                  onClick={() => setDayMoveSourceId(null)}
                  type="button"
                  variant="outline"
                >
                  {t('cancel')}
                </Button>
                <Button disabled={movingDay || !dayMoveTarget} type="submit">
                  {movingDay
                    ? t('dayMove.moving')
                    : effectiveDayMoveStrategy === 'swap'
                      ? t('dayMove.swapConfirm')
                      : t('dayMove.confirm')}
                </Button>
              </SheetFooter>
            </form>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet
        open={Boolean(dayNoteEditor)}
        onOpenChange={(open) => {
          if (!open && !savingDayNote) setDayNoteEditor(null);
        }}
      >
        <SheetContent closeLabel={t('close')}>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleDayNoteSave}>
            <SheetHeader className="border-b">
              <SheetTitle>{t('dayNoteTitle')}</SheetTitle>
              <SheetDescription>
                {t('dayNoteDescription', {
                  date: dayNoteEditor ? formatDate(dayNoteEditor.date, true) : '',
                })}
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
              <Field>
                <FieldLabel htmlFor="itinerary-day-note">{t('dayNoteLabel')}</FieldLabel>
                <Textarea
                  id="itinerary-day-note"
                  maxLength={5_000}
                  onChange={(event) => setDayNoteValue(event.target.value)}
                  placeholder={t('dayNotePlaceholder')}
                  rows={5}
                  value={dayNoteValue}
                />
              </Field>
            </div>
            <SheetFooter className="flex-col-reverse sm:flex-row sm:justify-end">
              <Button
                disabled={savingDayNote}
                onClick={() => setDayNoteEditor(null)}
                type="button"
                variant="outline"
              >
                {t('cancel')}
              </Button>
              <Button disabled={savingDayNote} type="submit">
                {savingDayNote ? t('saving') : t('save')}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      {contextDay ? (
        <DayPlanningContextSheet
          initial={contextDay.planningContext}
          timeZone={contextDay.defaultTimeZone}
          onClose={() => setContextDay(null)}
          onSave={async (value) => {
            const result = await updateItineraryDayPlanningContext(tripId, contextDay.id, value);
            setItinerary((current) =>
              current
                ? {
                    ...current,
                    days: current.days.map((day) =>
                      day.id === result.id
                        ? { ...day, planningContext: result.planningContext }
                        : day,
                    ),
                  }
                : current,
            );
            void queryClient.invalidateQueries({ queryKey: queryKeys.planScore(tripId) });
          }}
        />
      ) : null}
      <Sheet
        open={Boolean(dayNameEditor)}
        onOpenChange={(open) => {
          if (!open && !savingDayName) setDayNameEditor(null);
        }}
      >
        <SheetContent closeLabel={t('close')}>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleDayNameSave}>
            <SheetHeader className="border-b">
              <SheetTitle>{t('dayNameTitle')}</SheetTitle>
              <SheetDescription>
                {t('dayNameDescription', {
                  date: dayNameEditor ? formatDate(dayNameEditor.date, true) : '',
                })}
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
              <Field>
                <FieldLabel htmlFor="itinerary-day-name">{t('dayNameLabel')}</FieldLabel>
                <Input
                  autoFocus
                  id="itinerary-day-name"
                  maxLength={120}
                  onChange={(event) => setDayNameValue(event.target.value)}
                  placeholder={t('dayNamePlaceholder')}
                  value={dayNameValue}
                />
                <FieldDescription>{t('dayNameHint')}</FieldDescription>
                {dayNameError ? (
                  <p className="text-sm text-destructive" role="alert">
                    {dayNameError}
                  </p>
                ) : null}
              </Field>
            </div>
            <SheetFooter className="flex-col-reverse sm:flex-row sm:justify-end">
              <Button
                disabled={savingDayName}
                onClick={() => setDayNameEditor(null)}
                type="button"
                variant="outline"
              >
                {t('cancel')}
              </Button>
              <Button disabled={savingDayName} type="submit">
                {savingDayName ? t('saving') : t('save')}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={Boolean(itemToDelete)}
        onOpenChange={(open) => {
          if (!open) {
            setItemToDelete(null);
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteDescription', { name: itemToDelete ? itemName(itemToDelete) : '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <Alert role="alert" variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={() => void handleDelete()}
              variant="destructive"
            >
              {deleting ? t('deleting') : t('deleteItem')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {detailsPlace ? (
        <PlaceDetailsSheet
          key={detailsPlace.place.id}
          editorialImages={detailsEditorialImages}
          meta={detailsMeta(detailsPlace)}
          name={placeName(detailsPlace) ?? t('providerPlace')}
          officialName={detailsPlace.customName?.trim() ? detailsProviderName : null}
          onLocate={
            canLocate(detailsPlace)
              ? () => {
                  setLocatePlace(detailsPlace);
                  setDetailsPlace(null);
                }
              : undefined
          }
          onOpenChange={(open) => !open && setDetailsPlace(null)}
          place={detailsPlace.place}
          visitDate={detailsVisitDate}
        />
      ) : null}

      <LocatePlaceSheet
        onLocated={async () => {
          await invalidateTripQueries(queryClient, tripId, PLACE_LOCATION_QUERY_ROOTS);
        }}
        onOpenChange={(open) => !open && setLocatePlace(null)}
        place={
          locatePlace
            ? {
                name: placeName(locatePlace) ?? t('providerPlace'),
                placeId: locatePlace.place.id,
                tripId,
                tripPlaceId: locatePlace.id,
              }
            : null
        }
      />
    </section>
  );
}
