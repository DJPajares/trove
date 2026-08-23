'use client';

import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  ExternalLink,
  List,
  Map as MapIcon,
  MapPinned,
  NotebookPen,
  Pencil,
  Plus,
  Ellipsis,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { PageState } from '@/components/page-state';
import { ItineraryPlanningMap } from '@/components/itinerary-planning-map';
import {
  ItineraryRouteSegmentRow,
  ItineraryRouteSummary,
} from '@/components/itinerary-route-details';
import { ItineraryPlacesDrawer } from '@/components/itinerary-places-drawer';
import { PlanScorePanel } from '@/components/plan-score-panel';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usePreferences } from '@/components/preferences-provider';
import { TimeInput } from '@/components/time-input';
import { TripSectionHeader } from '@/components/trip-section-header';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsIndicator, TabsList, TabsTab } from '@/components/ui/tabs';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  fetchItineraryDayTimeSuggestions,
  type Itinerary,
  ItineraryApiError,
  type ItineraryDay,
  type ItineraryDayRoutes,
  type ItineraryDayTimeSuggestion,
  type ItineraryItem,
  type ItineraryItemInput,
  type ItineraryRouteSegment,
  type ItineraryTripPlace,
  type RouteTravelMode,
  organizeItineraryItem,
  moveItineraryDayPlan,
  setItineraryDayBase,
  updateItineraryDayNote,
  updateItineraryDayRouteMode,
  updateItineraryItem,
  updateItineraryItemRouteMode,
} from '@/lib/itinerary/api';
import { useOnlineStatus } from '@/components/trip-sync-status';
import { dayStopNumbers, resolveDailyBases } from '@/lib/itinerary/day-sequence';
import { scheduledPlaceUse } from '@/lib/itinerary/places';
import { itineraryDayRouteRevision, itineraryPlanScoreRevision } from '@/lib/itinerary/routes';
import {
  buildItineraryMapPoints,
  dailyBasePoints,
  type ItineraryMapPoint,
} from '@/lib/maps/itinerary-map';
import { useInViewOnce } from '@/lib/plan-score/use-in-view-once';
import { useTripPlanScore } from '@/lib/plan-score/use-trip-plan-score';
import {
  googleMapsPlaceHref,
  type ProviderSuggestion,
  resolveProviderPlace,
  searchProviderPlaces,
} from '@/lib/saved/api';
import { addTripPlace, type TripPlace } from '@/lib/trip-places/api';
import { sortTripPlaces } from '@/lib/trip-places/sort';
import { cn } from '@/lib/utils';
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

type EditorState =
  | { dayId: null; item: null; mode: 'closed' }
  | { dayId: string; item: null; mode: 'create' }
  | { dayId: string; item: ItineraryItem; mode: 'edit' };

type FormState = {
  customLabel: string;
  durationMinutes: string;
  exactTime: string;
  notes: string;
  schedule: 'afternoon' | 'anytime' | 'evening' | 'exact' | 'morning' | 'none';
  tripPlaceId: string;
};

function createFormState(item: ItineraryItem | null): FormState {
  return {
    customLabel: item?.customLabel ?? '',
    durationMinutes: item?.durationMinutes?.toString() ?? '',
    exactTime: item?.localStartTime ?? '',
    notes: item?.notes ?? '',
    schedule: item?.localStartTime ? 'exact' : (item?.dayPart ?? 'none'),
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

function ItineraryPlanScore({
  onSelectReference,
  revision,
  selectedDayId,
  tripId,
}: Readonly<{
  onSelectReference: (reference: string) => void;
  revision: string;
  selectedDayId: string | null;
  tripId: string;
}>) {
  const planScoreTranslations = useTranslations('planScore');
  const { hasBeenVisible: planScoreVisible, ref: planScoreSentinelRef } =
    useInViewOnce<HTMLDivElement>();
  const planScore = useTripPlanScore(planScoreVisible ? tripId : null, revision);
  const planScoreDay = planScore.data?.days.find((day) => day.dayId === selectedDayId) ?? null;
  const planScoreHidden =
    planScore.status === 'disabled' ||
    Boolean(planScore.data?.withheldReasons.includes('ADMINISTRATIVELY_DISABLED'));

  return (
    <>
      <div aria-hidden="true" className="h-px" ref={planScoreSentinelRef} />
      {!planScoreHidden && (planScoreDay || planScore.status === 'error') ? (
        <PlanScorePanel
          className="mt-4"
          completeness={planScoreDay?.completeness ?? null}
          confidence={planScoreDay?.confidence ?? null}
          disabled={planScoreDay?.withheldReasons.includes('ADMINISTRATIVELY_DISABLED')}
          explanations={
            planScoreDay?.explanations ?? {
              uncertainty: [],
              whatWorks: [],
              worthImproving: [],
            }
          }
          factors={planScoreDay?.factors}
          onRetry={planScore.retry}
          onSelectReference={onSelectReference}
          score={planScoreDay?.score ?? null}
          scope="day"
          status={planScore.status}
          title={planScoreTranslations('dayTitle')}
        />
      ) : null}
    </>
  );
}

export function ItineraryManager({
  planScoreEnabled,
  tripId,
}: Readonly<{ planScoreEnabled: boolean; tripId: string }>) {
  const t = useTranslations('itinerary');
  const tripPlacesTranslations = useTranslations('tripPlaces');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedDayId = searchParams.get('day');
  const { preferences } = usePreferences();
  const online = useOnlineStatus();
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const [status, setStatus] = useState<'error' | 'idle' | 'loading'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>({ dayId: null, item: null, mode: 'closed' });
  const [form, setForm] = useState<FormState>(() => createFormState(null));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<ItineraryItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [dayNoteEditor, setDayNoteEditor] = useState<ItineraryDay | null>(null);
  const [daySettingsOpen, setDaySettingsOpen] = useState(false);
  const [dayNoteValue, setDayNoteValue] = useState('');
  const [savingDayNote, setSavingDayNote] = useState(false);
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
  const [suggestedTime, setSuggestedTime] = useState<ItineraryDayTimeSuggestion | null>(null);
  const [suggestedTimeStatus, setSuggestedTimeStatus] = useState<'error' | 'idle' | 'loading'>(
    'idle',
  );
  const suggestedTimeRequest = useRef<AbortController | null>(null);
  const providerSearchRequest = useRef<AbortController | null>(null);
  const providerSearchRequestQuery = useRef<string | null>(null);
  const providerSearchCache = useRef(new Map<string, ProviderSearchCacheEntry>());
  const currentPlaceQuery = useRef('');
  const [selectingPlace, setSelectingPlace] = useState(false);
  const [organizingItemId, setOrganizingItemId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list');
  const [selectedMapPointId, setSelectedMapPointId] = useState<string | null>(null);
  const [selectedMapItemId, setSelectedMapItemId] = useState<string | null>(null);
  const [routeSnapshot, setRouteSnapshot] = useState<{
    data: ItineraryDayRoutes;
    includesPolylines: boolean;
    revision: string;
  } | null>(null);
  const [routeStatus, setRouteStatus] = useState<'error' | 'idle' | 'loading'>('loading');
  const [savingRouteOwner, setSavingRouteOwner] = useState<string | null>(null);
  const [placesDrawerOpen, setPlacesDrawerOpen] = useState(false);
  const desktopMapLayout = useDesktopMapLayout();

  // The URL seeds the first selection and then follows it. Reading it on every
  // refresh instead would undo a manual day switch on the next mutation.
  const initialDayIdRef = useRef(requestedDayId);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const next = await fetchItinerary(tripId);
      setItinerary(next);
      setSelectedDayId((current) => {
        const preferred = current ?? initialDayIdRef.current;
        return preferred && next.days.some((day) => day.id === preferred)
          ? preferred
          : (next.days[0]?.id ?? null);
      });
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  }, [tripId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Which day you are planning is part of where you are, so a reload, a shared
  // link, and the back button all land on the same day you left.
  useEffect(() => {
    if (!selectedDayId || requestedDayId === selectedDayId) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('day', selectedDayId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, requestedDayId, router, searchParams, selectedDayId]);

  const selectedDay = useMemo(
    () => itinerary?.days.find((day) => day.id === selectedDayId) ?? null,
    [itinerary, selectedDayId],
  );
  const dayMoveSource = useMemo(
    () => itinerary?.days.find((day) => day.id === dayMoveSourceId) ?? null,
    [dayMoveSourceId, itinerary],
  );
  const dayMoveTarget = useMemo(
    () => itinerary?.days.find((day) => day.id === dayMoveTargetId) ?? null,
    [dayMoveTargetId, itinerary],
  );
  const routeRevision = itineraryDayRouteRevision(selectedDay);
  const includeRoutePolylines = desktopMapLayout === true || mobileView === 'map';
  const routes = routeSnapshot?.revision === routeRevision ? routeSnapshot.data : null;
  const routePolylines = useMemo(
    () =>
      routes?.segments
        .map((segment) => segment.encodedPolyline)
        .filter((polyline): polyline is string => Boolean(polyline)) ?? [],
    [routes],
  );

  useEffect(() => {
    if (!selectedDay) {
      setRouteSnapshot(null);
      setRouteStatus('idle');
      return;
    }
    if (desktopMapLayout === null) return;
    if (
      routeSnapshot?.revision === routeRevision &&
      (!includeRoutePolylines || routeSnapshot.includesPolylines)
    ) {
      setRouteStatus('idle');
      return;
    }

    const controller = new AbortController();
    setRouteStatus('loading');
    void fetchItineraryDayRoutes(tripId, selectedDay.id, {
      includePolyline: includeRoutePolylines,
      languageCode: locale,
      revision: routeRevision,
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        setRouteSnapshot({
          data: result,
          includesPolylines: includeRoutePolylines,
          revision: routeRevision,
        });
        setRouteStatus('idle');
      })
      .catch(() => {
        if (!controller.signal.aborted) setRouteStatus('error');
      });

    return () => controller.abort();
  }, [
    desktopMapLayout,
    includeRoutePolylines,
    locale,
    routeRevision,
    routeSnapshot,
    selectedDay,
    tripId,
  ]);
  const planScoreRevision = useMemo(() => itineraryPlanScoreRevision(itinerary), [itinerary]);
  const focusItineraryItem = useCallback((reference: string) => {
    setSelectedMapItemId(reference);
    document.getElementById(`itinerary-item-${reference}`)?.focus();
  }, []);
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
  const tripPlaceById = (tripPlaceId: string | null) =>
    tripPlaceId
      ? (itinerary?.tripPlaces.find((tripPlace) => tripPlace.id === tripPlaceId) ?? null)
      : null;
  const arrivalBase = tripPlaceById(dailyBases.arrivalTripPlaceId);
  const departureBase = tripPlaceById(dailyBases.departureTripPlaceId);
  const alphabeticalTripPlaces = useMemo(
    () =>
      sortTripPlaces(
        itinerary?.tripPlaces ?? [],
        'name',
        (tripPlace) => placeName(tripPlace) ?? t('providerPlace'),
      ),
    [itinerary?.tripPlaces, t],
  );

  const mapPoints = useMemo(() => {
    if (!itinerary || !selectedDay) return [];
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
  }, [dailyBases, itinerary, placeUse, selectedDay, selectedIndex, stopNumbers, t]);

  /**
   * A base is a stop of the day, so it reads like one: numbered in travel order,
   * named, and selectable on the map when it has a location. What it does not get
   * is an actions menu — where a day starts and ends is changed in day settings,
   * not by editing a stop.
   */
  function baseStopRow(
    tripPlace: ItineraryTripPlace,
    role: 'arrival' | 'departure',
    order: number,
  ) {
    const name = placeName(tripPlace) ?? t('providerPlace');
    const point = mapPoints.find(
      (candidate) => candidate.kind === 'base' && candidate.tripPlaceId === tripPlace.id,
    );
    const isMapSelected = Boolean(point && selectedMapPointId === point.id);
    return (
      <Item
        className={cn('px-3 py-3', isMapSelected && 'bg-secondary/70')}
        key={`base-${role}`}
        role="listitem"
      >
        {/* Squared off and outlined, the way the map draws a base, so the two
            readings of the same stop look like the same stop. */}
        <ItemMedia
          className={cn(
            'size-10 rounded-[var(--radius-md)] border-2 text-sm font-semibold tabular-nums',
            point
              ? 'border-primary bg-card text-primary'
              : 'border-border bg-muted text-muted-foreground',
          )}
        >
          <span className="sr-only">{t('stopNumber', { number: order })}</span>
          <span aria-hidden="true">{order}</span>
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="text-base">
            {point ? (
              <button
                aria-label={t('map.showItem', { name })}
                aria-pressed={isMapSelected}
                className="rounded-[var(--radius-sm)] text-left outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
                onClick={() => selectBaseOnMap(tripPlace.id)}
                type="button"
              >
                {name}
              </button>
            ) : (
              name
            )}
          </ItemTitle>
          <ItemDescription className="line-clamp-none">
            {role === 'arrival' ? t('dayBaseStartDescription') : t('dayBaseEndDescription')}
          </ItemDescription>
        </ItemContent>
      </Item>
    );
  }

  function selectBaseOnMap(tripPlaceId: string) {
    const point = mapPoints.find(
      (candidate) => candidate.kind === 'base' && candidate.tripPlaceId === tripPlaceId,
    );
    if (!point) return;
    setSelectedMapPointId(point.id);
    setSelectedMapItemId(null);
    if (!desktopMapLayout) setMobileView('map');
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

  const clearMapSelection = useCallback(() => {
    setSelectedMapPointId(null);
    setSelectedMapItemId(null);
  }, []);

  function scrollToItem(itemId: string, focus = false) {
    window.requestAnimationFrame(() => {
      const element = document.getElementById(`itinerary-item-${itemId}`);
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (focus) element?.focus({ preventScroll: true });
    });
  }

  function selectItemOnMap(item: ItineraryItem) {
    if (!item.tripPlace || !placeLocation(item.tripPlace)) return;
    setSelectedMapPointId(item.tripPlace.id);
    setSelectedMapItemId(item.id);
    if (!desktopMapLayout) setMobileView('map');
  }

  function handleMapPointSelection(point: ItineraryMapPoint) {
    setSelectedMapPointId(point.id);
    setSelectedMapItemId(point.itemId);
    if (desktopMapLayout && point.itemId) scrollToItem(point.itemId);
  }

  function viewMapItem(itemId: string) {
    setSelectedMapItemId(itemId);
    if (!desktopMapLayout) setMobileView('list');
    scrollToItem(itemId, true);
  }

  function openCreate(day: ItineraryDay) {
    setForm(createFormState(null));
    setFormError(null);
    setPlaceQuery('');
    currentPlaceQuery.current = '';
    setProviderResults([]);
    setProviderSessionToken(null);
    setPlaceSearchStatus('idle');
    setIdentityChanged(false);
    setIdentityPickerOpen(true);
    setTimingExpanded(false);
    setCustomDurationOpen(false);
    setCustomDurationHours('');
    setCustomDurationMinutes('');
    providerSearchRequest.current?.abort();
    providerSearchRequest.current = null;
    providerSearchRequestQuery.current = null;
    providerSearchCache.current = new Map();
    suggestedTimeRequest.current?.abort();
    setSuggestedTime(null);
    setSuggestedTimeStatus('idle');
    setEditor({ dayId: day.id, item: null, mode: 'create' });
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
      Boolean(item.durationMinutes && !isDurationPreset(item.durationMinutes.toString())),
    );
    const parts = durationParts(item.durationMinutes?.toString() ?? '');
    setCustomDurationHours(parts.hours);
    setCustomDurationMinutes(parts.minutes);
    providerSearchRequest.current?.abort();
    providerSearchRequest.current = null;
    providerSearchRequestQuery.current = null;
    providerSearchCache.current = new Map();
    suggestedTimeRequest.current?.abort();
    setSuggestedTime(null);
    setSuggestedTimeStatus('idle');
    setEditor({ dayId: item.itineraryDayId, item, mode: 'edit' });
  }

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
    suggestedTimeRequest.current?.abort();
    setSuggestedTime(null);
    setSuggestedTimeStatus('idle');
  }

  function updateForm<Key extends keyof FormState>(key: Key, value: FormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError(null);
  }

  /**
   * Fills the time field with Trove's proposal and nothing else. The value is
   * form state until the user saves, so abandoning the editor discards it
   * (PRD section 29.4).
   */
  async function requestSuggestedTime() {
    if (editor.mode !== 'edit' || !editor.dayId) return;

    suggestedTimeRequest.current?.abort();
    const controller = new AbortController();
    suggestedTimeRequest.current = controller;
    setSuggestedTime(null);
    setSuggestedTimeStatus('loading');

    try {
      const response = await fetchItineraryDayTimeSuggestions(tripId, editor.dayId, {
        itemId: editor.item.id,
        // The choice on screen, not the one on disk, so a daypart the user just
        // picked shapes the answer instead of being contradicted by it.
        schedule: form.schedule,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

      const suggestion = response.suggestions[0] ?? null;
      setSuggestedTime(suggestion);
      setSuggestedTimeStatus('idle');

      if (suggestion?.status === 'ok' && suggestion.localTime) {
        updateForm('exactTime', suggestion.localTime);
        // A daypart is what constrained the proposal, so accepting it means
        // committing to the time the field now shows.
        setForm((current) => ({ ...current, schedule: 'exact' }));
      }
    } catch {
      if (!controller.signal.aborted) setSuggestedTimeStatus('error');
    }
  }

  // Editing only: a new item has no id or position for the day to reason about.
  // Offline only hides it, because the proposal needs live route and provider
  // evidence and a queued read would help nobody.
  const canSuggestTime = editor.mode === 'edit' && online;

  const suggestedTimeMessage = useMemo(() => {
    if (suggestedTimeStatus === 'loading') return t('suggestedTime.loading');
    if (suggestedTimeStatus === 'error') return t('suggestedTime.unavailable');
    if (!suggestedTime) return '';
    if (suggestedTime.status === 'no_feasible_time') return t('suggestedTime.none');
    if (suggestedTime.status === 'insufficient_evidence') {
      // Section 29.4: say it cannot, without itemising what was missing.
      return t('suggestedTime.unavailable');
    }

    // The last constraint that actually moved the clock explains the answer
    // best. The day start is only a floor, and the following-item check
    // validates the time rather than setting it.
    const moved = suggestedTime.reasons.filter(
      (reason) => reason.code !== 'DAY_START' && reason.code !== 'BEFORE_FIXED_ITEM',
    );
    const reason = moved.at(-1);
    const caveat = suggestedTime.caveats[0];

    return [
      reason ? t(`suggestedTime.reason.${reason.code}`) : t('suggestedTime.applied'),
      caveat ? t(`suggestedTime.caveat.${caveat}`) : null,
    ]
      .filter(Boolean)
      .join(' ');
  }, [suggestedTime, suggestedTimeStatus, t]);

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
    setForm((current) => ({ ...current, exactTime: '', schedule: 'none' }));
    setTimingExpanded(false);
    setSuggestedTime(null);
    setSuggestedTimeStatus('idle');
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
    const duration = form.durationMinutes ? Number(form.durationMinutes) : null;
    const customDurationHasInput = Boolean(
      customDurationHours.trim() || customDurationMinutes.trim(),
    );
    if (duration !== null && (!Number.isInteger(duration) || duration <= 0)) {
      setFormError(t('durationError'));
      return null;
    }
    if (customDurationOpen && customDurationHasInput && duration === null) {
      setFormError(t('durationError'));
      return null;
    }
    const input: ItineraryItemInput = {
      customLabel: customLabel || null,
      durationMinutes: duration,
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
    if (editor.mode === 'edit') Object.assign(input, itineraryIdentityLegacyPatch(identityChanged));

    return input;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = buildInput();
    if (!input || editor.mode === 'closed') return;
    setSaving(true);
    setFormError(null);
    setTimeZoneConsequence(false);
    try {
      if (editor.mode === 'create') {
        await createItineraryItem(tripId, { ...input, itineraryDayId: editor.dayId });
      } else {
        const result = await updateItineraryItem(tripId, editor.item.id, input);
        setTimeZoneConsequence(Boolean(result.timeZoneConsequence));
      }
      await refresh();
      closeEditor();
    } catch {
      setFormError(t('saveError'));
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
    setOrganizingItemId(item.id);
    setError(null);
    try {
      await duplicateItineraryItem(tripId, item.id);
      await refresh();
    } catch {
      setError(t('organizeError'));
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

  function openDayMove(day: ItineraryDay) {
    setDaySettingsOpen(false);
    setDayMoveSourceId(day.id);
    setDayMoveTargetId('');
    setDayMoveStrategy('append');
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

  if (status === 'loading') {
    return (
      <PageState
        className="mx-auto max-w-5xl"
        kind="loading"
        loadingShape="timeline"
        title={t('loading')}
      />
    );
  }
  if (status === 'error' || !itinerary) {
    return (
      <PageState
        actions={<Button onClick={() => void refresh()}>{t('tryAgain')}</Button>}
        className="mx-auto max-w-5xl"
        description={t('loadErrorDescription')}
        icon={<CircleAlert aria-hidden="true" />}
        kind="error"
        title={t('loadError')}
      />
    );
  }

  return (
    <section className="mx-auto w-full max-w-5xl space-y-7">
      <TripSectionHeader
        actions={
          <Button onClick={() => setPlacesDrawerOpen(true)} variant="outline">
            <MapPinned aria-hidden="true" data-icon="inline-start" />
            {tripPlacesTranslations('openPlaces')}
          </Button>
        }
        currentSection="itinerary"
        description={t('description')}
        tripId={tripId}
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
      {itinerary.unscheduledItems.length ? (
        <Alert variant="default">
          <CalendarClock aria-hidden="true" />
          <AlertDescription>
            {t('unscheduledSummary', { count: itinerary.unscheduledItems.length })}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-center gap-2 md:hidden">
        <Button
          aria-label={t('previousDay')}
          disabled={selectedIndex <= 0}
          onClick={() => selectAdjacentDay(-1)}
          size="icon"
          variant="outline"
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Select onValueChange={(value) => setSelectedDayId(value)} value={selectedDayId}>
          <SelectTrigger aria-label={t('chooseDay')} className="min-w-0 flex-1">
            <SelectValue>
              {selectedDay
                ? t('dayOption', {
                    date: formatDate(selectedDay.date),
                    number: selectedIndex + 1,
                  })
                : t('chooseDay')}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            {itinerary.days.map((day, index) => (
              <SelectItem key={day.id} value={day.id}>
                {/* How full a day is decides which day you want next, so the
                    dropdown carries the count the desktop rail already shows. */}
                <span className="flex w-full items-center justify-between gap-3">
                  <span>{t('dayOption', { date: formatDate(day.date), number: index + 1 })}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {t('dayItemCount', { count: day.items.length })}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          aria-label={t('nextDay')}
          disabled={selectedIndex < 0 || selectedIndex >= itinerary.days.length - 1}
          onClick={() => selectAdjacentDay(1)}
          size="icon"
          variant="outline"
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>

      <div className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-[var(--shadow-surface)] md:grid md:min-h-[34rem] md:grid-cols-[15rem_minmax(0,1fr)]">
        <nav
          aria-label={t('dayNavigation')}
          className="relative hidden border-r border-border md:block"
        >
          {/* Filled rather than stretched: absolute content adds nothing to the grid
              row, so a long trip's day list scrolls inside the panel instead of
              making the rail taller than the day being planned beside it. */}
          <div className="flex flex-col md:absolute md:inset-0">
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-semibold">{t('days')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('dayCount', { count: itinerary.days.length })}
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {itinerary.days.map((day, index) => {
                const active = day.id === selectedDayId;
                return (
                  <button
                    aria-current={active ? 'date' : undefined}
                    className={cn(
                      'flex min-h-14 w-full items-center justify-between gap-3 rounded-[var(--radius-md)] px-3 py-2 text-left transition-colors duration-[var(--motion-standard)] outline-none focus-visible:ring-3 focus-visible:ring-ring/40',
                      active ? 'bg-secondary text-secondary-foreground' : 'hover:bg-surface-hover',
                    )}
                    key={day.id}
                    onClick={() => setSelectedDayId(day.id)}
                    type="button"
                  >
                    <span>
                      <span className="block text-xs text-muted-foreground">
                        {t('dayNumber', { number: index + 1 })}
                      </span>
                      <span className="block text-sm font-medium">{formatDate(day.date)}</span>
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {day.items.length}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </nav>

        {selectedDay ? (
          <div className="min-w-0">
            <div className="flex flex-col gap-4 border-b border-border px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
              <div className="min-w-0">
                {/* The day picker above already carries the date; this is the heading
                    for the day being planned, not a second copy of it. */}
                <h2 className="text-lg font-semibold tracking-tight">
                  {formatDate(selectedDay.date, true)}
                </h2>
                {selectedDay.notes ? (
                  <p className="mt-1.5 max-w-2xl whitespace-pre-wrap text-sm leading-6 text-text-subtle">
                    {selectedDay.notes}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button onClick={() => openCreate(selectedDay)}>
                  <Plus aria-hidden="true" data-icon="inline-start" />
                  {t('addItem')}
                </Button>
                <Popover onOpenChange={setDaySettingsOpen} open={daySettingsOpen}>
                  <PopoverTrigger
                    render={
                      <Button
                        aria-label={t('daySettings')}
                        size="icon"
                        type="button"
                        variant="ghost"
                      />
                    }
                  >
                    <Settings2 aria-hidden="true" />
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-80 space-y-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">{t('daySettings')}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {t('dayTimeZone', { timeZone: selectedDay.defaultTimeZone })}
                      </p>
                      {selectedDay.defaultTimeZoneSource === 'accommodation' &&
                      selectedDay.defaultTimeZoneSourceTripPlaceId ? (
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {t('accommodationBase', {
                            name:
                              placeName(
                                itinerary.tripPlaces.find(
                                  (place) =>
                                    place.id === selectedDay.defaultTimeZoneSourceTripPlaceId,
                                ) ?? null,
                              ) ?? t('accommodationBaseUnnamed'),
                          })}
                        </p>
                      ) : null}
                    </div>

                    <div className="space-y-2 border-t border-border pt-3">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          {t('dailyBase')}
                        </p>
                        <p className="mt-0.5 text-xs leading-5 text-muted-foreground/80">
                          {t('dailyBaseHelp')}
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-xs text-muted-foreground">{t('dailyBaseArrival')}</p>
                        <Select
                          onValueChange={(value) =>
                            void handleDailyBase(selectedDay, value === 'none' ? null : value)
                          }
                          value={selectedDay.dailyBaseTripPlaceId ?? 'none'}
                        >
                          <SelectTrigger
                            aria-label={t('dailyBaseArrival')}
                            className="w-full"
                            size="sm"
                          >
                            <SelectValue>
                              {selectedDay.dailyBaseTripPlaceId
                                ? placeName(
                                    itinerary.tripPlaces.find(
                                      (place) => place.id === selectedDay.dailyBaseTripPlaceId,
                                    ) ?? null,
                                  )
                                : t('noDailyBase')}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent align="end">
                            <SelectItem value="none">{t('noDailyBase')}</SelectItem>
                            {alphabeticalTripPlaces.map((place) => (
                              <SelectItem key={place.id} value={place.id}>
                                {placeName(place)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-xs text-muted-foreground">{t('dailyBaseDeparture')}</p>
                        <Select
                          onValueChange={(value) =>
                            void handleDailyBase(
                              selectedDay,
                              selectedDay.dailyBaseTripPlaceId,
                              value === 'same' ? null : value,
                            )
                          }
                          value={selectedDay.dailyBaseDepartureTripPlaceId ?? 'same'}
                        >
                          <SelectTrigger
                            aria-label={t('dailyBaseDeparture')}
                            className="w-full"
                            size="sm"
                          >
                            <SelectValue>
                              {selectedDay.dailyBaseDepartureTripPlaceId
                                ? placeName(
                                    itinerary.tripPlaces.find(
                                      (place) =>
                                        place.id === selectedDay.dailyBaseDepartureTripPlaceId,
                                    ) ?? null,
                                  )
                                : t('dailyBaseSameAsArrival')}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent align="end">
                            <SelectItem value="same">{t('dailyBaseSameAsArrival')}</SelectItem>
                            {alphabeticalTripPlaces.map((place) => (
                              <SelectItem key={place.id} value={place.id}>
                                {placeName(place)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <Button
                      className="w-full"
                      onClick={() => {
                        setDaySettingsOpen(false);
                        setDayNoteEditor(selectedDay);
                        setDayNoteValue(selectedDay.notes ?? '');
                      }}
                      variant="outline"
                    >
                      <NotebookPen aria-hidden="true" data-icon="inline-start" />
                      {selectedDay.notes ? t('editDayNote') : t('addDayNote')}
                    </Button>
                    {selectedDay.items.length ? (
                      <Button
                        className="w-full"
                        onClick={() => openDayMove(selectedDay)}
                        variant="outline"
                      >
                        <CalendarClock aria-hidden="true" data-icon="inline-start" />
                        {t('dayMove.action')}
                      </Button>
                    ) : null}
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <ItineraryRouteSummary
              data={routes}
              distanceUnit={preferences.distanceUnit}
              locale={locale}
              status={routeStatus}
            />

            <Tabs
              onValueChange={(value) => setMobileView(value as 'list' | 'map')}
              value={mobileView}
            >
              <TabsList
                aria-label={t('map.viewNavigation')}
                className="grid w-full grid-cols-2 lg:hidden"
              >
                <TabsTab
                  aria-controls="itinerary-list-panel"
                  className="gap-2"
                  id="itinerary-list-tab"
                  value="list"
                >
                  <List aria-hidden="true" data-icon="inline-start" />
                  {t('map.listView')}
                </TabsTab>
                <TabsTab
                  aria-controls="itinerary-map-panel"
                  className="gap-2"
                  id="itinerary-map-tab"
                  value="map"
                >
                  <MapIcon aria-hidden="true" data-icon="inline-start" />
                  {t('map.mapView')}
                </TabsTab>
                <TabsIndicator />
              </TabsList>
            </Tabs>

            <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.9fr)]">
              <div
                aria-labelledby="itinerary-list-tab"
                className={cn('p-4 sm:p-6', mobileView === 'map' && 'hidden lg:block')}
                id="itinerary-list-panel"
                role="tabpanel"
                tabIndex={mobileView === 'list' ? 0 : -1}
              >
                {selectedDay.items.length ? (
                  <ItemGroup aria-label={t('itemListLabel')} variant="list">
                    {arrivalBase && stopNumbers.arrival
                      ? baseStopRow(arrivalBase, 'arrival', stopNumbers.arrival)
                      : null}
                    {selectedDay.items.map((item, itemIndex) => {
                      const name = itemName(item);
                      const mapsHref = item.tripPlace
                        ? googleMapsPlaceHref(item.tripPlace.place)
                        : null;
                      const hasMapLocation = Boolean(
                        item.tripPlace && placeLocation(item.tripPlace),
                      );
                      const isMapSelected = selectedMapItemId === item.id;
                      const incomingRoute = routes?.segments.find(
                        (segment) =>
                          segment.destination.kind === 'itinerary_item' &&
                          segment.destination.id === item.id,
                      );
                      return [
                        incomingRoute ? (
                          <ItineraryRouteSegmentRow
                            distanceUnit={preferences.distanceUnit}
                            key={`route-${incomingRoute.id}`}
                            locale={locale}
                            onModeChange={(segment, mode) =>
                              void handleRouteModeChange(segment, mode)
                            }
                            saving={
                              savingRouteOwner ===
                              `${incomingRoute.modeOwner.kind}:${incomingRoute.modeOwner.id}`
                            }
                            segment={incomingRoute}
                            stale={routes?.stale ?? false}
                          />
                        ) : null,
                        <Item
                          className={cn('px-3 py-3', isMapSelected && 'bg-secondary/70')}
                          id={`itinerary-item-${item.id}`}
                          key={item.id}
                          role="listitem"
                          tabIndex={-1}
                        >
                          {/* The same number the map draws in its circle, so a pin and
                              a row can be matched at a glance. An item with no location
                              has no pin to match, and says so by not looking like one. */}
                          <ItemMedia
                            className={cn(
                              'size-10 rounded-full text-sm font-semibold tabular-nums',
                              hasMapLocation
                                ? 'bg-primary text-primary-foreground'
                                : 'border border-border bg-muted text-muted-foreground',
                            )}
                          >
                            <span className="sr-only">
                              {t('stopNumber', { number: itemIndex + 1 + stopNumbers.itemOffset })}
                            </span>
                            <span aria-hidden="true">{itemIndex + 1 + stopNumbers.itemOffset}</span>
                          </ItemMedia>
                          <ItemContent className="min-w-0">
                            <ItemTitle className="text-base">
                              {hasMapLocation ? (
                                <button
                                  aria-label={t('map.showItem', { name })}
                                  aria-pressed={isMapSelected}
                                  className="rounded-[var(--radius-sm)] text-left outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
                                  onClick={() => selectItemOnMap(item)}
                                  type="button"
                                >
                                  {name}
                                </button>
                              ) : (
                                name
                              )}
                            </ItemTitle>
                            <ItemDescription className="line-clamp-none">
                              <span className="flex flex-wrap gap-x-2 gap-y-1">
                                <span>
                                  {item.localStartTime
                                    ? item.timeZone && item.timeZone !== selectedDay.defaultTimeZone
                                      ? t('exactTimeWithTimeZone', {
                                          time: item.localStartTime,
                                          timeZone: item.timeZone,
                                        })
                                      : t('exactTimeValue', { time: item.localStartTime })
                                    : item.dayPart
                                      ? t(`schedule.${item.dayPart}`)
                                      : t('schedule.none')}
                                </span>
                                {item.durationMinutes ? (
                                  <span>
                                    {t('durationValue', { minutes: item.durationMinutes })}
                                  </span>
                                ) : null}
                                {item.plannedCost ? (
                                  <span>
                                    {t('costValue', {
                                      amount: item.plannedCost.amount,
                                      currency: item.plannedCost.currencyCode,
                                    })}
                                  </span>
                                ) : null}
                                {item.customLocation ? (
                                  <span>{item.customLocation.label}</span>
                                ) : null}
                              </span>
                              {item.notes ? (
                                <span className="mt-1 block line-clamp-2">{item.notes}</span>
                              ) : null}
                            </ItemDescription>
                          </ItemContent>
                          <ItemActions className="ml-auto shrink-0">
                            {/* One menu instead of seven controls: the row is content,
                                not a toolbar, and this behaves the same without hover. */}
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button
                                    aria-label={t('itemActions', { name })}
                                    disabled={organizingItemId === item.id}
                                    size="icon-sm"
                                    type="button"
                                    variant="ghost"
                                  />
                                }
                              >
                                <Ellipsis aria-hidden="true" />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="min-w-48">
                                <DropdownMenuItem
                                  disabled={itemIndex === 0}
                                  onClick={() =>
                                    void handleOrganize(item, selectedDay.id, itemIndex - 1)
                                  }
                                >
                                  <ArrowUp aria-hidden="true" />
                                  {t('itemMenu.moveEarlier')}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={itemIndex === selectedDay.items.length - 1}
                                  onClick={() =>
                                    void handleOrganize(item, selectedDay.id, itemIndex + 1)
                                  }
                                >
                                  <ArrowDown aria-hidden="true" />
                                  {t('itemMenu.moveLater')}
                                </DropdownMenuItem>

                                <DropdownMenuSub>
                                  <DropdownMenuSubTrigger>
                                    <CalendarClock aria-hidden="true" />
                                    {t('moveToDay')}
                                  </DropdownMenuSubTrigger>
                                  <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                                    <DropdownMenuRadioGroup
                                      onValueChange={(value) =>
                                        void handleOrganize(
                                          item,
                                          value === 'unscheduled' ? null : value,
                                          999,
                                        )
                                      }
                                      value={selectedDay.id}
                                    >
                                      {itinerary.days.map((day, dayIndex) => (
                                        <DropdownMenuRadioItem key={day.id} value={day.id}>
                                          {t('dayOption', {
                                            date: formatDate(day.date),
                                            number: dayIndex + 1,
                                          })}
                                        </DropdownMenuRadioItem>
                                      ))}
                                      <DropdownMenuRadioItem value="unscheduled">
                                        {t('unscheduled')}
                                      </DropdownMenuRadioItem>
                                    </DropdownMenuRadioGroup>
                                  </DropdownMenuSubContent>
                                </DropdownMenuSub>

                                <DropdownMenuSeparator />

                                <DropdownMenuItem onClick={() => openEdit(item)}>
                                  <Pencil aria-hidden="true" />
                                  {t('itemMenu.edit')}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => void handleDuplicate(item)}>
                                  <Copy aria-hidden="true" />
                                  {t('itemMenu.duplicate')}
                                </DropdownMenuItem>
                                {mapsHref ? (
                                  <DropdownMenuLinkItem
                                    render={<a href={mapsHref} rel="noreferrer" target="_blank" />}
                                  >
                                    <ExternalLink aria-hidden="true" />
                                    {t('itemMenu.openPlace')}
                                  </DropdownMenuLinkItem>
                                ) : null}

                                <DropdownMenuSeparator />

                                <DropdownMenuItem
                                  onClick={() => setItemToDelete(item)}
                                  variant="destructive"
                                >
                                  <Trash2 aria-hidden="true" />
                                  {t('itemMenu.delete')}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </ItemActions>
                        </Item>,
                      ];
                    })}
                    {routes?.segments
                      .filter((segment) => segment.destination.kind === 'daily_base')
                      .map((segment) => (
                        <ItineraryRouteSegmentRow
                          distanceUnit={preferences.distanceUnit}
                          key={segment.id}
                          locale={locale}
                          onModeChange={(routeSegment, mode) =>
                            void handleRouteModeChange(routeSegment, mode)
                          }
                          saving={
                            savingRouteOwner === `${segment.modeOwner.kind}:${segment.modeOwner.id}`
                          }
                          segment={segment}
                          stale={routes?.stale ?? false}
                        />
                      ))}
                    {departureBase && stopNumbers.departure
                      ? baseStopRow(departureBase, 'departure', stopNumbers.departure)
                      : null}
                  </ItemGroup>
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
                    icon={<CalendarClock aria-hidden="true" />}
                    title={t('emptyTitle')}
                  />
                )}
                {planScoreEnabled ? (
                  <ItineraryPlanScore
                    onSelectReference={focusItineraryItem}
                    revision={planScoreRevision}
                    selectedDayId={selectedDayId}
                    tripId={tripId}
                  />
                ) : null}
              </div>

              <aside
                aria-label={t('map.regionLabel')}
                className={cn(
                  'min-w-0 border-border lg:block lg:border-l',
                  mobileView === 'list' && 'hidden',
                )}
                id="itinerary-map-panel"
                role="tabpanel"
                tabIndex={mobileView === 'map' ? 0 : -1}
              >
                {desktopMapLayout || mobileView === 'map' ? (
                  <ItineraryPlanningMap
                    onAddToDay={(point) => addTripPlaceToSelectedDay(point.tripPlaceId)}
                    onClearSelection={clearMapSelection}
                    onSelectPoint={handleMapPointSelection}
                    onViewItem={viewMapItem}
                    points={mapPoints}
                    routePolylines={routePolylines}
                    selectedPointId={selectedMapPointId}
                  />
                ) : (
                  <div aria-hidden="true" className="hidden min-h-[34rem] bg-muted/40 lg:block" />
                )}
              </aside>
            </div>
          </div>
        ) : null}
      </div>

      {itinerary.unscheduledItems.length ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">{t('unscheduled')}</h2>
            <p className="text-sm text-muted-foreground">{t('unscheduledDescription')}</p>
          </div>
          <ItemGroup aria-label={t('unscheduled')} variant="list">
            {itinerary.unscheduledItems.map((item) => {
              const name = itemName(item);
              const hasMapLocation = Boolean(item.tripPlace && placeLocation(item.tripPlace));
              const isMapSelected = selectedMapItemId === item.id;
              return (
                <Item
                  className={cn('px-3 py-3', isMapSelected && 'bg-secondary/70')}
                  id={`itinerary-item-${item.id}`}
                  key={item.id}
                  tabIndex={-1}
                >
                  <ItemMedia variant="icon">
                    <CalendarClock aria-hidden="true" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      {hasMapLocation ? (
                        <button
                          aria-label={t('map.showItem', { name })}
                          aria-pressed={isMapSelected}
                          className="rounded-[var(--radius-sm)] text-left outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
                          onClick={() => selectItemOnMap(item)}
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
                  <ItemActions>
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
                            {t('dayOption', { date: formatDate(day.date), number: index + 1 })}
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

      {placesDrawerOpen && selectedDay ? (
        <ItineraryPlacesDrawer
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
            <SheetTitle>{editor.mode === 'edit' ? t('editTitle') : t('createTitle')}</SheetTitle>
            <SheetDescription>
              {editor.mode === 'edit' ? t('editDescription') : t('createDescription')}
            </SheetDescription>
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
                      <div className="flex items-start gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-background text-muted-foreground shadow-xs">
                          {form.tripPlaceId ? (
                            <MapPinned aria-hidden="true" className="size-4" />
                          ) : (
                            <NotebookPen aria-hidden="true" className="size-4" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
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
                          id="itinerary-place-or-plan"
                          placeholder={t('placeOrPlanPlaceholder')}
                          showClear={Boolean(placeQuery)}
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
                                  <MapPinned aria-hidden="true" className="text-muted-foreground" />
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
                                        <CheckCircle2 aria-hidden="true" className="size-3" />
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
                                  onClick={() => updateForm('schedule', value)}
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
                          {canSuggestTime ? (
                            <>
                              <Button
                                aria-busy={suggestedTimeStatus === 'loading'}
                                aria-describedby="itinerary-suggested-time-status"
                                className="self-start"
                                disabled={suggestedTimeStatus === 'loading'}
                                onClick={() => void requestSuggestedTime()}
                                size="sm"
                                type="button"
                                variant="outline"
                              >
                                <Sparkles aria-hidden="true" />
                                {t('suggestedTime.action')}
                              </Button>
                              <p
                                aria-live="polite"
                                className="text-sm text-muted-foreground"
                                id="itinerary-suggested-time-status"
                                role="status"
                              >
                                {suggestedTimeMessage}
                              </p>
                            </>
                          ) : null}
                        </Field>
                      )}

                      <Field>
                        <FieldLabel>{t('durationQuestion')}</FieldLabel>
                        <FieldDescription>{t('durationHint')}</FieldDescription>
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
                {editor.mode === 'edit' ? (
                  <Button
                    onClick={() => setItemToDelete(editor.item)}
                    type="button"
                    variant="destructive"
                  >
                    <Trash2 aria-hidden="true" data-icon="inline-start" />
                    {t('deleteItem')}
                  </Button>
                ) : (
                  <span />
                )}
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button disabled={saving} onClick={closeEditor} type="button" variant="outline">
                    {t('cancel')}
                  </Button>
                  <Button disabled={saving || selectingPlace || !hasItemIdentity} type="submit">
                    {saving ? t('saving') : editor.mode === 'edit' ? t('save') : t('addItem')}
                  </Button>
                </div>
              </SheetFooter>
            </form>
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog
        open={Boolean(dayMoveSource)}
        onOpenChange={(open) => {
          if (!open && !movingDay) {
            setDayMoveSourceId(null);
            setDayMoveError(null);
          }
        }}
      >
        <DialogContent closeLabel={t('close')}>
          {dayMoveSource ? (
            <form className="space-y-6" onSubmit={handleDayMove}>
              <DialogHeader>
                <DialogTitle>{t('dayMove.title')}</DialogTitle>
                <DialogDescription>
                  {t('dayMove.description', {
                    count: dayMoveSource.items.length,
                    date: formatDate(dayMoveSource.date, true),
                  })}
                </DialogDescription>
              </DialogHeader>

              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="itinerary-day-move-target">
                    {t('dayMove.targetLabel')}
                  </FieldLabel>
                  <Select
                    onValueChange={(value) => {
                      setDayMoveTargetId(value ?? '');
                      setDayMoveStrategy('append');
                      setDayMoveError(null);
                    }}
                    value={dayMoveTargetId}
                  >
                    <SelectTrigger id="itinerary-day-move-target" className="w-full">
                      <SelectValue>
                        {dayMoveTarget
                          ? t('dayMove.targetOption', {
                              count: dayMoveTarget.items.length,
                              date: formatDate(dayMoveTarget.date),
                              number:
                                itinerary.days.findIndex(({ id }) => id === dayMoveTarget.id) + 1,
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
                              date: formatDate(day.date),
                              number: index + 1,
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

              <DialogFooter>
                <Button
                  disabled={movingDay}
                  onClick={() => setDayMoveSourceId(null)}
                  type="button"
                  variant="outline"
                >
                  {t('cancel')}
                </Button>
                <Button disabled={movingDay || !dayMoveTarget} type="submit">
                  {movingDay ? t('dayMove.moving') : t('dayMove.confirm')}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(dayNoteEditor)}
        onOpenChange={(open) => {
          if (!open && !savingDayNote) setDayNoteEditor(null);
        }}
      >
        <DialogContent closeLabel={t('close')}>
          <form className="space-y-6" onSubmit={handleDayNoteSave}>
            <DialogHeader>
              <DialogTitle>{t('dayNoteTitle')}</DialogTitle>
              <DialogDescription>
                {t('dayNoteDescription', {
                  date: dayNoteEditor ? formatDate(dayNoteEditor.date, true) : '',
                })}
              </DialogDescription>
            </DialogHeader>
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
            <DialogFooter>
              <Button
                disabled={savingDayNote}
                onClick={() => setDayNoteEditor(null)}
                type="button"
                variant="outline"
              >
                {t('cancel')}
              </Button>
              <Button disabled={savingDayNote} type="submit">
                {savingDayNote ? t('saving') : t('saveDayNote')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
    </section>
  );
}
