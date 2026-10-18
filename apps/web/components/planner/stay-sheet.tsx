'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { replaceStayRange, shiftStayDate, type DayStayUpdate, type StayRange } from '@trove/types';
import { previewStayEndpoints } from '@/lib/itinerary/stay-plan';
import type { TrovePlaceCategory } from '@/lib/place-categories';
import { stayOptions } from '@/lib/trip-places/categories';
import { updateTripPlace } from '@/lib/trip-places/api';
import * as Icons from '@/lib/icons';
import { AddTripPlaceSheet } from '@/components/add-trip-place-sheet';
import { DatePicker } from '@/components/date-picker';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeading, SheetFooter } from '@/components/ui/sheet';
import {
  ItineraryApiError,
  updateDayStay,
  updateTripStayPlan,
  type Itinerary,
  type ItineraryDay,
  type ItineraryTripPlace,
} from '@/lib/itinerary/api';

export function StaySheet({
  itinerary,
  day,
  initialView,
  online,
  onSaved,
  onOpenChange,
  placeName,
  tripId,
}: Readonly<{
  itinerary: Itinerary;
  day: ItineraryDay | null;
  initialView: 'trip' | 'day';
  online: boolean;
  onSaved: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
  placeName: (place: ItineraryTripPlace | null) => string | null;
  tripId: string;
}>) {
  const t = useTranslations('itinerary.stays');
  const locale = useLocale();
  const [view, setView] = useState(initialView);
  const [defaultId, setDefaultId] = useState(itinerary.stayPlan?.defaultTripPlaceId ?? 'none');
  const [ranges, setRanges] = useState(itinerary.stayPlan?.ranges ?? []);
  const [editingRange, setEditingRange] = useState<StayRange | null>(null);
  const [originalRange, setOriginalRange] = useState<number | null>(null);
  const [reset, setReset] = useState(false);
  const endpoint = (end: 'start' | 'end') => {
    const id = end === 'start' ? day?.dailyBaseTripPlaceId : day?.dailyBaseDepartureTripPlaceId;
    const mode = end === 'start' ? day?.stayStartMode : day?.stayEndMode;
    if (mode === 'NONE') return 'none';
    if (mode === 'SAME_AS_START') return 'same_as_start';
    if (mode === 'INHERIT') return 'inherit';
    return id ?? (end === 'end' && day?.dailyBaseTripPlaceId ? 'same_as_start' : 'inherit');
  };
  const [start, setStart] = useState(() => endpoint('start'));
  const [end, setEnd] = useState(() => endpoint('end'));
  const [different, setDifferent] = useState(
    () => endpoint('end') !== 'same_as_start' && !(endpoint('start') === endpoint('end')),
  );
  const [adding, setAdding] = useState<'default' | 'range' | 'start' | 'end' | null>(null);
  const [added, setAdded] = useState<Array<{ id: string; name: string }>>([]);
  const [revision] = useState(itinerary.stayPlan?.revision ?? 0);
  const [conflicted, setConflicted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  // Only somewhere to stay is offered as a Stay - plus whatever is already
  // chosen, so a Stay saved before categories existed never disappears.
  const stayPlaces = stayOptions(itinerary.tripPlaces, [
    defaultId,
    start,
    end,
    editingRange?.tripPlaceId,
    ...ranges.map((range) => range.tripPlaceId),
  ]);
  const options = [
    ...stayPlaces.map((place) => ({
      id: place.id,
      name: placeName(place) ?? t('unnamed'),
    })),
    ...added,
  ]
    .filter((place, index, values) => values.findIndex((p) => p.id === place.id) === index)
    .sort((a, b) => a.name.localeCompare(b.name));
  // The trip's other places, any of which can be said to be a stay here.
  const otherPlaces = itinerary.tripPlaces
    .filter((place) => !options.some((option) => option.id === place.id))
    .map((place) => ({ id: place.id, name: placeName(place) ?? t('unnamed'), place }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // An inherited Stay is named even when it is not among the options.
  const name = (id: string) =>
    options.find((p) => p.id === id)?.name ??
    placeName(itinerary.tripPlaces.find((place) => place.id === id) ?? null) ??
    t('unnamed');

  function chooseFor(target: NonNullable<typeof adding>, id: string) {
    if (target === 'default') setDefaultId(id);
    if (target === 'range' && editingRange) setEditingRange({ ...editingRange, tripPlaceId: id });
    if (target === 'start') setStart(id);
    if (target === 'end') {
      setEnd(id);
      setDifferent(true);
    }
  }

  /** Says a place on this trip is a stay, then chooses it. */
  async function takeAsStay(
    target: NonNullable<typeof adding>,
    entry: { id: string; name: string; manualCategories?: TrovePlaceCategory[] },
  ) {
    setMarking(true);
    setError(null);
    try {
      await updateTripPlace(tripId, entry.id, {
        categories: [...new Set([...(entry.manualCategories ?? []), 'stay' as const])],
      });
      setAdded((current) => [...current, { id: entry.id, name: entry.name }]);
      chooseFor(target, entry.id);
      void onSaved().catch(() => undefined);
    } catch {
      setError(t('markError'));
    } finally {
      setMarking(false);
    }
  }
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${value}T00:00:00Z`),
    );
  const label = (range: StayRange) =>
    t('rangeLabel', {
      first: itinerary.days.findIndex((d) => d.date === range.startDate) + 1,
      last:
        Math.round(
          (Date.parse(range.endDate) - Date.parse(itinerary.trip.startDate)) / 86_400_000,
        ) + 1,
      from: date(range.startDate),
      through: date(range.endDate),
    });
  const validRange =
    editingRange &&
    editingRange.tripPlaceId &&
    editingRange.startDate >= itinerary.trip.startDate &&
    editingRange.startDate < editingRange.endDate &&
    editingRange.endDate <= itinerary.trip.endDate;
  const preview = validRange
    ? replaceStayRange(
        ranges.filter((_, i) => i !== originalRange),
        editingRange,
      )
    : ranges;
  const exceptions = itinerary.days.filter(
    (d) =>
      d.dailyBaseTripPlaceId ||
      d.dailyBaseDepartureTripPlaceId ||
      d.stayStartMode === 'NONE' ||
      d.stayEndMode === 'NONE' ||
      d.stayEndMode === 'SAME_AS_START',
  ).length;
  const inherited = (id: string | null | undefined) => (id ? name(id) : t('none'));

  function picker(
    value: string,
    change: (value: string) => void,
    id: string,
    target: NonNullable<typeof adding>,
    automatic = false,
    same = false,
  ) {
    const items = [
      ...(automatic ? [{ id: 'inherit', name: t('automatic') }] : []),
      ...(same ? [{ id: 'same_as_start', name: t('sameAsStart') }] : []),
      ...(target === 'range'
        ? []
        : [{ id: 'none', name: t(target === 'default' ? 'noDefault' : 'none') }]),
      ...options,
    ];
    return (
      <div className="space-y-2">
        <Select
          value={target === 'range' && !value ? null : value || 'none'}
          onValueChange={(next) => {
            if (next) change(next);
          }}
          disabled={busy || !online}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue>{items.find((p) => p.id === value)?.name ?? t('choosePlace')}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {items.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {stayPlaces.length || added.length ? null : (
          <p className="text-sm text-muted-foreground">{t('noAccommodation')}</p>
        )}
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!online || busy || marking}
            onClick={() => setAdding(target)}
          >
            <Plus aria-hidden="true" />
            {t('findPlace')}
          </Button>
          {otherPlaces.length ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    disabled={!online || busy || marking}
                    size="sm"
                    type="button"
                    variant="ghost"
                  />
                }
              >
                <Icons.DailyBase aria-hidden="true" />
                {t('useTripPlace')}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-72 min-w-56 overflow-y-auto">
                {otherPlaces.map((entry) => (
                  <DropdownMenuItem
                    key={entry.id}
                    onClick={() =>
                      void takeAsStay(target, {
                        id: entry.id,
                        manualCategories: entry.place.manualCategories,
                        name: entry.name,
                      })
                    }
                  >
                    {entry.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
    );
  }
  const inputEnd = (value: string): DayStayUpdate['end'] =>
    value === 'inherit' || value === 'none' || value === 'same_as_start'
      ? { mode: value }
      : { mode: 'place', tripPlaceId: value };
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const expectedRevision = revision;
      if (view === 'trip')
        await updateTripStayPlan(tripId, {
          expectedRevision,
          defaultTripPlaceId: defaultId === 'none' ? null : defaultId,
          ranges: preview,
          resetDayOverrides: reset,
        });
      else if (day)
        await updateDayStay(tripId, day.id, {
          expectedRevision,
          start:
            start === 'inherit' || start === 'none'
              ? { mode: start }
              : { mode: 'place', tripPlaceId: start },
          end: inputEnd(
            different
              ? end
              : start === 'inherit'
                ? 'inherit'
                : start === 'none'
                  ? 'none'
                  : 'same_as_start',
          ),
        });
      await onSaved();
      onOpenChange(false);
    } catch (cause) {
      const conflict = cause instanceof ItineraryApiError && cause.status === 409;
      if (conflict) {
        setConflicted(true);
        await onSaved().catch(() => undefined);
      }
      setError(t(conflict ? 'conflict' : 'saveError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Sheet
        open
        onOpenChange={(open) => {
          if (!busy) onOpenChange(open);
        }}
      >
        <SheetContent
          closeLabel={t('close')}
          className="w-full md:data-[side=right]:w-[min(30rem,calc(100%-0.5rem))]"
        >
          <SheetHeading
            title={
              view === 'trip'
                ? t('title')
                : t('dayTitle', { number: itinerary.days.findIndex((d) => d.id === day?.id) + 1 })
            }
            description={view === 'trip' ? t('description') : t('dayDescription')}
          />
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
            {day && view === 'day' ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setView('trip');
                  setError(null);
                }}
              >
                {t('editTrip')}
              </Button>
            ) : null}
            {!online ? <p className="text-sm text-muted-foreground">{t('offline')}</p> : null}
            {view === 'trip' ? (
              <>
                <Field>
                  <FieldLabel htmlFor="trip-stay">{t('wholeTrip')}</FieldLabel>
                  {picker(defaultId, setDefaultId, 'trip-stay', 'default')}
                </Field>
                <div className="space-y-3">
                  {ranges.length ? (
                    <h3 className="text-sm font-medium">{t('specificDays')}</h3>
                  ) : null}
                  {ranges.map((range, index) => (
                    <div
                      key={`${range.startDate}-${range.endDate}`}
                      className="flex items-center gap-2 border-b border-border-subtle pb-3"
                    >
                      <Button
                        variant="ghost"
                        className="h-auto min-w-0 flex-1 justify-start px-0 text-left"
                        disabled={busy}
                        onClick={() => {
                          setOriginalRange(index);
                          setEditingRange({ ...range });
                        }}
                      >
                        <span className="min-w-0">
                          <span className="block truncate">{name(range.tripPlaceId)}</span>
                          <span className="block text-xs font-normal text-muted-foreground">
                            {label(range)}
                          </span>
                        </span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('removeRange', { name: name(range.tripPlaceId) })}
                        disabled={busy}
                        onClick={() => {
                          setRanges(ranges.filter((_, i) => i !== index));
                          setEditingRange(null);
                          setOriginalRange(null);
                        }}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  ))}
                  {!editingRange ? (
                    itinerary.trip.startDate < itinerary.trip.endDate ? (
                      <Button
                        variant="outline"
                        disabled={busy || !online}
                        onClick={() => {
                          setOriginalRange(null);
                          setEditingRange({
                            tripPlaceId: '',
                            startDate:
                              day && day.date < itinerary.trip.endDate
                                ? day.date
                                : itinerary.trip.startDate,
                            endDate: itinerary.trip.endDate,
                          });
                        }}
                      >
                        <Plus aria-hidden="true" />
                        {t('addRange')}
                      </Button>
                    ) : null
                  ) : (
                    <section className="space-y-4 rounded-[var(--radius-lg)] border border-border p-4">
                      <Field>
                        <FieldLabel htmlFor="range-stay">{t('rangePlace')}</FieldLabel>
                        {picker(
                          editingRange.tripPlaceId,
                          (id) =>
                            setEditingRange({
                              ...editingRange,
                              tripPlaceId: id === 'none' ? '' : id,
                            }),
                          'range-stay',
                          'range',
                        )}
                      </Field>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field>
                          <FieldLabel>{t('from')}</FieldLabel>
                          <DatePicker
                            id="stay-range-start"
                            label={t('from')}
                            value={editingRange.startDate}
                            min={itinerary.trip.startDate}
                            max={shiftStayDate(
                              editingRange.endDate < itinerary.trip.endDate
                                ? editingRange.endDate
                                : itinerary.trip.endDate,
                              -1,
                            )}
                            clearable={false}
                            disabled={busy}
                            onChange={(startDate) =>
                              setEditingRange({ ...editingRange, startDate })
                            }
                          />
                        </Field>
                        <Field>
                          <FieldLabel>{t('through')}</FieldLabel>
                          <DatePicker
                            id="stay-range-end"
                            label={t('through')}
                            value={editingRange.endDate}
                            min={shiftStayDate(editingRange.startDate, 1)}
                            max={itinerary.trip.endDate}
                            clearable={false}
                            disabled={busy}
                            onChange={(endDate) => setEditingRange({ ...editingRange, endDate })}
                          />
                        </Field>
                      </div>
                      <p className="text-sm text-muted-foreground">{t('nightsHelp')}</p>
                      {validRange ? (
                        <div className="space-y-2" role="status">
                          <p className="text-sm font-medium">{t('preview')}</p>
                          {preview.map((range) => (
                            <p className="text-sm" key={range.startDate}>
                              {name(range.tripPlaceId)} · {label(range)}
                            </p>
                          ))}
                          {itinerary.days
                            .filter(
                              (d) =>
                                d.date >= editingRange.startDate && d.date <= editingRange.endDate,
                            )
                            .map((d) => {
                              const ends = previewStayEndpoints(
                                reset
                                  ? {
                                      ...d,
                                      stayStartMode: 'INHERIT',
                                      stayEndMode: 'INHERIT',
                                      dailyBaseTripPlaceId: null,
                                      dailyBaseDepartureTripPlaceId: null,
                                    }
                                  : d,
                                {
                                  defaultTripPlaceId: defaultId === 'none' ? null : defaultId,
                                  ranges: preview,
                                  revision,
                                },
                                itinerary.trip.startDate,
                                itinerary.trip.endDate,
                              );
                              return (
                                <p key={d.id} className="text-sm text-muted-foreground">
                                  {t('dayCoverage', {
                                    number: itinerary.days.findIndex((day) => day.id === d.id) + 1,
                                    date: date(d.date),
                                    start: inherited(ends.start),
                                    end: inherited(ends.end),
                                  })}
                                </p>
                              );
                            })}
                        </div>
                      ) : null}
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          setEditingRange(null);
                          setOriginalRange(null);
                        }}
                      >
                        {t('cancelRange')}
                      </Button>
                    </section>
                  )}
                </div>
                {exceptions ? (
                  <div className="space-y-3 border-t border-border-subtle pt-4">
                    <p className="text-sm text-muted-foreground">
                      {t('exceptions', { count: exceptions })}
                    </p>
                    <label className="flex items-center gap-2 text-sm">
                      <Switch
                        checked={reset}
                        disabled={busy}
                        onCheckedChange={(checked) => setReset(checked === true)}
                      />
                      {t('resetExceptions')}
                    </label>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {t('resolved', {
                    start: inherited(day?.stay?.startTripPlaceId),
                    end: inherited(day?.stay?.endTripPlaceId),
                  })}
                </p>
                <Field>
                  <FieldLabel htmlFor="day-stay-start">
                    {different ? t('start') : t('dayStay')}
                  </FieldLabel>
                  {picker(start, setStart, 'day-stay-start', 'start', true)}
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={different}
                    disabled={busy}
                    onCheckedChange={(checked) => setDifferent(checked === true)}
                  />
                  {t('differentEnds')}
                </label>
                {different ? (
                  <Field>
                    <FieldLabel htmlFor="day-stay-end">{t('end')}</FieldLabel>
                    {picker(end, setEnd, 'day-stay-end', 'end', true, true)}
                  </Field>
                ) : null}
              </>
            )}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <SheetFooter>
            <Button
              disabled={
                !online ||
                busy ||
                conflicted ||
                (view === 'trip' && Boolean(editingRange) && !validRange)
              }
              onClick={() => void save()}
            >
              {busy ? t('saving') : t('save')}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      {adding ? (
        <AddTripPlaceSheet
          finalFocus={() =>
            document.getElementById(
              adding === 'default'
                ? 'trip-stay'
                : adding === 'range'
                  ? 'range-stay'
                  : adding === 'start'
                    ? 'day-stay-start'
                    : 'day-stay-end',
            ) ?? false
          }
          tripId={tripId}
          tripPlaces={itinerary.tripPlaces}
          onOpenChange={(open) => {
            if (!open) setAdding(null);
          }}
          onAdded={(place) => {
            const target = adding;
            setAdding(null);
            // Found from Stay, so it is somewhere to stay.
            void takeAsStay(target, {
              id: place.id,
              manualCategories: place.manualCategories,
              name:
                place.customName ?? place.place.name ?? place.place.providerLabel ?? t('unnamed'),
            });
          }}
        />
      ) : null}
    </>
  );
}
