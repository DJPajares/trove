'use client';

import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  ChevronDown,
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
  Trash2,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { PageState } from '@/components/page-state';
import { ItineraryPlanningMap } from '@/components/itinerary-planning-map';
import {
  ItineraryRouteSegmentRow,
  ItineraryRouteSummary,
} from '@/components/itinerary-route-details';
import { CurrencyCombobox } from '@/components/currency-combobox';
import { MoneyInput } from '@/components/money-input';
import { ItineraryPlacesDrawer } from '@/components/itinerary-places-drawer';
import { PlaceDetailSheet } from '@/components/place-detail-sheet';
import { PlanScorePanel } from '@/components/plan-score-panel';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usePreferences } from '@/components/preferences-provider';
import { SearchField } from '@/components/search-field';
import { TimeInput } from '@/components/time-input';
import { TripSectionHeader } from '@/components/trip-section-header';
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
  type Itinerary,
  type ItineraryDay,
  type ItineraryDayRoutes,
  type ItineraryItem,
  type ItineraryItemInput,
  type ItineraryRouteSegment,
  type ItineraryTripPlace,
  type RouteTravelMode,
  organizeItineraryItem,
  setItineraryDayBase,
  updateItineraryDayNote,
  updateItineraryDayRouteMode,
  updateItineraryItem,
  updateItineraryItemRouteMode,
} from '@/lib/itinerary/api';
import { scheduledPlaceUse } from '@/lib/itinerary/places';
import { buildItineraryMapPoints, type ItineraryMapPoint } from '@/lib/maps/itinerary-map';
import { useTripPlanScore } from '@/lib/plan-score/use-trip-plan-score';
import {
  cacheProviderPlaceDetails,
  getCachedProviderPlaceDetails,
  getProviderPlaceDetails,
  GOOGLE_PLACES_SEARCH_DEBOUNCE_MS,
  type ProviderPlaceDetails,
  type ProviderSuggestion,
  resolveProviderPlace,
  searchProviderPlaces,
} from '@/lib/saved/api';
import { addTripPlace, type TripPlace } from '@/lib/trip-places/api';
import { cn } from '@/lib/utils';

type EditorState =
  | { dayId: null; item: null; mode: 'closed' }
  | { dayId: string; item: null; mode: 'create' }
  | { dayId: string; item: ItineraryItem; mode: 'edit' };

type FormState = {
  costAmount: string;
  costCurrency: string;
  customLabel: string;
  customLocation: string;
  customLocationTimeZone: string;
  durationMinutes: string;
  exactTime: string;
  notes: string;
  priority: '' | 'interested' | 'maybe' | 'must_go';
  schedule: 'afternoon' | 'anytime' | 'evening' | 'exact' | 'morning' | 'none';
  tripPlaceId: string;
};

function createFormState(
  item: ItineraryItem | null,
  preferredCurrency: string | null = null,
): FormState {
  return {
    costAmount: item?.plannedCost?.amount ?? '',
    costCurrency: item?.plannedCost?.currencyCode ?? preferredCurrency ?? '',
    customLabel: item?.customLabel ?? '',
    customLocation: item?.customLocation?.label ?? '',
    customLocationTimeZone: item?.customLocation?.timeZone ?? '',
    durationMinutes: item?.durationMinutes?.toString() ?? '',
    exactTime: item?.localStartTime ?? '',
    notes: item?.notes ?? '',
    priority: item?.priority ?? '',
    schedule: item?.localStartTime ? 'exact' : (item?.dayPart ?? 'none'),
    tripPlaceId: item?.tripPlace?.id ?? '',
  };
}

function googleMapsHref(tripPlace: ItineraryTripPlace) {
  const providerId = tripPlace.place.providerRefs[0]?.externalPlaceId;
  return providerId
    ? `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(providerId)}`
    : null;
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

export function ItineraryManager({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('itinerary');
  const planScoreTranslations = useTranslations('planScore');
  const tripPlacesTranslations = useTranslations('tripPlaces');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const requestedDayId = searchParams.get('day');
  const { preferredCurrency, preferences } = usePreferences();
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
  const [dayNoteValue, setDayNoteValue] = useState('');
  const [savingDayNote, setSavingDayNote] = useState(false);
  const [timeZoneConsequence, setTimeZoneConsequence] = useState(false);
  const [providerDetails, setProviderDetails] = useState<
    Record<string, ProviderPlaceDetails | null | undefined>
  >({});
  const [placeQuery, setPlaceQuery] = useState('');
  const [providerResults, setProviderResults] = useState<ProviderSuggestion[]>([]);
  const [placeSearchStatus, setPlaceSearchStatus] = useState<'idle' | 'loading' | 'unavailable'>(
    'idle',
  );
  const [selectingPlace, setSelectingPlace] = useState(false);
  const [organizingItemId, setOrganizingItemId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list');
  const [selectedMapPointId, setSelectedMapPointId] = useState<string | null>(null);
  const [selectedMapItemId, setSelectedMapItemId] = useState<string | null>(null);
  const [detailTripPlaceId, setDetailTripPlaceId] = useState<string | null>(null);
  const [routeSnapshot, setRouteSnapshot] = useState<{
    data: ItineraryDayRoutes;
    includesPolylines: boolean;
    revision: string;
  } | null>(null);
  const [routeStatus, setRouteStatus] = useState<'error' | 'idle' | 'loading'>('loading');
  const [savingRouteOwner, setSavingRouteOwner] = useState<string | null>(null);
  const [placesDrawerOpen, setPlacesDrawerOpen] = useState(false);
  const [showAdvancedDaySettings, setShowAdvancedDaySettings] = useState(false);
  const desktopMapLayout = useDesktopMapLayout();

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const next = await fetchItinerary(tripId);
      setItinerary(next);
      setSelectedDayId((current) =>
        next.days.some((day) => day.id === requestedDayId)
          ? requestedDayId
          : current && next.days.some((day) => day.id === current)
            ? current
            : (next.days[0]?.id ?? null),
      );
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  }, [requestedDayId, tripId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!itinerary) return;
    const pending = itinerary.tripPlaces.filter(
      (tripPlace) =>
        tripPlace.place.kind === 'provider' &&
        providerDetails[tripPlace.place.id] === undefined &&
        tripPlace.place.providerRefs[0],
    );
    if (!pending.length) return;
    let active = true;
    void Promise.all(
      pending.map(async (tripPlace) => {
        const cached = getCachedProviderPlaceDetails(tripPlace.place.id);
        if (cached) return { details: cached, placeId: tripPlace.place.id };
        const providerId = tripPlace.place.providerRefs[0]?.externalPlaceId;
        if (!providerId) return { details: null, placeId: tripPlace.place.id };
        try {
          const result = await getProviderPlaceDetails(providerId);
          const details = result.status === 'ok' ? (result.place ?? null) : null;
          if (details) cacheProviderPlaceDetails(tripPlace.place.id, details);
          return {
            details,
            placeId: tripPlace.place.id,
          };
        } catch {
          return { details: null, placeId: tripPlace.place.id };
        }
      }),
    ).then((results) => {
      if (!active) return;
      setProviderDetails((current) => ({
        ...current,
        ...Object.fromEntries(results.map((result) => [result.placeId, result.details])),
      }));
    });
    return () => {
      active = false;
    };
  }, [itinerary, providerDetails]);

  useEffect(() => {
    const query = placeQuery.trim();
    if (!query || editor.mode === 'closed') {
      setProviderResults([]);
      setPlaceSearchStatus('idle');
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setPlaceSearchStatus('loading');
      void searchProviderPlaces(query, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          setProviderResults(result.status === 'ok' ? result.suggestions : []);
          setPlaceSearchStatus(result.status === 'unavailable' ? 'unavailable' : 'idle');
        })
        .catch(() => !controller.signal.aborted && setPlaceSearchStatus('unavailable'));
    }, GOOGLE_PLACES_SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [editor.mode, placeQuery]);

  const selectedDay = useMemo(
    () => itinerary?.days.find((day) => day.id === selectedDayId) ?? null,
    [itinerary, selectedDayId],
  );
  const routeRevision = selectedDay
    ? [
        selectedDay.id,
        selectedDay.dailyBaseTripPlaceId,
        selectedDay.routeStartTravelMode,
        ...selectedDay.items.flatMap((item) => [
          item.id,
          item.position,
          item.tripPlace?.id ?? '',
          item.travelModeToNext,
          item.updatedAt,
        ]),
      ].join(':')
    : '';
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
  const planScoreRevision = useMemo(
    () =>
      (itinerary?.days ?? [])
        .flatMap((day) => [
          day.id,
          day.dailyBaseTripPlaceId ?? '',
          day.routeStartTravelMode,
          ...day.items.flatMap((item) => [
            item.id,
            String(item.position),
            item.tripPlace?.id ?? '',
            item.travelModeToNext ?? '',
            item.updatedAt,
          ]),
        ])
        .join(':'),
    [itinerary],
  );
  const planScore = useTripPlanScore(itinerary ? tripId : null, planScoreRevision);
  const planScoreDay = planScore.data?.days.find((day) => day.dayId === selectedDayId) ?? null;
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
  const formatDate = (date: string, long = false) =>
    (long ? longDateFormatter : dateFormatter).format(new Date(`${date}T00:00:00.000Z`));

  function placeName(tripPlace: ItineraryTripPlace | null) {
    if (!tripPlace) return null;
    if (tripPlace.place.kind === 'custom') return tripPlace.place.name ?? t('customPlace');
    const details = providerDetails[tripPlace.place.id];
    return details === undefined
      ? t('providerPlaceLoading')
      : (details?.name ?? t('providerPlace'));
  }

  function itemName(item: ItineraryItem) {
    return item.customLabel ?? placeName(item.tripPlace) ?? t('untitledItem');
  }

  function placeLocation(tripPlace: ItineraryTripPlace) {
    return tripPlace.place.location ?? providerDetails[tripPlace.place.id]?.location ?? null;
  }

  const mapPoints = useMemo(() => {
    if (!itinerary || !selectedDay) return [];
    return buildItineraryMapPoints({
      itinerary,
      resolveItemName: itemName,
      resolvePlaceLocation: placeLocation,
      resolvePlaceName: (tripPlace) => placeName(tripPlace) ?? t('providerPlace'),
      selectedDay,
    });
  }, [itinerary, providerDetails, selectedDay, t]);

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
    setForm(createFormState(null, preferredCurrency));
    setFormError(null);
    setPlaceQuery('');
    setEditor({ dayId: day.id, item: null, mode: 'create' });
  }

  function openEdit(item: ItineraryItem) {
    if (!item.itineraryDayId) return;
    setForm(createFormState(item));
    setFormError(null);
    setEditor({ dayId: item.itineraryDayId, item, mode: 'edit' });
  }

  function closeEditor() {
    setEditor({ dayId: null, item: null, mode: 'closed' });
    setFormError(null);
    setPlaceQuery('');
  }

  function updateForm<Key extends keyof FormState>(key: Key, value: FormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError(null);
  }

  const matchingTripPlaces = useMemo(() => {
    const query = placeQuery.trim().toLocaleLowerCase();
    if (!query) return itinerary?.tripPlaces ?? [];
    return (itinerary?.tripPlaces ?? []).filter((tripPlace) =>
      [placeName(tripPlace), providerDetails[tripPlace.place.id]?.formattedAddress]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase().includes(query)),
    );
  }, [itinerary?.tripPlaces, placeQuery, providerDetails]);

  async function selectProviderPlace(suggestion: ProviderSuggestion) {
    setSelectingPlace(true);
    try {
      const { place } = await resolveProviderPlace(suggestion.externalPlaceId);
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
                      id: tripPlace.id,
                      note: tripPlace.note,
                      place: {
                        id: tripPlace.place.id,
                        kind: tripPlace.place.kind,
                        location: tripPlace.place.location,
                        name: tripPlace.place.name,
                        note: tripPlace.place.note,
                        providerRefs: tripPlace.place.providerRefs,
                        timeZone: tripPlace.place.location?.timeZone ?? null,
                      },
                      priority: tripPlace.priority,
                    },
                  ],
            }
          : current,
      );
      updateForm('tripPlaceId', tripPlace.id);
      setPlaceQuery('');
    } catch {
      setFormError(t('placeSelectionError'));
    } finally {
      setSelectingPlace(false);
    }
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
    if (duration !== null && (!Number.isInteger(duration) || duration <= 0)) {
      setFormError(t('durationError'));
      return null;
    }
    const costAmount = form.costAmount.trim();
    const costCurrency = form.costCurrency.trim().toUpperCase();
    if (costAmount && !/^[A-Z]{3}$/.test(costCurrency)) {
      setFormError(t('plannedCostError'));
      return null;
    }
    const customLocation = form.customLocation.trim();
    if (!customLocation && form.customLocationTimeZone.trim()) {
      setFormError(t('customLocationError'));
      return null;
    }

    return {
      customLabel: customLabel || null,
      customLocation: customLocation
        ? {
            label: customLocation,
            timeZone: form.customLocationTimeZone.trim() || null,
          }
        : null,
      durationMinutes: duration,
      notes: form.notes.trim() || null,
      plannedCost: costAmount ? { amount: costAmount, currencyCode: costCurrency } : null,
      priority: form.priority || null,
      schedule:
        form.schedule === 'exact'
          ? { kind: 'exact', localTime: form.exactTime }
          : form.schedule === 'none'
            ? { kind: 'none' }
            : { dayPart: form.schedule, kind: 'day_part' },
      tripPlaceId: form.tripPlaceId || null,
    };
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
   * Adds a Place from the drawer straight onto the open day, unscheduled within it.
   * Timing is the traveller's to decide afterwards; getting it onto the day is the
   * point of having the collection beside the plan.
   */
  async function addPlaceToSelectedDay(tripPlace: TripPlace) {
    if (!selectedDay) return false;
    try {
      await createItineraryItem(tripId, {
        itineraryDayId: selectedDay.id,
        schedule: { kind: 'none' },
        tripPlaceId: tripPlace.id,
      });
      await refresh();
      return true;
    } catch {
      return false;
    }
  }

  async function handleDailyBase(day: ItineraryDay, tripPlaceId: string | null) {
    setError(null);
    try {
      await setItineraryDayBase(tripId, day.id, tripPlaceId);
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

  function selectAdjacentDay(offset: number) {
    const day = itinerary?.days[selectedIndex + offset];
    if (day) setSelectedDayId(day.id);
  }

  if (status === 'loading') {
    return <PageState className="mx-auto max-w-5xl" kind="loading" title={t('loading')} />;
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
                {t('dayOption', { date: formatDate(day.date), number: index + 1 })}
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
        <nav aria-label={t('dayNavigation')} className="hidden border-r border-border md:block">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">{t('days')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('dayCount', { count: itinerary.days.length })}
            </p>
          </div>
          <div className="max-h-[calc(100dvh-18rem)] overflow-y-auto p-2">
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
                <Popover>
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

                    <button
                      className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-0 py-1.5 text-left text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
                      onClick={() => setShowAdvancedDaySettings(!showAdvancedDaySettings)}
                      type="button"
                    >
                      <ChevronDown
                        aria-hidden="true"
                        className={cn(
                          'size-3 transition-transform duration-[var(--motion-standard)]',
                          {
                            'rotate-180': showAdvancedDaySettings,
                          },
                        )}
                      />
                      {t('advancedOptions')}
                    </button>

                    {showAdvancedDaySettings ? (
                      <div className="space-y-1.5 border-t border-border pt-3">
                        <p className="text-xs font-medium text-muted-foreground">
                          {t('dailyBase')}
                        </p>
                        <Select
                          onValueChange={(value) =>
                            void handleDailyBase(selectedDay, value === 'none' ? null : value)
                          }
                          value={selectedDay.dailyBaseTripPlaceId ?? 'none'}
                        >
                          <SelectTrigger aria-label={t('dailyBase')} className="w-full" size="sm">
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
                            {itinerary.tripPlaces.map((place) => (
                              <SelectItem key={place.id} value={place.id}>
                                {placeName(place)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}

                    <Button
                      className="w-full"
                      onClick={() => {
                        setDayNoteEditor(selectedDay);
                        setDayNoteValue(selectedDay.notes ?? '');
                      }}
                      variant="outline"
                    >
                      <NotebookPen aria-hidden="true" data-icon="inline-start" />
                      {selectedDay.notes ? t('editDayNote') : t('addDayNote')}
                    </Button>
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

            <div
              aria-label={t('map.viewNavigation')}
              className="grid grid-cols-2 gap-1 border-b border-border bg-muted/30 p-1 lg:hidden"
              role="tablist"
            >
              <Button
                aria-selected={mobileView === 'list'}
                onClick={() => setMobileView('list')}
                role="tab"
                size="sm"
                variant={mobileView === 'list' ? 'secondary' : 'ghost'}
              >
                <List aria-hidden="true" data-icon="inline-start" />
                {t('map.listView')}
              </Button>
              <Button
                aria-selected={mobileView === 'map'}
                onClick={() => setMobileView('map')}
                role="tab"
                size="sm"
                variant={mobileView === 'map' ? 'secondary' : 'ghost'}
              >
                <MapIcon aria-hidden="true" data-icon="inline-start" />
                {t('map.mapView')}
              </Button>
            </div>

            <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.9fr)]">
              <div className={cn('p-4 sm:p-6', mobileView === 'map' && 'hidden lg:block')}>
                {selectedDay.items.length ? (
                  <ItemGroup aria-label={t('itemListLabel')} variant="list">
                    {selectedDay.items.map((item, itemIndex) => {
                      const name = itemName(item);
                      const mapsHref = item.tripPlace ? googleMapsHref(item.tripPlace) : null;
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
                          />
                        ) : null,
                        <Item
                          className={cn('px-3 py-3', isMapSelected && 'bg-secondary/70')}
                          id={`itinerary-item-${item.id}`}
                          key={item.id}
                          role="listitem"
                          tabIndex={-1}
                        >
                          <ItemMedia
                            className="size-10 rounded-[var(--radius-md)] bg-secondary text-secondary-foreground"
                            variant="icon"
                          >
                            <Clock3 aria-hidden="true" />
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
                        />
                      ))}
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
                {planScoreDay || planScore.status === 'error' ? (
                  <PlanScorePanel
                    className="mt-4"
                    completeness={planScoreDay?.completeness ?? null}
                    confidence={planScoreDay?.confidence ?? null}
                    explanations={
                      planScoreDay?.explanations ?? {
                        uncertainty: [],
                        whatWorks: [],
                        worthImproving: [],
                      }
                    }
                    factors={planScoreDay?.factors}
                    onRetry={planScore.retry}
                    onSelectReference={focusItineraryItem}
                    score={planScoreDay?.score ?? null}
                    scope="day"
                    status={planScore.status}
                    title={planScoreTranslations('dayTitle')}
                  />
                ) : null}
              </div>

              <aside
                aria-label={t('map.regionLabel')}
                className={cn(
                  'min-w-0 border-border lg:block lg:border-l',
                  mobileView === 'list' && 'hidden',
                )}
              >
                {desktopMapLayout || mobileView === 'map' ? (
                  <ItineraryPlanningMap
                    onOpenPlace={setDetailTripPlaceId}
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
          onOpenChange={setPlacesDrawerOpen}
          placeUse={placeUse}
          tripId={tripId}
        />
      ) : null}

      <PlaceDetailSheet
        context={{ tripName: itinerary.trip.name }}
        onOpenChange={(open) => !open && setDetailTripPlaceId(null)}
        open={Boolean(detailTripPlaceId)}
        place={
          itinerary.tripPlaces.find((tripPlace) => tripPlace.id === detailTripPlaceId)?.place ??
          null
        }
      />

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

                  <Field>
                    <FieldLabel>{t('tripPlace')}</FieldLabel>
                    <SearchField
                      label={t('tripPlace')}
                      onChange={(event) => setPlaceQuery(event.target.value)}
                      placeholder={t('tripPlaceSearchPlaceholder')}
                      value={placeQuery}
                    />
                    <FieldDescription>{t('tripPlaceHint')}</FieldDescription>
                    {form.tripPlaceId ? (
                      <Button
                        className="mt-2"
                        onClick={() => updateForm('tripPlaceId', '')}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        {t('clearTripPlace')}
                      </Button>
                    ) : null}
                    <ItemGroup aria-label={t('tripPlaceResults')} className="mt-3 gap-2">
                      {matchingTripPlaces
                        .map((tripPlace) => (
                          <Item key={tripPlace.id} variant="outline">
                            <ItemMedia variant="icon">
                              <MapPinned aria-hidden="true" />
                            </ItemMedia>
                            <ItemContent>
                              <ItemTitle>{placeName(tripPlace)}</ItemTitle>
                            </ItemContent>
                            <ItemActions>
                              <Button
                                disabled={selectingPlace}
                                onClick={() => {
                                  updateForm('tripPlaceId', tripPlace.id);
                                  setPlaceQuery('');
                                }}
                                size="sm"
                                type="button"
                                variant={
                                  form.tripPlaceId === tripPlace.id ? 'secondary' : 'outline'
                                }
                              >
                                {form.tripPlaceId === tripPlace.id
                                  ? t('selected')
                                  : t('selectTripPlace')}
                              </Button>
                            </ItemActions>
                          </Item>
                        ))
                        .slice(0, 8)}
                      {placeQuery.trim()
                        ? providerResults
                            .filter(
                              (suggestion) =>
                                !itinerary.tripPlaces.some((tripPlace) =>
                                  tripPlace.place.providerRefs.some(
                                    (ref) => ref.externalPlaceId === suggestion.externalPlaceId,
                                  ),
                                ),
                            )
                            .map((suggestion) => (
                              <Item key={suggestion.externalPlaceId} variant="outline">
                                <ItemMedia variant="icon">
                                  <Search aria-hidden="true" />
                                </ItemMedia>
                                <ItemContent>
                                  <ItemTitle>{suggestion.name}</ItemTitle>
                                  <ItemDescription>{suggestion.description}</ItemDescription>
                                </ItemContent>
                                <ItemActions>
                                  <Button
                                    disabled={selectingPlace}
                                    onClick={() => void selectProviderPlace(suggestion)}
                                    size="sm"
                                    type="button"
                                    variant="outline"
                                  >
                                    {selectingPlace ? t('selectingPlace') : t('addTripPlace')}
                                  </Button>
                                </ItemActions>
                              </Item>
                            ))
                        : null}
                    </ItemGroup>
                    {placeSearchStatus === 'loading' ? (
                      <p className="mt-2 text-sm text-muted-foreground">{t('searchingPlaces')}</p>
                    ) : null}
                    {placeSearchStatus === 'unavailable' ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        {t('providerSearchUnavailable')}
                      </p>
                    ) : null}
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="itinerary-label">{t('customLabel')}</FieldLabel>
                    <Input
                      id="itinerary-label"
                      maxLength={200}
                      onChange={(event) => updateForm('customLabel', event.target.value)}
                      placeholder={t('customLabelPlaceholder')}
                      value={form.customLabel}
                    />
                    <FieldDescription>{t('minimumContentHint')}</FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="itinerary-schedule">{t('scheduleLabel')}</FieldLabel>
                    <Select
                      onValueChange={(value) =>
                        updateForm('schedule', value as FormState['schedule'])
                      }
                      value={form.schedule}
                    >
                      <SelectTrigger className="w-full" id="itinerary-schedule">
                        <SelectValue>{t(`schedule.${form.schedule}`)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start">
                        {(
                          ['none', 'exact', 'morning', 'afternoon', 'evening', 'anytime'] as const
                        ).map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(`schedule.${value}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  {form.schedule === 'exact' ? (
                    <Field>
                      <FieldLabel htmlFor="itinerary-exact-time">{t('exactTime')}</FieldLabel>
                      <TimeInput
                        aria-describedby="itinerary-exact-time-hint"
                        id="itinerary-exact-time"
                        onValueChange={(value) => updateForm('exactTime', value)}
                        required
                        value={form.exactTime}
                      />
                      <FieldDescription id="itinerary-exact-time-hint">
                        {t('floatingTimeHint')}
                      </FieldDescription>
                    </Field>
                  ) : null}

                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="itinerary-duration">{t('duration')}</FieldLabel>
                      <Input
                        id="itinerary-duration"
                        inputMode="numeric"
                        min="1"
                        onChange={(event) => updateForm('durationMinutes', event.target.value)}
                        placeholder={t('durationPlaceholder')}
                        type="number"
                        value={form.durationMinutes}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="itinerary-priority">{t('priorityLabel')}</FieldLabel>
                      <Select
                        onValueChange={(value) =>
                          updateForm(
                            'priority',
                            value === 'none' ? '' : (value as FormState['priority']),
                          )
                        }
                        value={form.priority || 'none'}
                      >
                        <SelectTrigger className="w-full" id="itinerary-priority">
                          <SelectValue>{t(`priority.${form.priority || 'none'}`)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent align="start">
                          {(['none', 'must_go', 'interested', 'maybe'] as const).map((value) => (
                            <SelectItem key={value} value={value}>
                              {t(`priority.${value}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>

                  <Field>
                    <FieldLabel htmlFor="itinerary-location">{t('customLocation')}</FieldLabel>
                    <Input
                      id="itinerary-location"
                      maxLength={300}
                      onChange={(event) => updateForm('customLocation', event.target.value)}
                      placeholder={t('customLocationPlaceholder')}
                      value={form.customLocation}
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="itinerary-location-time-zone">
                      {t('customLocationTimeZone')}
                    </FieldLabel>
                    <Input
                      disabled={!form.customLocation.trim()}
                      id="itinerary-location-time-zone"
                      maxLength={100}
                      onChange={(event) => updateForm('customLocationTimeZone', event.target.value)}
                      placeholder={t('timeZonePlaceholder')}
                      value={form.customLocationTimeZone}
                    />
                    <FieldDescription>{t('customLocationTimeZoneHint')}</FieldDescription>
                  </Field>

                  <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_8rem]">
                    <Field>
                      <FieldLabel htmlFor="itinerary-cost">{t('plannedCost')}</FieldLabel>
                      <MoneyInput
                        id="itinerary-cost"
                        onValueChange={(value) => updateForm('costAmount', value)}
                        placeholder={t('plannedCostPlaceholder')}
                        value={form.costAmount}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="itinerary-currency">{t('currency')}</FieldLabel>
                      <CurrencyCombobox
                        aria-label={t('currency')}
                        id="itinerary-currency"
                        onValueChange={(value) => updateForm('costCurrency', value)}
                        placeholder={t('currencyPlaceholder')}
                        value={form.costCurrency}
                      />
                    </Field>
                  </div>
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
                  <Button disabled={saving} type="submit">
                    {saving ? t('saving') : editor.mode === 'edit' ? t('save') : t('addItem')}
                  </Button>
                </div>
              </SheetFooter>
            </form>
          ) : null}
        </SheetContent>
      </Sheet>

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
