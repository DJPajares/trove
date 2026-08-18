'use client';

import { MapPin, Plus, Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { SearchField } from '@/components/search-field';
import {
  TripModeScheduleFields,
  type TripModeSchedule,
} from '@/components/trip-mode-schedule-fields';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { ItineraryScheduleInput, ItineraryTripPlace } from '@/lib/itinerary/api';
import { createItineraryItem } from '@/lib/itinerary/api';
import {
  cacheProviderPlaceDetails,
  getCachedProviderPlaceDetails,
  getProviderPlaceDetails,
  GOOGLE_PLACES_SEARCH_DEBOUNCE_MS,
  resolveProviderPlace,
  searchProviderPlaces,
  type ProviderPlaceDetails,
  type ProviderSuggestion,
} from '@/lib/saved/api';
import { addTripPlace } from '@/lib/trip-places/api';

function scheduleInput(schedule: TripModeSchedule, exactTime: string): ItineraryScheduleInput {
  if (schedule === 'exact') return { kind: 'exact', localTime: exactTime };
  if (schedule === 'none') return { kind: 'none' };
  return { dayPart: schedule, kind: 'day_part' };
}

export function TripModeAddItemDialog({
  dayId,
  onAdded,
  onOpenChange,
  open,
  tripId,
  tripPlaces,
}: Readonly<{
  dayId: string;
  onAdded: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  tripId: string;
  tripPlaces: ItineraryTripPlace[];
}>) {
  const t = useTranslations('tripMode.views.today.add');
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const [customLabel, setCustomLabel] = useState('');
  const [schedule, setSchedule] = useState<TripModeSchedule>('none');
  const [exactTime, setExactTime] = useState('');
  const [providerResults, setProviderResults] = useState<ProviderSuggestion[]>([]);
  const [providerDetails, setProviderDetails] = useState<
    Record<string, ProviderPlaceDetails | null | undefined>
  >({});
  const [searchStatus, setSearchStatus] = useState<'idle' | 'loading' | 'unavailable'>('idle');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCustomLabel('');
    setSchedule('none');
    setExactTime('');
    setProviderResults([]);
    setSearchStatus('idle');
    setSavingId(null);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const pending = tripPlaces.filter(
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
        const externalPlaceId = tripPlace.place.providerRefs[0]?.externalPlaceId;
        if (!externalPlaceId) return { details: null, placeId: tripPlace.place.id };
        try {
          const result = await getProviderPlaceDetails(externalPlaceId, locale);
          const details = result.status === 'ok' ? (result.place ?? null) : null;
          if (details) cacheProviderPlaceDetails(tripPlace.place.id, details);
          return { details, placeId: tripPlace.place.id };
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
  }, [locale, open, providerDetails, tripPlaces]);

  useEffect(() => {
    const search = query.trim();
    if (!open || !search) {
      setProviderResults([]);
      setSearchStatus('idle');
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearchStatus('loading');
      void searchProviderPlaces(search, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          setProviderResults(result.status === 'ok' ? result.suggestions : []);
          setSearchStatus(result.status === 'unavailable' ? 'unavailable' : 'idle');
        })
        .catch(() => !controller.signal.aborted && setSearchStatus('unavailable'));
    }, GOOGLE_PLACES_SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const filteredTripPlaces = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return tripPlaces
      .filter((tripPlace) => {
        if (!search) return true;
        const details = providerDetails[tripPlace.place.id];
        return [tripPlace.place.name, details?.name, details?.formattedAddress]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLocaleLowerCase().includes(search));
      })
      .slice(0, 8);
  }, [providerDetails, query, tripPlaces]);

  const placeName = (tripPlace: ItineraryTripPlace) =>
    tripPlace.place.name ?? providerDetails[tripPlace.place.id]?.name ?? t('placeFallback');

  async function finishCreate(input: { customLabel?: string; tripPlaceId?: string }) {
    if (schedule === 'exact' && !exactTime) {
      setError(t('exactTimeError'));
      return;
    }
    await createItineraryItem(tripId, {
      customLabel: input.customLabel,
      itineraryDayId: dayId,
      schedule: scheduleInput(schedule, exactTime),
      tripPlaceId: input.tripPlaceId,
    });
    await onAdded();
    onOpenChange(false);
  }

  async function addExisting(tripPlace: ItineraryTripPlace) {
    setSavingId(tripPlace.id);
    setError(null);
    try {
      await finishCreate({ tripPlaceId: tripPlace.id });
    } catch {
      setError(t('saveError'));
    } finally {
      setSavingId(null);
    }
  }

  async function addProvider(suggestion: ProviderSuggestion) {
    setSavingId(suggestion.externalPlaceId);
    setError(null);
    try {
      const { place } = await resolveProviderPlace(suggestion.externalPlaceId);
      const { tripPlace } = await addTripPlace(tripId, place.id);
      await finishCreate({ tripPlaceId: tripPlace.id });
    } catch {
      setError(t('saveError'));
    } finally {
      setSavingId(null);
    }
  }

  async function addCustom() {
    const label = customLabel.trim();
    if (!label) {
      setError(t('customRequired'));
      return;
    }
    setSavingId('custom');
    setError(null);
    try {
      await finishCreate({ customLabel: label });
    } catch {
      setError(t('saveError'));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-2xl" closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <TripModeScheduleFields
          exactTime={exactTime}
          onExactTimeChange={setExactTime}
          onScheduleChange={setSchedule}
          schedule={schedule}
        />

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <section aria-labelledby="trip-mode-trip-places-heading" className="space-y-3">
          <div>
            <h3 className="font-semibold text-foreground" id="trip-mode-trip-places-heading">
              {t('tripPlaces')}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">{t('tripPlacesDescription')}</p>
          </div>
          <SearchField
            disabled={Boolean(savingId)}
            label={t('searchLabel')}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            value={query}
          />
          <div className="max-h-64 overflow-y-auto rounded-[var(--radius-lg)] border border-border">
            {filteredTripPlaces.map((tripPlace) => {
              const details = providerDetails[tripPlace.place.id];
              return (
                <div
                  className="flex min-h-16 items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
                  key={tripPlace.id}
                >
                  <MapPin aria-hidden="true" className="size-4 shrink-0 text-brand" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{placeName(tripPlace)}</p>
                    {details?.formattedAddress ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {details.formattedAddress}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    disabled={Boolean(savingId)}
                    onClick={() => void addExisting(tripPlace)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {savingId === tripPlace.id ? t('adding') : t('add')}
                  </Button>
                </div>
              );
            })}
            {query.trim()
              ? providerResults
                  .filter(
                    (suggestion) =>
                      !tripPlaces.some((tripPlace) =>
                        tripPlace.place.providerRefs.some(
                          (ref) => ref.externalPlaceId === suggestion.externalPlaceId,
                        ),
                      ),
                  )
                  .map((suggestion) => (
                    <div
                      className="flex min-h-16 items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
                      key={suggestion.externalPlaceId}
                    >
                      <Search
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground">{suggestion.name}</p>
                        {suggestion.description ? (
                          <p className="truncate text-xs text-muted-foreground">
                            {suggestion.description}
                          </p>
                        ) : null}
                      </div>
                      <Button
                        disabled={Boolean(savingId)}
                        onClick={() => void addProvider(suggestion)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {savingId === suggestion.externalPlaceId ? t('adding') : t('add')}
                      </Button>
                    </div>
                  ))
              : null}
            {!filteredTripPlaces.length && !providerResults.length && searchStatus !== 'loading' ? (
              <p className="px-3 py-5 text-center text-sm text-muted-foreground">
                {query.trim() ? t('noResults') : t('noTripPlaces')}
              </p>
            ) : null}
          </div>
          {searchStatus === 'loading' ? (
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {t('searching')}
            </p>
          ) : null}
          {searchStatus === 'unavailable' ? (
            <p className="text-sm text-muted-foreground">{t('searchUnavailable')}</p>
          ) : null}
        </section>

        <Field className="border-t border-border pt-5">
          <FieldLabel htmlFor="trip-mode-custom-label">{t('customLabel')}</FieldLabel>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              disabled={Boolean(savingId)}
              id="trip-mode-custom-label"
              maxLength={200}
              onChange={(event) => setCustomLabel(event.target.value)}
              placeholder={t('customPlaceholder')}
              value={customLabel}
            />
            <Button disabled={Boolean(savingId)} onClick={() => void addCustom()} type="button">
              <Plus aria-hidden="true" data-icon="inline-start" />
              {savingId === 'custom' ? t('adding') : t('addCustom')}
            </Button>
          </div>
          <FieldDescription>{t('customDescription')}</FieldDescription>
        </Field>
      </DialogContent>
    </Dialog>
  );
}
