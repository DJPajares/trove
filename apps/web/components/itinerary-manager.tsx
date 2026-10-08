'use client';
import { DayPlanningContextSheet } from '@/components/day-planning-context';

import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Clock3, Copy, NotebookPen, Plus, Search, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { ItineraryCreateItemSheet } from '@/components/itinerary-create-item-sheet';
import { ItineraryGapSuggestions } from '@/components/itinerary-gap-suggestions';
import { ItineraryPlaceGroups } from '@/components/itinerary-place-groups';
import { ItineraryBetterOrder } from '@/components/itinerary-better-order';
import { ItineraryDayTimeSuggestions } from '@/components/itinerary-day-time-suggestions';
import { SuggestedTimeAction, useSuggestedTime } from '@/components/itinerary-suggested-time';
import { PageState } from '@/components/page-state';
import { ItineraryOverview, type ItineraryOverviewDisplay } from '@/components/itinerary-overview';
import { ItineraryPlanningMap } from '@/components/itinerary-planning-map';
import { ItineraryTripMap } from '@/components/itinerary-trip-map';
import { ItineraryPlacesDrawer } from '@/components/itinerary-places-drawer';
import { LocatePlaceSheet } from '@/components/locate-place-sheet';
import { PlaceDetailsSheet, type PlaceDetailsRow } from '@/components/place-details-sheet';
import { PlanScoreChip, PlanScorePanel } from '@/components/plan-score-panel';
import { ScoreProblemNote, AttentionNote } from '@/components/planner/attention-note';
import { DayMasthead, type DayStay } from '@/components/planner/day-masthead';
import { DAY_SKETCH_BOX, DayRouteSketch } from '@/components/planner/day-route-sketch';
import { DaySettingsMenu } from '@/components/planner/day-settings-menu';
import { DayTimeline } from '@/components/planner/day-timeline';
import { PlanScoreSheet } from '@/components/planner/plan-score-sheet';
import { PlannerDayView } from '@/components/planner/planner-day-view';
import { PlannerMapPane } from '@/components/planner/planner-map-pane';
import { PlannerRibbon } from '@/components/planner/planner-ribbon';
import { TripInsights } from '@/components/trip-insights';
import { useRegisterPrimaryAction } from '@/components/primary-action-provider';
import { usePreferences } from '@/components/preferences-provider';
import { TimeInput } from '@/components/time-input';
import { Badge } from '@/components/ui/badge';
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
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
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
  type ItineraryItemInput,
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
  updateItineraryItem,
  updateItineraryItemRouteMode,
} from '@/lib/itinerary/api';
import { useOnlineStatus } from '@/components/trip-sync-status';
import { useCompactItinerary } from '@/hooks/use-compact-itinerary';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import { withDayPartBands } from '@/lib/itinerary/day-bands';
import { dayFacts, dayHeading } from '@/lib/itinerary/day-facts';
import { localityFromAddress, sameTown } from '@/lib/itinerary/day-place';
import { buildDaySequence, dayStopNumbers, resolveDailyBases } from '@/lib/itinerary/day-sequence';
import { daySketchPlaces } from '@/lib/itinerary/day-sketch';
import { plannerDays } from '@/lib/itinerary/planner-days';
import {
  DuplicateAttemptTracker,
  refreshedItineraryContainsCopy,
} from '@/lib/itinerary/duplicate-attempt';
import { placeVisitDate, scheduledPlaceUse } from '@/lib/itinerary/places';
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
import {
  editorialSubjectKey,
  type EditorialImageReference,
  type EditorialSubject,
  MAX_EDITORIAL_IMAGE_SUBJECTS,
} from '@/lib/media/editorial-images';
import { problemsByStop } from '@/lib/plan-score/attention';
import { serverNow } from '@/lib/plan-score/clock';
import { currentAssessment } from '@/lib/plan-score/presentation';
import { useInViewOnce } from '@/lib/plan-score/use-in-view-once';
import { useTripPlanScore } from '@/lib/plan-score/use-trip-plan-score';
import {
  googleMapsPlaceHref,
  type ProviderSuggestion,
  resolveProviderPlace,
  searchProviderPlaces,
} from '@/lib/saved/api';
import { addTripPlace, type TripPlace, type TripPlacePriority } from '@/lib/trip-places/api';
import { setTripPlacePriority } from '@/lib/trip-places/priority';
import { sortTripPlaces } from '@/lib/trip-places/sort';
import { dayPreviewHref } from '@/lib/trips/navigation';
import { cn } from '@/lib/utils';
import { tripWeatherForDate, useTripWeather } from '@/lib/weather/use-trip-weather';
import {
  durationMinutesFromParts,
  durationParts,
  filterItineraryTripPlaces,
  isDurationPreset,
  itineraryIdentityChoice,
  itineraryIdentityLegacyPatch,
  itineraryProviderSuggestions,
  ITINERARY_DURATION_PRESETS,
  normalizeItineraryPlaceQuery,
} from '@/lib/itinerary/item-editor';
import { queryKeys } from '@/lib/query/keys';
import {
  ITINERARY_EDIT_QUERY_ROOTS,
  invalidateTripQueries,
  PLACE_LOCATION_QUERY_ROOTS,
} from '@/lib/query/trip-invalidation';
import * as Icons from '@/lib/icons';

type EditorState =
  | { dayId: null; item: null; mode: 'closed' }
  | { dayId: string; item: ItineraryItem; mode: 'edit' };

type FormState = {
  customLabel: string;
  durationMinutes: string;
  exactTime: string;
  localEndTime: string;
  notes: string;
  schedule: 'afternoon' | 'anytime' | 'evening' | 'exact' | 'morning' | 'none';
  timingMode: 'duration' | 'end_time';
  tripPlaceId: string;
};

function createFormState(item: ItineraryItem | null): FormState {
  return {
    customLabel: item?.customLabel ?? '',
    durationMinutes: item?.localEndTime ? '' : (item?.durationMinutes?.toString() ?? ''),
    exactTime: item?.localStartTime ?? '',
    localEndTime: item?.localEndTime ?? '',
    notes: item?.notes ?? '',
    schedule: item?.localStartTime ? 'exact' : (item?.dayPart ?? 'none'),
    timingMode: item?.localEndTime ? 'end_time' : 'duration',
    tripPlaceId: item?.tripPlace?.id ?? '',
  };
}

type ProviderSearchCacheEntry = {
  sessionToken: string | null;
  status: 'empty' | 'loading' | 'ok' | 'unavailable';
  suggestions: ProviderSuggestion[];
};

type PlacePickerOption =
  | { kind: 'custom_label'; label: string }
  | { kind: 'provider'; suggestion: ProviderSuggestion }
  | { kind: 'trip_place'; label: string; tripPlace: ItineraryTripPlace; usageLabel: string | null };

/** The Places drawer responds with its richer collection shape; the itinerary only
 * needs the compatible subset it normally receives from its own endpoint. */
function itineraryTripPlaceFromTripPlace(tripPlace: TripPlace): ItineraryTripPlace {
  return {
    customName: tripPlace.customName,
    id: tripPlace.id,
    note: tripPlace.note,
    place: { ...tripPlace.place, timeZone: tripPlace.place.location?.timeZone ?? null },
    priority: tripPlace.priority,
  };
}

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
          tripPlacesHref={`/trips/${tripId}/places`}
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
  const [editor, setEditor] = useState<EditorState>({ dayId: null, item: null, mode: 'closed' });
  const [createDay, setCreateDay] = useState<ItineraryDay | null>(null);
  const [form, setForm] = useState<FormState>(() => createFormState(null));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<ItineraryItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [dayNoteEditor, setDayNoteEditor] = useState<ItineraryDay | null>(null);
  const [contextDay, setContextDay] = useState<ItineraryDay | null>(null);
  const [dayNameEditor, setDayNameEditor] = useState<ItineraryDay | null>(null);
  const [daySettingsOpen, setDaySettingsOpen] = useState(false);
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
  const [placeQuery, setPlaceQuery] = useState('');
  const [providerResults, setProviderResults] = useState<ProviderSuggestion[]>([]);
  const [providerSessionToken, setProviderSessionToken] = useState<string | null>(null);
  const [placeSearchStatus, setPlaceSearchStatus] = useState<'idle' | 'loading' | 'unavailable'>(
    'idle',
  );
  const [identityChanged, setIdentityChanged] = useState(false);
  const [identityPickerOpen, setIdentityPickerOpen] = useState(false);
  const [timingExpanded, setTimingExpanded] = useState(false);
  const [customDurationOpen, setCustomDurationOpen] = useState(false);
  const [customDurationHours, setCustomDurationHours] = useState('');
  const [customDurationMinutes, setCustomDurationMinutes] = useState('');
  // Accepting the proposal commits to the time the field now shows, since a
  // daypart is what constrained it.
  const suggestedTime = useSuggestedTime(tripId, (localTime) => {
    setForm((current) => ({ ...current, exactTime: localTime, schedule: 'exact' }));
    setFormError(null);
  });
  const providerSearchRequest = useRef<AbortController | null>(null);
  const providerSearchRequestQuery = useRef<string | null>(null);
  const providerSearchCache = useRef(new Map<string, ProviderSearchCacheEntry>());
  const currentPlaceQuery = useRef('');
  const [selectingPlace, setSelectingPlace] = useState(false);
  const [organizingItemId, setOrganizingItemId] = useState<string | null>(null);
  const duplicateAttempts = useRef(new DuplicateAttemptTracker());
  // A phone shows the day's map in place of the day only once it is asked for.
  const [phoneMapOpen, setPhoneMapOpen] = useState(false);
  const [planningMapMounted, setPlanningMapMounted] = useState(false);
  const [selectedMapPointId, setSelectedMapPointId] = useState<string | null>(null);
  const [selectedMapItemId, setSelectedMapItemId] = useState<string | null>(null);
  const [savingRouteOwner, setSavingRouteOwner] = useState<string | null>(null);
  const [placesDrawerOpen, setPlacesDrawerOpen] = useState(false);
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
  const [overviewDisplay, setOverviewDisplay] = useState<ItineraryOverviewDisplay>('list');
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
  const placeUseDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    [locale],
  );
  const placeUseListFormatter = useMemo(
    () => new Intl.ListFormat(locale, { style: 'short', type: 'conjunction' }),
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
   * Planning asks for no photography of its own - its rows are numbered markers,
   * not thumbnails - so the subject list is empty until someone opens a place,
   * and `useEditorialImages` sends nothing for an empty list. Opening one place
   * asks for one subject, under the provider's name for it rather than the
   * traveller's nickname, exactly as the Places list does.
   *
   * Trip Mode's day does carry a photograph on every row, and the two are not
   * in disagreement. This is a dense editing surface, where a column of
   * pictures is noise between the traveller and the thing they came to change.
   * That one is read standing up, deciding which of these is the place in front
   * of them, where a picture is the fastest answer there is.
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
  const dailyBaseStart = placeName(tripPlaceById(selectedDay?.dailyBaseTripPlaceId ?? null));
  const dailyBaseEnd = placeName(tripPlaceById(selectedDay?.dailyBaseDepartureTripPlaceId ?? null));
  const dailyBaseSummary =
    dailyBaseStart && dailyBaseEnd && dailyBaseStart !== dailyBaseEnd
      ? t('dailyBaseSummary', { from: dailyBaseStart, to: dailyBaseEnd })
      : (dailyBaseStart ?? dailyBaseEnd ?? t('noDailyBase'));
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

  /**
   * A photograph of each day's town, asked for once for the whole trip: the
   * subjects are the trip's distinct towns, so moving between days asks for
   * nothing. Only a town's name goes with it. A trip id would have the
   * service pin the answer to the trip, as its cover.
   */
  const townSubjects = useMemo<EditorialSubject[]>(
    () =>
      [...new Set(ribbonDays.flatMap((day) => (day.town ? [day.town] : [])))]
        .slice(0, MAX_EDITORIAL_IMAGE_SUBJECTS)
        .map((name) => ({ category: 'destination', name })),
    [ribbonDays],
  );
  const townImages = useEditorialImages(townSubjects);
  // Only a picture of the town itself; a generic draw is a picture of nowhere.
  const heroImage: EditorialImageReference | null = (() => {
    const town = selectedRibbonDay?.town;
    const first = town
      ? townImages.get(editorialSubjectKey({ category: 'destination', name: town }))?.[0]
      : undefined;
    return first && first.matchKind !== 'generic' ? first : null;
  })();

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

  function openCreate(day: ItineraryDay) {
    setCreateDay(day);
  }

  function openEdit(item: ItineraryItem) {
    if (!item.itineraryDayId) return;
    setForm(createFormState(item));
    setFormError(null);
    setPlaceQuery('');
    currentPlaceQuery.current = '';
    setProviderResults([]);
    setProviderSessionToken(null);
    setPlaceSearchStatus('idle');
    setIdentityChanged(false);
    setIdentityPickerOpen(false);
    setTimingExpanded(Boolean(item.localStartTime || item.dayPart));
    setCustomDurationOpen(
      Boolean(
        !item.localEndTime &&
        item.durationMinutes &&
        !isDurationPreset(item.durationMinutes.toString()),
      ),
    );
    const parts = durationParts(item.localEndTime ? '' : (item.durationMinutes?.toString() ?? ''));
    setCustomDurationHours(parts.hours);
    setCustomDurationMinutes(parts.minutes);
    providerSearchRequest.current?.abort();
    providerSearchRequest.current = null;
    providerSearchRequestQuery.current = null;
    providerSearchCache.current = new Map();
    suggestedTime.reset();
    setEditor({ dayId: item.itineraryDayId, item, mode: 'edit' });
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
      if (item) return { onSelect: () => openEdit(item) };
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
            openCreate(targetDay);
            selectTripPlace(place.id);
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
      openCreate(day);
      selectTripPlace(place.id);
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

  function closeEditor() {
    setEditor({ dayId: null, item: null, mode: 'closed' });
    setFormError(null);
    setPlaceQuery('');
    currentPlaceQuery.current = '';
    setProviderResults([]);
    setProviderSessionToken(null);
    setPlaceSearchStatus('idle');
    setIdentityChanged(false);
    setIdentityPickerOpen(false);
    setTimingExpanded(false);
    setCustomDurationOpen(false);
    providerSearchRequest.current?.abort();
    providerSearchRequest.current = null;
    providerSearchRequestQuery.current = null;
    providerSearchCache.current = new Map();
    suggestedTime.reset();
  }

  function updateForm<Key extends keyof FormState>(key: Key, value: FormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError(null);
  }

  // Editing only here: a stop being added asks from the add sheet instead.
  // Offline only hides it; the answer depends on the day as the server holds it,
  // and a queued read would help nobody.
  const canSuggestTime = editor.mode === 'edit' && online;

  const matchingTripPlaces = useMemo(() => {
    return sortTripPlaces(
      filterItineraryTripPlaces(itinerary?.tripPlaces ?? [], placeQuery, (tripPlace) => [
        placeName(tripPlace),
        tripPlace.place.snapshot?.address,
        tripPlace.place.providerAddress,
      ]),
      'name',
      (tripPlace) => placeName(tripPlace) ?? t('providerPlace'),
    );
  }, [itinerary?.tripPlaces, placeQuery, t]);

  const usageLabel = (tripPlace: ItineraryTripPlace) => {
    const dates = placeUse[tripPlace.id]?.dayDates ?? [];
    if (!dates.length) return null;
    return tripPlacesTranslations('onDates', {
      dates: placeUseListFormatter.format(
        dates.map((date) => placeUseDateFormatter.format(new Date(`${date}T00:00:00Z`))),
      ),
    });
  };

  const existingExternalPlaceIds = useMemo(
    () =>
      new Set(
        (itinerary?.tripPlaces ?? []).flatMap((tripPlace) =>
          tripPlace.place.providerRefs.map((reference) => reference.externalPlaceId),
        ),
      ),
    [itinerary?.tripPlaces],
  );

  const visibleProviderResults = useMemo(
    () => itineraryProviderSuggestions(providerResults, existingExternalPlaceIds),
    [existingExternalPlaceIds, providerResults],
  );

  const placePickerOptions = useMemo<PlacePickerOption[]>(() => {
    const customLabel = placeQuery.trim();
    return [
      ...matchingTripPlaces.map((tripPlace) => ({
        kind: 'trip_place' as const,
        label: placeName(tripPlace) ?? t('providerPlace'),
        tripPlace,
        usageLabel: usageLabel(tripPlace),
      })),
      ...(customLabel ? [{ kind: 'custom_label' as const, label: customLabel }] : []),
      ...visibleProviderResults.map((suggestion) => ({
        kind: 'provider' as const,
        suggestion,
      })),
    ];
  }, [
    matchingTripPlaces,
    placeQuery,
    placeUse,
    placeUseDateFormatter,
    placeUseListFormatter,
    t,
    tripPlacesTranslations,
    visibleProviderResults,
  ]);

  function clearProviderResultState() {
    setProviderResults([]);
    setProviderSessionToken(null);
    setPlaceSearchStatus('idle');
  }

  function handlePlaceQueryChange(value: string) {
    currentPlaceQuery.current = value;
    setPlaceQuery(value);
    setFormError(null);
    const queryKey = normalizeItineraryPlaceQuery(value);
    const cached = providerSearchCache.current.get(queryKey);
    if (!cached) {
      clearProviderResultState();
      return;
    }
    setProviderResults(cached.suggestions);
    setProviderSessionToken(cached.sessionToken);
    setPlaceSearchStatus(
      cached.status === 'unavailable'
        ? 'unavailable'
        : cached.status === 'loading'
          ? 'loading'
          : 'idle',
    );
  }

  async function searchGooglePlaces() {
    const query = placeQuery.trim();
    const queryKey = normalizeItineraryPlaceQuery(query);
    if (!online || query.length < 3 || providerSearchCache.current.has(queryKey)) return;

    if (providerSearchRequest.current && providerSearchRequestQuery.current) {
      providerSearchRequest.current.abort();
      providerSearchCache.current.set(providerSearchRequestQuery.current, {
        sessionToken: null,
        status: 'unavailable',
        suggestions: [],
      });
    }
    const controller = new AbortController();
    providerSearchRequest.current = controller;
    providerSearchRequestQuery.current = queryKey;
    providerSearchCache.current.set(queryKey, {
      sessionToken: null,
      status: 'loading',
      suggestions: [],
    });
    setPlaceSearchStatus('loading');
    try {
      const result = await searchProviderPlaces(query, controller.signal);
      if (controller.signal.aborted) return;
      const entry: ProviderSearchCacheEntry = {
        sessionToken: result.sessionToken,
        status:
          result.status === 'ok' ? 'ok' : result.status === 'unavailable' ? 'unavailable' : 'empty',
        suggestions: result.status === 'ok' ? result.suggestions : [],
      };
      providerSearchCache.current.set(queryKey, entry);
      if (normalizeItineraryPlaceQuery(currentPlaceQuery.current) !== queryKey) return;
      setProviderResults(entry.suggestions);
      setProviderSessionToken(entry.sessionToken);
      setPlaceSearchStatus(entry.status === 'unavailable' ? 'unavailable' : 'idle');
    } catch {
      if (controller.signal.aborted) return;
      const entry: ProviderSearchCacheEntry = {
        sessionToken: null,
        status: 'unavailable',
        suggestions: [],
      };
      providerSearchCache.current.set(queryKey, entry);
      if (normalizeItineraryPlaceQuery(currentPlaceQuery.current) !== queryKey) return;
      setProviderResults([]);
      setProviderSessionToken(null);
      setPlaceSearchStatus('unavailable');
    } finally {
      if (providerSearchRequest.current === controller) {
        providerSearchRequest.current = null;
        providerSearchRequestQuery.current = null;
      }
    }
  }

  function selectTripPlace(tripPlaceId: string) {
    setForm((current) => ({
      ...current,
      ...itineraryIdentityChoice(current, { kind: 'trip_place', tripPlaceId }),
    }));
    setIdentityChanged(true);
    setIdentityPickerOpen(false);
    setPlaceQuery('');
    currentPlaceQuery.current = '';
    clearProviderResultState();
    setFormError(null);
  }

  function selectCustomLabel(label: string) {
    setForm((current) => ({
      ...current,
      ...itineraryIdentityChoice(current, { kind: 'custom_label', label }),
    }));
    setIdentityChanged(true);
    setIdentityPickerOpen(false);
    setPlaceQuery('');
    currentPlaceQuery.current = '';
    clearProviderResultState();
    setFormError(null);
  }

  function clearIdentity() {
    setForm((current) => ({
      ...current,
      ...itineraryIdentityChoice(current, { kind: 'clear' }),
    }));
    setIdentityChanged(true);
    setIdentityPickerOpen(true);
    setPlaceQuery('');
    currentPlaceQuery.current = '';
    clearProviderResultState();
  }

  async function selectProviderPlace(suggestion: ProviderSuggestion) {
    setSelectingPlace(true);
    try {
      const { place } = await resolveProviderPlace(
        suggestion.externalPlaceId,
        { address: suggestion.description, name: suggestion.name },
        locale,
        providerSessionToken ?? undefined,
        'itinerary',
      );
      const { tripPlace } = await addTripPlace(tripId, place.id);
      setItinerary((current) =>
        current
          ? {
              ...current,
              tripPlaces: current.tripPlaces.some((item) => item.id === tripPlace.id)
                ? current.tripPlaces
                : [
                    ...current.tripPlaces,
                    {
                      customName: tripPlace.customName,
                      id: tripPlace.id,
                      note: tripPlace.note,
                      place: {
                        id: tripPlace.place.id,
                        kind: tripPlace.place.kind,
                        location: tripPlace.place.location,
                        name: tripPlace.place.name,
                        note: tripPlace.place.note,
                        providerAddress: tripPlace.place.providerAddress,
                        providerLabel: tripPlace.place.providerLabel,
                        providerRefs: tripPlace.place.providerRefs,
                        timeZone: tripPlace.place.location?.timeZone ?? null,
                      },
                      priority: tripPlace.priority,
                    },
                  ],
            }
          : current,
      );
      selectTripPlace(tripPlace.id);
    } catch {
      setFormError(t('placeSelectionError'));
    } finally {
      setSelectingPlace(false);
    }
  }

  function selectPlacePickerOption(option: PlacePickerOption | null) {
    if (!option) return;
    if (option.kind === 'trip_place') {
      selectTripPlace(option.tripPlace.id);
      return;
    }
    if (option.kind === 'custom_label') {
      selectCustomLabel(option.label);
      return;
    }
    void selectProviderPlace(option.suggestion);
  }

  const selectedTripPlace = form.tripPlaceId
    ? (itinerary?.tripPlaces.find((tripPlace) => tripPlace.id === form.tripPlaceId) ?? null)
    : null;
  const hasItemIdentity = Boolean(form.customLabel.trim() || form.tripPlaceId);
  const providerQueryKey = normalizeItineraryPlaceQuery(placeQuery);
  const providerQueryCached = providerSearchCache.current.has(providerQueryKey);
  const selectedPlaceName = selectedTripPlace ? placeName(selectedTripPlace) : null;

  function chooseDurationPreset(minutes: number) {
    updateForm('durationMinutes', minutes.toString());
    setCustomDurationOpen(false);
    const parts = durationParts(minutes.toString());
    setCustomDurationHours(parts.hours);
    setCustomDurationMinutes(parts.minutes);
  }

  function showCustomDuration() {
    const parts = durationParts(form.durationMinutes);
    setCustomDurationHours(parts.hours);
    setCustomDurationMinutes(parts.minutes);
    setCustomDurationOpen(true);
  }

  function updateCustomDuration(kind: 'hours' | 'minutes', value: string) {
    const parts = {
      hours: kind === 'hours' ? value : customDurationHours,
      minutes: kind === 'minutes' ? value : customDurationMinutes,
    };
    setCustomDurationHours(parts.hours);
    setCustomDurationMinutes(parts.minutes);
    updateForm('durationMinutes', durationMinutesFromParts(parts));
  }

  function removeTiming() {
    setForm((current) => ({
      ...current,
      durationMinutes: current.timingMode === 'end_time' ? '' : current.durationMinutes,
      exactTime: '',
      localEndTime: '',
      schedule: 'none',
      timingMode: 'duration',
    }));
    setTimingExpanded(false);
    suggestedTime.reset();
    setFormError(null);
  }

  function buildInput(): ItineraryItemInput | null {
    const customLabel = form.customLabel.trim();
    if (!customLabel && !form.tripPlaceId) {
      setFormError(t('minimumContentError'));
      return null;
    }
    if (form.schedule === 'exact' && !form.exactTime) {
      setFormError(t('exactTimeError'));
      return null;
    }
    const duration =
      form.timingMode === 'duration' && form.durationMinutes ? Number(form.durationMinutes) : null;
    const customDurationHasInput = Boolean(
      customDurationHours.trim() || customDurationMinutes.trim(),
    );
    if (duration !== null && (!Number.isInteger(duration) || duration <= 0)) {
      setFormError(t('durationError'));
      return null;
    }
    if (
      form.timingMode === 'duration' &&
      customDurationOpen &&
      customDurationHasInput &&
      duration === null
    ) {
      setFormError(t('durationError'));
      return null;
    }
    if (form.timingMode === 'end_time' && form.localEndTime) {
      if (form.schedule !== 'exact' || !form.exactTime) {
        setFormError(t('endTimeStartRequired'));
        return null;
      }
      if (form.localEndTime <= form.exactTime) {
        setFormError(t('endTimeError'));
        return null;
      }
    }
    const input: ItineraryItemInput = {
      customLabel: customLabel || null,
      durationMinutes: duration,
      localEndTime: form.timingMode === 'end_time' ? form.localEndTime || null : null,
      notes: form.notes.trim() || null,
      schedule:
        form.schedule === 'exact'
          ? { kind: 'exact', localTime: form.exactTime }
          : form.schedule === 'none'
            ? { kind: 'none' }
            : { dayPart: form.schedule, kind: 'day_part' },
      tripPlaceId: form.tripPlaceId || null,
    };

    // Omitted legacy fields survive an ordinary edit. A new identity must not
    // inherit an old custom location or item-level priority, though.
    Object.assign(input, itineraryIdentityLegacyPatch(identityChanged));

    return input;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = buildInput();
    if (!input || editor.mode !== 'edit') return;
    setSaving(true);
    setFormError(null);
    setTimeZoneConsequence(false);
    try {
      const result = await updateItineraryItem(tripId, editor.item.id, input);
      setTimeZoneConsequence(Boolean(result.timeZoneConsequence));
      await refresh();
      closeEditor();
    } catch (error) {
      setFormError(
        error instanceof ItineraryApiError && error.code === 'invalid_local_end_time'
          ? t('endTimeError')
          : t('saveError'),
      );
    } finally {
      setSaving(false);
    }
  }

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
      await organizeItineraryItem(tripId, item.id, { itineraryDayId, position });
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
   * Adds a Place straight onto the open day, unscheduled within it. Timing is the
   * traveller's to decide afterwards; getting it onto the day is the point of
   * having the collection beside the plan. Reached from the Places drawer and
   * from a map marker for a Place that is not on this day yet.
   */
  async function addTripPlaceToSelectedDay(tripPlaceId: string) {
    if (!selectedDay) return false;
    try {
      await createItineraryItem(tripId, {
        itineraryDayId: selectedDay.id,
        schedule: { kind: 'none' },
        tripPlaceId,
      });
      await refresh();
      return true;
    } catch {
      return false;
    }
  }

  function addPlaceToSelectedDay(tripPlace: TripPlace) {
    return addTripPlaceToSelectedDay(tripPlace.id);
  }

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
    setDaySettingsOpen(false);
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

  function changeOverviewDisplay(display: ItineraryOverviewDisplay) {
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
      {timeZoneConsequence ? (
        <Alert role="status" variant="info">
          <Clock3 aria-hidden="true" />
          <AlertDescription>{t('timeZoneConsequence')}</AlertDescription>
        </Alert>
      ) : null}
      {renderOverview ? (
        <div className={activeView === 'overview' ? 'contents' : 'hidden'}>
          <ItineraryOverview
            actions={
              <Button onClick={() => setPlacesDrawerOpen(true)} size="sm" variant="outline">
                <Icons.Places aria-hidden="true" data-icon="inline-start" />
                {tripPlacesTranslations('openPlaces')}
              </Button>
            }
            days={itinerary.days}
            display={overviewDisplay}
            locale={locale}
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
            resolveItemName={itemName}
            timeFormat={preferences.timeFormat}
            weather={weather}
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
                    onClick={() => setPlacesDrawerOpen(true)}
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
                  <DaySettingsMenu
                    canSuggestTimes={online && untimedItems(selectedDay).length > 0}
                    compact={compact}
                    dailyBaseSummary={dailyBaseSummary}
                    day={selectedDay}
                    onCompactChange={setCompactItinerary}
                    onDailyBaseChange={(tripPlaceId, departureTripPlaceId) =>
                      void handleDailyBase(selectedDay, tripPlaceId, departureTripPlaceId)
                    }
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
                    onMoveDay={(strategy) => openDayMove(selectedDay, strategy)}
                    onOpenChange={setDaySettingsOpen}
                    onSuggestTimes={() => setDayTimesOpen(true)}
                    open={daySettingsOpen}
                    placeName={placeName}
                    tripPlaces={alphabeticalTripPlaces}
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
              hero={heroImage}
              isToday={selectedRibbonDay?.isToday ?? false}
              note={selectedDay.notes}
              onNextDay={
                selectedIndex < itinerary.days.length - 1 ? () => selectAdjacentDay(1) : undefined
              }
              onOpenMap={openPhoneMap}
              onPreviousDay={selectedIndex > 0 ? () => selectAdjacentDay(-1) : undefined}
              onStayClick={() => setDaySettingsOpen(true)}
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
                    {routes?.segments.some((segment) => segment.mode === 'walk') ? (
                      <span className="text-muted-foreground">{t('routes.walkingBeta')}</span>
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
                attentionFor={(item) => {
                  const problems = dayProblems.byItem.get(item.id) ?? [];
                  const holidays = (hoursNotices?.notices ?? []).filter(
                    (notice) =>
                      notice.kind === 'holiday_check' &&
                      notice.dayId === selectedDay.id &&
                      notice.tripPlaceId === item.tripPlace?.id,
                  );
                  if (!problems.length && !holidays.length) return null;
                  return (
                    <>
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
                  dayOptions: itinerary.days.map((day, dayIndex) => ({
                    id: day.id,
                    label: dayOption(day, dayIndex),
                  })),
                  onDeleteItem: setItemToDelete,
                  onDuplicateItem: (item) => void handleDuplicate(item),
                  onEditItem: openEdit,
                  onMoveItem: (item, dayId, position) => void handleOrganize(item, dayId, position),
                  onPlacePriorityChange: (item, priority) =>
                    void changePlacePriority(item, priority),
                  onSelectItem: selectItemOnMap,
                  organizingItemId,
                  savingPriorityIds,
                  selectedDayId: selectedDay.id,
                  unscheduledLabel: t('unscheduled'),
                }}
                onModeChange={(segment, mode) => void handleRouteModeChange(segment, mode)}
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
                    selected: selectedMapItemId === item.id,
                  };
                }}
                routesStale={routes?.stale ?? false}
                savingRouteOwner={savingRouteOwner}
              />
            ) : (
              <PageState
                actions={
                  <Button onClick={() => openCreate(selectedDay)} variant="outline">
                    <Plus aria-hidden="true" data-icon="inline-start" />
                    {t('addFirstItem')}
                  </Button>
                }
                className="min-h-60 justify-center"
                description={t('emptyDescription')}
                headingLevel={2}
                icon={<Icons.Itinerary aria-hidden="true" />}
                title={t('emptyTitle')}
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

      {itinerary.unscheduledItems.length ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">
              {t('unscheduledSummary', { count: itinerary.unscheduledItems.length })}
            </h2>
            <p className="text-sm text-muted-foreground">{t('unscheduledDescription')}</p>
          </div>
          <ItemGroup aria-label={t('unscheduled')} variant="list">
            {itinerary.unscheduledItems.map((item) => {
              const name = itemName(item);
              const hasMapLocation = Boolean(item.tripPlace && placeLocation(item.tripPlace));
              const isMapSelected = selectedMapItemId === item.id;
              return (
                <Item
                  className={cn('relative px-3 py-3', isMapSelected && 'bg-secondary/70')}
                  id={`itinerary-item-${item.id}`}
                  key={item.id}
                  tabIndex={-1}
                >
                  <ItemMedia variant="icon">
                    <Icons.Itinerary aria-hidden="true" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      {hasMapLocation ? (
                        <button
                          aria-label={t('viewDetailsFor', { name })}
                          // The whole row opens the place, the same as a
                          // scheduled stop; the controls sit above the claim.
                          className="rounded-[var(--radius-sm)] text-left outline-none after:absolute after:inset-0 hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
                          onClick={() => openPlaceDetails(item.tripPlace)}
                          type="button"
                        >
                          {name}
                        </button>
                      ) : (
                        name
                      )}
                    </ItemTitle>
                    <ItemDescription>{item.notes}</ItemDescription>
                  </ItemContent>
                  <ItemActions className="relative z-10">
                    <Select
                      onValueChange={(value) =>
                        void handleOrganize(item, (value ?? null) as string | null, 999)
                      }
                    >
                      <SelectTrigger aria-label={t('scheduleItem', { name })} size="sm">
                        <SelectValue>{t('moveToDay')}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {itinerary.days.map((day, index) => (
                          <SelectItem key={day.id} value={day.id}>
                            {dayOption(day, index)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      aria-label={t('duplicateItem', { name })}
                      disabled={organizingItemId === item.id}
                      onClick={() => void handleDuplicate(item)}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <Copy aria-hidden="true" />
                    </Button>
                    <Button
                      aria-label={t('deleteItem', { name })}
                      onClick={() => setItemToDelete(item)}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </ItemActions>
                </Item>
              );
            })}
          </ItemGroup>
        </section>
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
            tripPlacesHref: `/trips/${tripId}/places`,
          }}
          title={dayOption(selectedDay, selectedIndex)}
        />
      ) : null}

      {placesDrawerOpen && selectedDay ? (
        <ItineraryPlacesDrawer
          anchors={dayAnchors}
          date={selectedDay.date}
          dayName={selectedDay.name}
          dayNumber={selectedIndex + 1}
          onAddToDay={addPlaceToSelectedDay}
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
          onOpenChange={setPlacesDrawerOpen}
          placeUse={placeUse}
          tripId={tripId}
        />
      ) : null}

      <Sheet open={editor.mode !== 'closed'} onOpenChange={(open) => !open && closeEditor()}>
        <SheetContent
          className="w-full md:data-[side=right]:w-[min(38rem,calc(100%-0.5rem))]"
          closeLabel={t('close')}
        >
          <SheetHeader className="border-b">
            <SheetTitle>{t('editTitle')}</SheetTitle>
            <SheetDescription>{t('editDescription')}</SheetDescription>
          </SheetHeader>
          {editor.mode !== 'closed' ? (
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <FieldGroup>
                  {formError ? (
                    <Alert role="alert" variant="destructive">
                      <CircleAlert aria-hidden="true" />
                      <AlertDescription>{formError}</AlertDescription>
                    </Alert>
                  ) : null}

                  {hasItemIdentity ? (
                    <div className="rounded-[var(--radius-lg)] border bg-muted/30 p-3">
                      <div className="flex items-center gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-background text-muted-foreground shadow-xs">
                          {form.tripPlaceId ? (
                            <Icons.Place aria-hidden="true" className="size-4" />
                          ) : (
                            <NotebookPen aria-hidden="true" className="size-4" />
                          )}
                        </div>
                        <div className="flex min-h-9 min-w-0 flex-1 flex-col justify-center">
                          <p className="truncate text-sm font-medium">
                            {form.customLabel || selectedPlaceName}
                          </p>
                          {form.customLabel && selectedPlaceName ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {t('linkedPlace', { place: selectedPlaceName })}
                            </p>
                          ) : selectedTripPlace?.place.snapshot?.address ||
                            selectedTripPlace?.place.providerAddress ? (
                            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                              {selectedTripPlace.place.snapshot?.address ??
                                selectedTripPlace.place.providerAddress}
                            </p>
                          ) : null}
                          {selectedTripPlace?.priority ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {t('inheritedPriority', {
                                priority: tripPlacesTranslations(
                                  `priority.${selectedTripPlace.priority}`,
                                ),
                              })}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            aria-label={t('changeIdentity')}
                            onClick={() => setIdentityPickerOpen(true)}
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            {t('change')}
                          </Button>
                          <Button
                            aria-label={t('clearIdentity')}
                            onClick={clearIdentity}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <X aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {!hasItemIdentity || identityPickerOpen ? (
                    <Field>
                      <FieldLabel htmlFor="itinerary-place-or-plan">{t('placeOrPlan')}</FieldLabel>
                      <Combobox<PlacePickerOption>
                        disabled={selectingPlace}
                        filteredItems={placePickerOptions}
                        inputValue={placeQuery}
                        items={placePickerOptions}
                        itemToStringLabel={(option) =>
                          !option
                            ? ''
                            : option.kind === 'provider'
                              ? option.suggestion.name
                              : option.label
                        }
                        onInputValueChange={(value) => handlePlaceQueryChange(value)}
                        onValueChange={(option) => selectPlacePickerOption(option)}
                      >
                        <ComboboxInput
                          autoComplete="off"
                          autoFocus={!hasItemIdentity}
                          className="h-11 w-full min-w-0 rounded-[var(--radius-md)] border border-input bg-background py-2 text-base shadow-[var(--shadow-control)] md:text-sm"
                          clearLabel={t('clearPlaceQuery')}
                          id="itinerary-place-or-plan"
                          placeholder={t('placeOrPlanPlaceholder')}
                          showClear={Boolean(placeQuery)}
                          triggerLabel={t('openPlacePicker')}
                        />
                        <ComboboxContent>
                          <ComboboxEmpty>{t('placePickerEmpty')}</ComboboxEmpty>
                          <ComboboxList>
                            {(option) => (
                              <ComboboxItem
                                className={cn(
                                  'min-h-12 gap-3 px-3 py-2 pr-9',
                                  option.kind === 'provider' && 'bg-muted/25',
                                  option.kind === 'trip_place' &&
                                    option.usageLabel &&
                                    'bg-brand/5 data-highlighted:bg-brand/10',
                                )}
                                key={
                                  option.kind === 'trip_place'
                                    ? option.tripPlace.id
                                    : option.kind === 'provider'
                                      ? option.suggestion.externalPlaceId
                                      : `custom-${option.label}`
                                }
                                value={option}
                              >
                                {option.kind === 'trip_place' ? (
                                  <Icons.Place
                                    aria-hidden="true"
                                    className="text-muted-foreground"
                                  />
                                ) : option.kind === 'custom_label' ? (
                                  <NotebookPen
                                    aria-hidden="true"
                                    className="text-muted-foreground"
                                  />
                                ) : (
                                  <Search aria-hidden="true" className="text-muted-foreground" />
                                )}
                                <span className="min-w-0 flex-1">
                                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                                    <span className="min-w-0 truncate">
                                      {option.kind === 'custom_label'
                                        ? t('useCustomPlan', { label: option.label })
                                        : option.kind === 'provider'
                                          ? option.suggestion.name
                                          : option.label}
                                    </span>
                                    {option.kind === 'trip_place' && option.usageLabel ? (
                                      <Badge className="max-w-44" size="sm">
                                        <Icons.Success aria-hidden="true" className="size-3" />
                                        <span className="truncate">{option.usageLabel}</span>
                                      </Badge>
                                    ) : null}
                                  </span>
                                  {option.kind === 'trip_place' &&
                                  (option.tripPlace.place.snapshot?.address ||
                                    option.tripPlace.place.providerAddress) ? (
                                    <span className="block truncate text-xs text-muted-foreground">
                                      {option.tripPlace.place.snapshot?.address ??
                                        option.tripPlace.place.providerAddress}
                                    </span>
                                  ) : option.kind === 'provider' &&
                                    option.suggestion.description ? (
                                    <span className="block truncate text-xs text-muted-foreground">
                                      {option.suggestion.description}
                                    </span>
                                  ) : null}
                                </span>
                              </ComboboxItem>
                            )}
                          </ComboboxList>
                          {placeQuery.trim() ? (
                            <div className="space-y-2 border-t p-2">
                              {visibleProviderResults.length ? (
                                <p className="px-1 text-right text-xs font-normal tracking-normal text-muted-foreground">
                                  <span translate="no">{t('googleMapsAttribution')}</span>
                                </p>
                              ) : placeSearchStatus === 'loading' ? (
                                <p className="px-1 text-xs text-muted-foreground" role="status">
                                  {t('searchingPlaces')}
                                </p>
                              ) : placeSearchStatus === 'unavailable' ? (
                                <p className="px-1 text-xs text-muted-foreground" role="status">
                                  {t('providerSearchUnavailable')}
                                </p>
                              ) : providerQueryCached ? (
                                <p className="px-1 text-xs text-muted-foreground" role="status">
                                  {t('googleSearchEmpty')}
                                </p>
                              ) : !online ? (
                                <p className="px-1 text-xs text-muted-foreground">
                                  {t('googleSearchOffline')}
                                </p>
                              ) : placeQuery.trim().length < 3 ? (
                                <p className="px-1 text-xs text-muted-foreground">
                                  {t('googleSearchMinimum')}
                                </p>
                              ) : (
                                <Button
                                  className="w-full justify-start"
                                  onClick={() => void searchGooglePlaces()}
                                  size="sm"
                                  type="button"
                                  variant="ghost"
                                >
                                  <Search aria-hidden="true" />
                                  {t('searchGoogle', { query: placeQuery.trim() })}
                                </Button>
                              )}
                            </div>
                          ) : null}
                        </ComboboxContent>
                      </Combobox>
                      <FieldDescription>{t('placeOrPlanHint')}</FieldDescription>
                      {hasItemIdentity ? (
                        <Button
                          className="self-start px-0"
                          onClick={() => {
                            setIdentityPickerOpen(false);
                            setPlaceQuery('');
                            currentPlaceQuery.current = '';
                            clearProviderResultState();
                          }}
                          size="sm"
                          type="button"
                          variant="link"
                        >
                          {t('keepCurrentIdentity')}
                        </Button>
                      ) : null}
                    </Field>
                  ) : null}

                  {hasItemIdentity ? (
                    <>
                      {!timingExpanded ? (
                        <Button
                          className="w-full justify-start"
                          onClick={() => setTimingExpanded(true)}
                          type="button"
                          variant="outline"
                        >
                          <Clock3 aria-hidden="true" />
                          {t('addTiming')}
                        </Button>
                      ) : (
                        <Field className="rounded-[var(--radius-lg)] border p-4">
                          <div className="flex items-center justify-between gap-3">
                            <FieldLabel>{t('scheduleLabel')}</FieldLabel>
                            <Button onClick={removeTiming} size="sm" type="button" variant="ghost">
                              <X aria-hidden="true" />
                              {t('removeTiming')}
                            </Button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {(['anytime', 'morning', 'afternoon', 'evening', 'exact'] as const).map(
                              (value) => (
                                <Button
                                  aria-pressed={form.schedule === value}
                                  key={value}
                                  onClick={() =>
                                    setForm((current) => ({
                                      ...current,
                                      ...(value !== 'exact' && current.timingMode === 'end_time'
                                        ? {
                                            durationMinutes: '',
                                            localEndTime: '',
                                            timingMode: 'duration' as const,
                                          }
                                        : {}),
                                      schedule: value,
                                    }))
                                  }
                                  size="sm"
                                  type="button"
                                  variant={form.schedule === value ? 'secondary' : 'outline'}
                                >
                                  {t(`schedule.${value}`)}
                                </Button>
                              ),
                            )}
                          </div>
                          {form.schedule === 'exact' ? (
                            <div className="space-y-2">
                              <FieldLabel htmlFor="itinerary-exact-time">
                                {t('exactTime')}
                              </FieldLabel>
                              <TimeInput
                                aria-describedby="itinerary-exact-time-hint"
                                id="itinerary-exact-time"
                                onValueChange={(value) => updateForm('exactTime', value)}
                                required
                                value={form.exactTime}
                              />
                              <FieldDescription id="itinerary-exact-time-hint">
                                {t('localTimeHint')}
                              </FieldDescription>
                            </div>
                          ) : null}
                          {canSuggestTime && editor.mode === 'edit' && editor.dayId ? (
                            <SuggestedTimeAction
                              loading={suggestedTime.loading}
                              message={suggestedTime.message}
                              onRequest={() =>
                                void suggestedTime.request({
                                  dayId: editor.dayId,
                                  itemId: editor.item.id,
                                  schedule: form.schedule,
                                })
                              }
                            />
                          ) : null}
                        </Field>
                      )}

                      <Field>
                        <FieldLabel>{t('durationQuestion')}</FieldLabel>
                        <FieldDescription>{t('durationHint')}</FieldDescription>
                        <div
                          aria-label={t('timingModeLabel')}
                          className="flex flex-wrap gap-2"
                          role="group"
                        >
                          <Button
                            aria-pressed={form.timingMode === 'duration'}
                            onClick={() =>
                              setForm((current) => ({
                                ...current,
                                localEndTime: '',
                                timingMode: 'duration',
                              }))
                            }
                            size="sm"
                            type="button"
                            variant={form.timingMode === 'duration' ? 'secondary' : 'outline'}
                          >
                            {t('durationMode')}
                          </Button>
                          <Button
                            aria-pressed={form.timingMode === 'end_time'}
                            disabled={form.schedule !== 'exact' || !form.exactTime}
                            onClick={() => {
                              setForm((current) => ({
                                ...current,
                                durationMinutes: '',
                                timingMode: 'end_time',
                              }));
                              setCustomDurationOpen(false);
                              setCustomDurationHours('');
                              setCustomDurationMinutes('');
                            }}
                            size="sm"
                            type="button"
                            variant={form.timingMode === 'end_time' ? 'secondary' : 'outline'}
                          >
                            {t('endTimeMode')}
                          </Button>
                        </div>
                        {form.timingMode === 'duration' ? (
                          <>
                            <div className="flex flex-wrap gap-2">
                              {ITINERARY_DURATION_PRESETS.map((minutes) => (
                                <Button
                                  aria-pressed={form.durationMinutes === minutes.toString()}
                                  key={minutes}
                                  onClick={() => chooseDurationPreset(minutes)}
                                  size="sm"
                                  type="button"
                                  variant={
                                    form.durationMinutes === minutes.toString()
                                      ? 'secondary'
                                      : 'outline'
                                  }
                                >
                                  {t(`durationPreset.${minutes}`)}
                                </Button>
                              ))}
                              <Button
                                aria-pressed={customDurationOpen}
                                onClick={showCustomDuration}
                                size="sm"
                                type="button"
                                variant={customDurationOpen ? 'secondary' : 'outline'}
                              >
                                {t('customDuration')}
                              </Button>
                              {form.durationMinutes ? (
                                <Button
                                  aria-label={t('clearDuration')}
                                  onClick={() => {
                                    updateForm('durationMinutes', '');
                                    setCustomDurationOpen(false);
                                    setCustomDurationHours('');
                                    setCustomDurationMinutes('');
                                  }}
                                  size="icon-sm"
                                  type="button"
                                  variant="ghost"
                                >
                                  <X aria-hidden="true" />
                                </Button>
                              ) : null}
                            </div>
                            {customDurationOpen ? (
                              <div className="grid grid-cols-2 gap-3 rounded-[var(--radius-lg)] bg-muted/40 p-3">
                                <Field>
                                  <FieldLabel htmlFor="itinerary-duration-hours">
                                    {t('hours')}
                                  </FieldLabel>
                                  <Input
                                    id="itinerary-duration-hours"
                                    inputMode="numeric"
                                    min="0"
                                    onChange={(event) =>
                                      updateCustomDuration('hours', event.target.value)
                                    }
                                    type="number"
                                    value={customDurationHours}
                                  />
                                </Field>
                                <Field>
                                  <FieldLabel htmlFor="itinerary-duration-minutes">
                                    {t('minutes')}
                                  </FieldLabel>
                                  <Input
                                    id="itinerary-duration-minutes"
                                    inputMode="numeric"
                                    max="59"
                                    min="0"
                                    onChange={(event) =>
                                      updateCustomDuration('minutes', event.target.value)
                                    }
                                    type="number"
                                    value={customDurationMinutes}
                                  />
                                </Field>
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <div className="space-y-2">
                            <FieldLabel htmlFor="itinerary-end-time">{t('endTime')}</FieldLabel>
                            <TimeInput
                              aria-describedby="itinerary-end-time-hint"
                              aria-invalid={Boolean(
                                form.localEndTime && form.localEndTime <= form.exactTime,
                              )}
                              id="itinerary-end-time"
                              onValueChange={(value) => updateForm('localEndTime', value)}
                              value={form.localEndTime}
                            />
                            <FieldDescription id="itinerary-end-time-hint">
                              {t('endTimeHint')}
                            </FieldDescription>
                          </div>
                        )}
                      </Field>

                      <Field>
                        <FieldLabel htmlFor="itinerary-notes">{t('notes')}</FieldLabel>
                        <Textarea
                          id="itinerary-notes"
                          maxLength={5_000}
                          onChange={(event) => updateForm('notes', event.target.value)}
                          placeholder={t('notesPlaceholder')}
                          value={form.notes}
                        />
                      </Field>
                    </>
                  ) : null}
                </FieldGroup>
              </div>
              <SheetFooter className="sm:flex-row sm:items-center sm:justify-between">
                <Button
                  onClick={() => setItemToDelete(editor.item)}
                  type="button"
                  variant="destructive"
                >
                  <Trash2 aria-hidden="true" data-icon="inline-start" />
                  {t('deleteItem')}
                </Button>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button disabled={saving} onClick={closeEditor} type="button" variant="outline">
                    {t('cancel')}
                  </Button>
                  <Button disabled={saving || selectingPlace || !hasItemIdentity} type="submit">
                    {saving ? t('saving') : t('save')}
                  </Button>
                </div>
              </SheetFooter>
            </form>
          ) : null}
        </SheetContent>
      </Sheet>

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

      {createDay ? (
        <ItineraryCreateItemSheet
          dayId={createDay.id}
          onCreated={refresh}
          onOpenChange={(open) => !open && setCreateDay(null)}
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
          open
          placeUse={placeUse}
          tripId={tripId}
          tripPlaces={itinerary?.tripPlaces ?? []}
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
