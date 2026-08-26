'use client';

import { CheckCircle2, CircleAlert, Clock3, MapPinned, NotebookPen, Search, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { TimeInput } from '@/components/time-input';
import { useOnlineStatus } from '@/components/trip-sync-status';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
  type ItineraryItemInput,
  type ItineraryTripPlace,
} from '@/lib/itinerary/api';
import type { ScheduledPlaceUse } from '@/lib/itinerary/places';
import {
  durationMinutesFromParts,
  durationParts,
  filterItineraryTripPlaces,
  itineraryIdentityChoice,
  itineraryProviderSuggestions,
  ITINERARY_DURATION_PRESETS,
  normalizeItineraryPlaceQuery,
} from '@/lib/itinerary/item-editor';
import { addTripPlace, type TripPlace } from '@/lib/trip-places/api';
import { sortTripPlaces } from '@/lib/trip-places/sort';
import {
  resolveProviderPlace,
  searchProviderPlaces,
  type ProviderSuggestion,
} from '@/lib/saved/api';
import { cn } from '@/lib/utils';

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

type ProviderSearchCacheEntry = {
  sessionToken: string | null;
  status: 'empty' | 'loading' | 'ok' | 'unavailable';
  suggestions: ProviderSuggestion[];
};

type PlacePickerOption =
  | { kind: 'custom_label'; label: string }
  | { kind: 'provider'; suggestion: ProviderSuggestion }
  | { kind: 'trip_place'; label: string; tripPlace: ItineraryTripPlace; usageLabel: string | null };

type ItineraryCreateItemSheetProps = {
  dayId: string;
  onCreated: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
  onTripPlaceAdded?: (tripPlace: TripPlace) => void;
  open: boolean;
  placeUse: Record<string, ScheduledPlaceUse>;
  tripId: string;
  tripPlaces: ItineraryTripPlace[];
};

function createFormState(): FormState {
  return {
    customLabel: '',
    durationMinutes: '',
    exactTime: '',
    localEndTime: '',
    notes: '',
    schedule: 'none',
    timingMode: 'duration',
    tripPlaceId: '',
  };
}

function itineraryTripPlaceFromTripPlace(tripPlace: TripPlace): ItineraryTripPlace {
  return {
    customName: tripPlace.customName,
    id: tripPlace.id,
    note: tripPlace.note,
    place: { ...tripPlace.place, timeZone: tripPlace.place.location?.timeZone ?? null },
    priority: tripPlace.priority,
  };
}

export function ItineraryCreateItemSheet({
  dayId,
  onCreated,
  onOpenChange,
  onTripPlaceAdded,
  open,
  placeUse,
  tripId,
  tripPlaces,
}: Readonly<ItineraryCreateItemSheetProps>) {
  const t = useTranslations('itinerary');
  const tripPlacesT = useTranslations('tripPlaces');
  const locale = useLocale();
  const online = useOnlineStatus();
  const [form, setForm] = useState<FormState>(createFormState);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [placeQuery, setPlaceQuery] = useState('');
  const [providerResults, setProviderResults] = useState<ProviderSuggestion[]>([]);
  const [providerSessionToken, setProviderSessionToken] = useState<string | null>(null);
  const [placeSearchStatus, setPlaceSearchStatus] = useState<'idle' | 'loading' | 'unavailable'>(
    'idle',
  );
  const [identityPickerOpen, setIdentityPickerOpen] = useState(true);
  const [timingExpanded, setTimingExpanded] = useState(false);
  const [customDurationOpen, setCustomDurationOpen] = useState(false);
  const [customDurationHours, setCustomDurationHours] = useState('');
  const [customDurationMinutes, setCustomDurationMinutes] = useState('');
  const [selectingPlace, setSelectingPlace] = useState(false);
  const [addedTripPlaces, setAddedTripPlaces] = useState<ItineraryTripPlace[]>([]);
  const providerSearchRequest = useRef<AbortController | null>(null);
  const providerSearchRequestQuery = useRef<string | null>(null);
  const providerSearchCache = useRef(new Map<string, ProviderSearchCacheEntry>());
  const currentPlaceQuery = useRef('');

  useEffect(() => {
    if (!open) return;
    setForm(createFormState());
    setFormError(null);
    setPlaceQuery('');
    currentPlaceQuery.current = '';
    setProviderResults([]);
    setProviderSessionToken(null);
    setPlaceSearchStatus('idle');
    setIdentityPickerOpen(true);
    setTimingExpanded(false);
    setCustomDurationOpen(false);
    setCustomDurationHours('');
    setCustomDurationMinutes('');
    setAddedTripPlaces([]);
    providerSearchRequest.current?.abort();
    providerSearchRequest.current = null;
    providerSearchRequestQuery.current = null;
    providerSearchCache.current = new Map();
  }, [open]);

  useEffect(
    () => () => {
      providerSearchRequest.current?.abort();
    },
    [],
  );

  const availableTripPlaces = useMemo(() => {
    const places = new Map(tripPlaces.map((tripPlace) => [tripPlace.id, tripPlace]));
    addedTripPlaces.forEach((tripPlace) => places.set(tripPlace.id, tripPlace));
    return [...places.values()];
  }, [addedTripPlaces, tripPlaces]);

  const placeName = (tripPlace: ItineraryTripPlace | null) =>
    tripPlace?.customName ??
    tripPlace?.place.name ??
    tripPlace?.place.snapshot?.name ??
    tripPlace?.place.providerLabel ??
    null;

  const placeUseDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    [locale],
  );
  const placeUseListFormatter = useMemo(
    () => new Intl.ListFormat(locale, { style: 'short', type: 'conjunction' }),
    [locale],
  );
  const matchingTripPlaces = useMemo(
    () =>
      sortTripPlaces(
        filterItineraryTripPlaces(availableTripPlaces, placeQuery, (tripPlace) => [
          placeName(tripPlace),
          tripPlace.place.snapshot?.address,
          tripPlace.place.providerAddress,
        ]),
        'name',
        (tripPlace) => placeName(tripPlace) ?? t('providerPlace'),
      ),
    [availableTripPlaces, placeQuery, t],
  );
  const usageLabel = (tripPlace: ItineraryTripPlace) => {
    const dates = placeUse[tripPlace.id]?.dayDates ?? [];
    if (!dates.length) return null;
    return tripPlacesT('onDates', {
      dates: placeUseListFormatter.format(
        dates.map((date) => placeUseDateFormatter.format(new Date(`${date}T00:00:00Z`))),
      ),
    });
  };
  const existingExternalPlaceIds = useMemo(
    () =>
      new Set(
        availableTripPlaces.flatMap((tripPlace) =>
          tripPlace.place.providerRefs.map((reference) => reference.externalPlaceId),
        ),
      ),
    [availableTripPlaces],
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
      ...visibleProviderResults.map((suggestion) => ({ kind: 'provider' as const, suggestion })),
    ];
  }, [matchingTripPlaces, placeQuery, visibleProviderResults]);
  const selectedTripPlace = form.tripPlaceId
    ? (availableTripPlaces.find((tripPlace) => tripPlace.id === form.tripPlaceId) ?? null)
    : null;
  const hasItemIdentity = Boolean(form.customLabel.trim() || form.tripPlaceId);
  const providerQueryKey = normalizeItineraryPlaceQuery(placeQuery);
  const providerQueryCached = providerSearchCache.current.has(providerQueryKey);
  const selectedPlaceName = selectedTripPlace ? placeName(selectedTripPlace) : null;

  function clearProviderResultState() {
    setProviderResults([]);
    setProviderSessionToken(null);
    setPlaceSearchStatus('idle');
  }

  function updateForm<Key extends keyof FormState>(key: Key, value: FormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError(null);
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
    setIdentityPickerOpen(false);
    setPlaceQuery('');
    currentPlaceQuery.current = '';
    clearProviderResultState();
    setFormError(null);
  }

  function clearIdentity() {
    setForm((current) => ({ ...current, ...itineraryIdentityChoice(current, { kind: 'clear' }) }));
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
      setAddedTripPlaces((current) =>
        current.some((item) => item.id === tripPlace.id)
          ? current
          : [...current, itineraryTripPlaceFromTripPlace(tripPlace)],
      );
      onTripPlaceAdded?.(tripPlace);
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
    return {
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
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = buildInput();
    if (!input) return;
    setSaving(true);
    setFormError(null);
    try {
      await createItineraryItem(tripId, { ...input, itineraryDayId: dayId });
      await onCreated();
      onOpenChange(false);
    } catch {
      setFormError(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent
        className="w-full md:data-[side=right]:w-[min(38rem,calc(100%-0.5rem))]"
        closeLabel={t('close')}
      >
        <SheetHeader className="border-b">
          <SheetTitle>{t('createTitle')}</SheetTitle>
          <SheetDescription>{t('createDescription')}</SheetDescription>
        </SheetHeader>
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
                            priority: tripPlacesT(`priority.${selectedTripPlace.priority}`),
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
                    onInputValueChange={handlePlaceQueryChange}
                    onValueChange={selectPlacePickerOption}
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
                              <MapPinned aria-hidden="true" className="text-muted-foreground" />
                            ) : option.kind === 'custom_label' ? (
                              <NotebookPen aria-hidden="true" className="text-muted-foreground" />
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
                              ) : option.kind === 'provider' && option.suggestion.description ? (
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
                          <FieldLabel htmlFor="itinerary-exact-time">{t('exactTime')}</FieldLabel>
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
            <span />
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                disabled={saving}
                onClick={() => onOpenChange(false)}
                type="button"
                variant="outline"
              >
                {t('cancel')}
              </Button>
              <Button disabled={saving || selectingPlace || !hasItemIdentity} type="submit">
                {saving ? t('saving') : t('addItem')}
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
