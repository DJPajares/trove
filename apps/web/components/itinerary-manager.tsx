'use client';

import {
  ArrowLeft,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  MapPinned,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import { PageHeader } from '@/components/page-header';
import { PageState } from '@/components/page-state';
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
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
  fetchItinerary,
  type Itinerary,
  type ItineraryDay,
  type ItineraryItem,
  type ItineraryItemInput,
  type ItineraryTripPlace,
  updateItineraryItem,
} from '@/lib/itinerary/api';
import {
  getCachedProviderPlaceDetails,
  getProviderPlaceDetails,
  type ProviderPlaceDetails,
} from '@/lib/saved/api';
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

function createFormState(item: ItineraryItem | null): FormState {
  return {
    costAmount: item?.plannedCost?.amount ?? '',
    costCurrency: item?.plannedCost?.currencyCode ?? '',
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

export function ItineraryManager({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('itinerary');
  const locale = useLocale();
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const [status, setStatus] = useState<'error' | 'idle' | 'loading'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>({ dayId: null, item: null, mode: 'closed' });
  const [form, setForm] = useState<FormState>(() => createFormState(null));
  const [formError, setFormError] = useState<string | null>(null);
  const [exactTimeInvalid, setExactTimeInvalid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<ItineraryItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [timeZoneConsequence, setTimeZoneConsequence] = useState(false);
  const [providerDetails, setProviderDetails] = useState<
    Record<string, ProviderPlaceDetails | null | undefined>
  >({});

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const next = await fetchItinerary(tripId);
      setItinerary(next);
      setSelectedDayId((current) =>
        current && next.days.some((day) => day.id === current)
          ? current
          : (next.days[0]?.id ?? null),
      );
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  }, [tripId]);

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
          return {
            details: result.status === 'ok' ? (result.place ?? null) : null,
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

  const selectedDay = useMemo(
    () => itinerary?.days.find((day) => day.id === selectedDayId) ?? null,
    [itinerary, selectedDayId],
  );
  const selectedIndex = itinerary?.days.findIndex((day) => day.id === selectedDayId) ?? -1;
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

  function openCreate(day: ItineraryDay) {
    setForm(createFormState(null));
    setFormError(null);
    setExactTimeInvalid(false);
    setEditor({ dayId: day.id, item: null, mode: 'create' });
  }

  function openEdit(item: ItineraryItem) {
    if (!item.itineraryDayId) return;
    setForm(createFormState(item));
    setFormError(null);
    setExactTimeInvalid(false);
    setEditor({ dayId: item.itineraryDayId, item, mode: 'edit' });
  }

  function closeEditor() {
    setEditor({ dayId: null, item: null, mode: 'closed' });
    setFormError(null);
    setExactTimeInvalid(false);
  }

  function updateForm<Key extends keyof FormState>(key: Key, value: FormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError(null);
    if (key === 'exactTime' || key === 'schedule') setExactTimeInvalid(false);
  }

  function normalizeLocalTime(value: string) {
    const candidate = value.trim();
    const match = candidate.match(/^(?:([01]?\d|2[0-3])(?::?([0-5]\d)))$/);
    if (!match) return candidate;
    return `${match[1]!.padStart(2, '0')}:${match[2]!}`;
  }

  function buildInput(): ItineraryItemInput | null {
    const customLabel = form.customLabel.trim();
    if (!customLabel && !form.tripPlaceId) {
      setFormError(t('minimumContentError'));
      return null;
    }
    const exactTime = normalizeLocalTime(form.exactTime);
    if (form.schedule === 'exact' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(exactTime)) {
      setExactTimeInvalid(true);
      return null;
    }
    const duration = form.durationMinutes ? Number(form.durationMinutes) : null;
    if (duration !== null && (!Number.isInteger(duration) || duration <= 0)) {
      setFormError(t('durationError'));
      return null;
    }
    const costAmount = form.costAmount.trim();
    const costCurrency = form.costCurrency.trim().toUpperCase();
    if (
      Boolean(costAmount) !== Boolean(costCurrency) ||
      (costCurrency && !/^[A-Z]{3}$/.test(costCurrency))
    ) {
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
          ? { kind: 'exact', localTime: exactTime }
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
    <section className="mx-auto w-full max-w-6xl space-y-7">
      <PageHeader
        actions={
          <>
            <Button nativeButton={false} render={<Link href="/trips" />} variant="ghost">
              <ArrowLeft aria-hidden="true" data-icon="inline-start" />
              {t('backToTrips')}
            </Button>
            <Button
              nativeButton={false}
              render={<Link href={`/trips/${tripId}/places`} />}
              variant="outline"
            >
              <MapPinned aria-hidden="true" data-icon="inline-start" />
              {t('tripPlaces')}
            </Button>
          </>
        }
        description={t('description')}
        title={t('title', { trip: itinerary.trip.name })}
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
              {selectedDay ? formatDate(selectedDay.date, true) : t('chooseDay')}
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
            <div className="flex flex-col gap-4 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  {t('dayNumber', { number: selectedIndex + 1 })}
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">
                  {formatDate(selectedDay.date, true)}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('dayTimeZone', { timeZone: selectedDay.defaultTimeZone })}
                </p>
              </div>
              <Button onClick={() => openCreate(selectedDay)}>
                <Plus aria-hidden="true" data-icon="inline-start" />
                {t('addItem')}
              </Button>
            </div>

            <div className="p-4 sm:p-6">
              {selectedDay.items.length ? (
                <ItemGroup aria-label={t('itemListLabel')} variant="list">
                  {selectedDay.items.map((item) => {
                    const name = itemName(item);
                    const mapsHref = item.tripPlace ? googleMapsHref(item.tripPlace) : null;
                    return (
                      <Item className="flex-nowrap px-3 py-3" key={item.id} role="listitem">
                        <ItemMedia
                          className="size-10 rounded-[var(--radius-md)] bg-secondary text-secondary-foreground"
                          variant="icon"
                        >
                          <Clock3 aria-hidden="true" />
                        </ItemMedia>
                        <ItemContent className="min-w-0">
                          <ItemTitle className="text-base">{name}</ItemTitle>
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
                                <span>{t('durationValue', { minutes: item.durationMinutes })}</span>
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
                        <ItemActions>
                          {mapsHref ? (
                            <Button
                              aria-label={t('openPlace', { name })}
                              nativeButton={false}
                              render={<a href={mapsHref} rel="noreferrer" target="_blank" />}
                              size="icon-sm"
                              variant="ghost"
                            >
                              <ExternalLink aria-hidden="true" />
                            </Button>
                          ) : item.tripPlace ? (
                            <Button
                              aria-label={t('openPlace', { name })}
                              nativeButton={false}
                              render={<Link href={`/trips/${tripId}/places`} />}
                              size="icon-sm"
                              variant="ghost"
                            >
                              <MapPinned aria-hidden="true" />
                            </Button>
                          ) : null}
                          <Button
                            aria-label={t('editItem', { name })}
                            onClick={() => openEdit(item)}
                            size="icon-sm"
                            variant="ghost"
                          >
                            <Pencil aria-hidden="true" />
                          </Button>
                        </ItemActions>
                      </Item>
                    );
                  })}
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
            </div>
          </div>
        ) : null}
      </div>

      <Sheet open={editor.mode !== 'closed'} onOpenChange={(open) => !open && closeEditor()}>
        <SheetContent
          className="data-[side=right]:w-[min(38rem,calc(100%-0.5rem))]"
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
                    <FieldLabel htmlFor="itinerary-trip-place">{t('tripPlace')}</FieldLabel>
                    <Select
                      onValueChange={(value) =>
                        updateForm('tripPlaceId', value === 'none' ? '' : (value ?? ''))
                      }
                      value={form.tripPlaceId || 'none'}
                    >
                      <SelectTrigger className="w-full" id="itinerary-trip-place">
                        <SelectValue>
                          {form.tripPlaceId
                            ? placeName(
                                itinerary.tripPlaces.find(
                                  (tripPlace) => tripPlace.id === form.tripPlaceId,
                                ) ?? null,
                              )
                            : t('noTripPlace')}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start">
                        <SelectItem value="none">{t('noTripPlace')}</SelectItem>
                        {itinerary.tripPlaces.map((tripPlace) => (
                          <SelectItem key={tripPlace.id} value={tripPlace.id}>
                            {placeName(tripPlace)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldDescription>{t('tripPlaceHint')}</FieldDescription>
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
                    <Field data-invalid={exactTimeInvalid}>
                      <FieldLabel htmlFor="itinerary-exact-time">{t('exactTime')}</FieldLabel>
                      <div className="relative max-w-48">
                        <Clock3
                          aria-hidden="true"
                          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                          aria-describedby="itinerary-exact-time-hint"
                          aria-invalid={exactTimeInvalid}
                          autoComplete="off"
                          className="pl-10 tabular-nums"
                          id="itinerary-exact-time"
                          inputMode="numeric"
                          maxLength={5}
                          onBlur={(event) =>
                            updateForm('exactTime', normalizeLocalTime(event.currentTarget.value))
                          }
                          onChange={(event) => updateForm('exactTime', event.target.value)}
                          pattern="(?:[01]\\d|2[0-3]):[0-5]\\d"
                          placeholder={t('exactTimePlaceholder')}
                          type="text"
                          value={form.exactTime}
                        />
                      </div>
                      <FieldDescription id="itinerary-exact-time-hint">
                        {t('exactTimeHint')} {t('floatingTimeHint')}
                      </FieldDescription>
                      <FieldError>{exactTimeInvalid ? t('exactTimeError') : null}</FieldError>
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
                      <Input
                        id="itinerary-cost"
                        inputMode="decimal"
                        min="0"
                        onChange={(event) => updateForm('costAmount', event.target.value)}
                        placeholder={t('plannedCostPlaceholder')}
                        step="0.01"
                        type="number"
                        value={form.costAmount}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="itinerary-currency">{t('currency')}</FieldLabel>
                      <Input
                        className="uppercase"
                        id="itinerary-currency"
                        maxLength={3}
                        onChange={(event) => updateForm('costCurrency', event.target.value)}
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
