'use client';

import { NotebookPen, Search, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

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
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import {
  ON_DEMAND_SEARCH_MINIMUM,
  useOnDemandPlaceSearch,
} from '@/hooks/use-on-demand-place-search';
import type { ItineraryTripPlace } from '@/lib/itinerary/api';
import {
  filterItineraryTripPlaces,
  type ItineraryIdentity,
  type ItineraryIdentityChoice,
  itineraryProviderSuggestions,
} from '@/lib/itinerary/item-editor';
import type { ScheduledPlaceUse } from '@/lib/itinerary/places';
import {
  createCustomPlace,
  resolveProviderPlace,
  type ProviderSuggestion,
  type SavedPlace,
} from '@/lib/saved/api';
import type { ProviderSearchLocationBias } from '@/lib/saved/provider-search-session';
import { addTripPlace, type TripPlace } from '@/lib/trip-places/api';
import { matchesPlaceQuery } from '@/lib/trip-places/list-view';
import { sortTripPlaces } from '@/lib/trip-places/sort';
import { cn } from '@/lib/utils';
import * as Icons from '@/lib/icons';

/** Saved Places offered before anything is typed; typing searches all of them. */
const SAVED_SHOWN_EMPTY = 6;

type PlaceOption =
  | { kind: 'custom_label'; label: string }
  | { kind: 'custom_place'; label: string }
  | { kind: 'provider'; suggestion: ProviderSuggestion }
  | { kind: 'saved'; label: string; saved: SavedPlace }
  | { kind: 'trip_place'; label: string; tripPlace: ItineraryTripPlace; usageLabel: string | null };

function optionKey(option: PlaceOption) {
  if (option.kind === 'trip_place') return `trip-${option.tripPlace.id}`;
  if (option.kind === 'saved') return `saved-${option.saved.id}`;
  if (option.kind === 'provider') return `provider-${option.suggestion.externalPlaceId}`;
  return `${option.kind}-${option.label}`;
}

function tripPlaceName(tripPlace: ItineraryTripPlace) {
  return (
    tripPlace.customName ??
    tripPlace.place.name ??
    tripPlace.place.snapshot?.name ??
    tripPlace.place.providerLabel ??
    null
  );
}

function savedPlaceName(saved: SavedPlace) {
  return saved.place.snapshot?.name ?? saved.place.name ?? saved.place.providerLabel ?? null;
}

/**
 * What a stop is: a Place on the trip, a Saved Place near it, a new custom
 * Place, a Google result, or simply a plan with no Place at all (PRD 16.2).
 *
 * Nothing is asked of a provider until the traveller asks for it. Before
 * anything is typed the picker shows the trip's own Places and the Saved
 * Places near it, both already on the device; typed text filters those first
 * (PRD 16.2's order) and offers a plan or a new custom Place from the words
 * themselves. Google is one explicit "Search Google for …" away. Whatever is
 * picked becomes a Trip Place before the stop points at it (PRD 15.1), and a
 * pick never makes anything a Saved Place.
 *
 * Offline the trip's own Places and plans still work; everything that has to
 * reach the server to exist does not, and says so.
 */
export function PlaceField({
  identity,
  locationBias,
  onChoose,
  onError,
  onKeepCurrent,
  onOpenPicker,
  onSelectingChange,
  onTripPlaceAdded,
  online,
  pickerOpen,
  placeUse,
  savedPlaces,
  selecting,
  tripId,
  tripPlaces,
}: Readonly<{
  identity: ItineraryIdentity;
  locationBias: ProviderSearchLocationBias | null;
  onChoose: (choice: ItineraryIdentityChoice) => void;
  onError: (message: string | null) => void;
  onKeepCurrent: () => void;
  onOpenPicker: () => void;
  onSelectingChange: (selecting: boolean) => void;
  onTripPlaceAdded: (tripPlace: TripPlace) => void;
  online: boolean;
  pickerOpen: boolean;
  placeUse: Record<string, ScheduledPlaceUse>;
  /** Saved Places near the trip that are not yet among its Places. */
  savedPlaces: readonly SavedPlace[];
  selecting: boolean;
  tripId: string;
  tripPlaces: readonly ItineraryTripPlace[];
}>) {
  const t = useTranslations('itinerary');
  const plannerT = useTranslations('itinerary.planner.editor');
  const tripPlacesT = useTranslations('tripPlaces');
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const search = useOnDemandPlaceSearch(online, locationBias);
  const hasIdentity = Boolean(identity.customLabel.trim() || identity.tripPlaceId);
  const selectedTripPlace = identity.tripPlaceId
    ? (tripPlaces.find((tripPlace) => tripPlace.id === identity.tripPlaceId) ?? null)
    : null;
  const selectedPlaceName = selectedTripPlace ? tripPlaceName(selectedTripPlace) : null;

  const options = useMemo<PlaceOption[]>(() => {
    const dates = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
    const list = new Intl.ListFormat(locale, { style: 'short', type: 'conjunction' });
    const usageLabel = (tripPlace: ItineraryTripPlace) => {
      const used = placeUse[tripPlace.id]?.dayDates ?? [];
      return used.length
        ? tripPlacesT('onDates', {
            dates: list.format(used.map((date) => dates.format(new Date(`${date}T00:00:00Z`)))),
          })
        : null;
    };
    const typed = query.trim();
    const trip = sortTripPlaces(
      filterItineraryTripPlaces([...tripPlaces], query, (tripPlace) => [
        tripPlaceName(tripPlace),
        tripPlace.place.snapshot?.address,
        tripPlace.place.providerAddress,
      ]),
      'name',
      (tripPlace) => tripPlaceName(tripPlace) ?? t('providerPlace'),
    );
    const saved = savedPlaces
      .filter(
        (place) =>
          !typed ||
          matchesPlaceQuery(
            [savedPlaceName(place), place.place.snapshot?.address, place.place.providerAddress],
            typed,
          ),
      )
      .slice(0, typed ? undefined : SAVED_SHOWN_EMPTY);
    const knownExternalIds = new Set(
      [
        ...tripPlaces.map((tripPlace) => tripPlace.place),
        ...savedPlaces.map(({ place }) => place),
      ].flatMap((place) => place.providerRefs.map((reference) => reference.externalPlaceId)),
    );

    return [
      ...trip.map((tripPlace) => ({
        kind: 'trip_place' as const,
        label: tripPlaceName(tripPlace) ?? t('providerPlace'),
        tripPlace,
        usageLabel: usageLabel(tripPlace),
      })),
      ...saved.map((place) => ({
        kind: 'saved' as const,
        label: savedPlaceName(place) ?? t('providerPlace'),
        saved: place,
      })),
      ...itineraryProviderSuggestions(search.results, knownExternalIds).map((suggestion) => ({
        kind: 'provider' as const,
        suggestion,
      })),
      ...(typed ? [{ kind: 'custom_label' as const, label: typed }] : []),
      ...(typed && online ? [{ kind: 'custom_place' as const, label: typed }] : []),
    ];
  }, [locale, online, placeUse, query, savedPlaces, search.results, t, tripPlaces, tripPlacesT]);

  function changeQuery(value: string) {
    setQuery(value);
    search.track(value);
    onError(null);
  }

  /** Makes a Place a Trip Place first, then points the stop at it. */
  async function adopt(add: () => Promise<TripPlace>) {
    onSelectingChange(true);
    onError(null);
    try {
      const tripPlace = await add();
      onTripPlaceAdded(tripPlace);
      onChoose({ kind: 'trip_place', tripPlaceId: tripPlace.id });
      changeQuery('');
    } catch {
      onError(t('placeSelectionError'));
    } finally {
      onSelectingChange(false);
    }
  }

  function choose(option: PlaceOption | null) {
    if (!option) return;
    if (option.kind === 'trip_place') {
      onChoose({ kind: 'trip_place', tripPlaceId: option.tripPlace.id });
      changeQuery('');
      return;
    }
    if (option.kind === 'custom_label') {
      onChoose({ kind: 'custom_label', label: option.label });
      changeQuery('');
      return;
    }
    if (option.kind === 'saved') {
      void adopt(async () => (await addTripPlace(tripId, option.saved.place.id)).tripPlace);
      return;
    }
    if (option.kind === 'custom_place') {
      void adopt(async () => {
        const { place } = await createCustomPlace({ name: option.label });
        return (await addTripPlace(tripId, place.id)).tripPlace;
      });
      return;
    }
    void adopt(async () => {
      const { place } = await resolveProviderPlace(
        option.suggestion.externalPlaceId,
        { address: option.suggestion.description, name: option.suggestion.name },
        locale,
        search.sessionToken ?? undefined,
        'itinerary',
      );
      return (await addTripPlace(tripId, place.id)).tripPlace;
    });
  }

  const typed = query.trim();

  return (
    <>
      {hasIdentity ? (
        <div className="rounded-[var(--radius-lg)] border bg-muted/30 p-3">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-background text-muted-foreground shadow-xs">
              {identity.tripPlaceId ? (
                <Icons.Place aria-hidden="true" className="size-4" />
              ) : (
                <NotebookPen aria-hidden="true" className="size-4" />
              )}
            </div>
            <div className="flex min-h-9 min-w-0 flex-1 flex-col justify-center">
              <p className="truncate text-sm font-medium">
                {identity.customLabel || selectedPlaceName}
              </p>
              {identity.customLabel && selectedPlaceName ? (
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
                onClick={onOpenPicker}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t('change')}
              </Button>
              <Button
                aria-label={t('clearIdentity')}
                onClick={() => {
                  onChoose({ kind: 'clear' });
                  changeQuery('');
                }}
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

      {!hasIdentity || pickerOpen ? (
        <Field>
          <FieldLabel htmlFor="stop-editor-place">{t('placeOrPlan')}</FieldLabel>
          <Combobox<PlaceOption>
            disabled={selecting}
            filteredItems={options}
            inputValue={query}
            items={options}
            itemToStringLabel={(option) =>
              !option ? '' : option.kind === 'provider' ? option.suggestion.name : option.label
            }
            onInputValueChange={changeQuery}
            onValueChange={choose}
          >
            <ComboboxInput
              autoComplete="off"
              autoFocus={!hasIdentity || pickerOpen}
              className="h-11 w-full min-w-0 rounded-[var(--radius-md)] border border-input bg-background py-2 text-base shadow-[var(--shadow-control)] md:text-sm"
              clearLabel={t('clearPlaceQuery')}
              id="stop-editor-place"
              placeholder={t('placeOrPlanPlaceholder')}
              showClear={Boolean(query)}
              triggerLabel={t('openPlacePicker')}
            />
            <ComboboxContent>
              <ComboboxEmpty>{t('placePickerEmpty')}</ComboboxEmpty>
              <ComboboxList>
                {(option: PlaceOption) => (
                  <ComboboxItem
                    className={cn(
                      'min-h-12 gap-3 px-3 py-2 pr-9',
                      option.kind === 'provider' && 'bg-muted/25',
                      option.kind === 'trip_place' &&
                        option.usageLabel &&
                        'bg-brand/5 data-highlighted:bg-brand/10',
                    )}
                    key={optionKey(option)}
                    value={option}
                  >
                    {option.kind === 'trip_place' ? (
                      <Icons.Place aria-hidden="true" className="text-muted-foreground" />
                    ) : option.kind === 'saved' ? (
                      <Icons.Saved aria-hidden="true" className="text-muted-foreground" />
                    ) : option.kind === 'custom_label' ? (
                      <NotebookPen aria-hidden="true" className="text-muted-foreground" />
                    ) : option.kind === 'custom_place' ? (
                      <Icons.CustomPlace aria-hidden="true" className="text-muted-foreground" />
                    ) : (
                      <Search aria-hidden="true" className="text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                        <span className="min-w-0 truncate">
                          {option.kind === 'custom_label'
                            ? t('useCustomPlan', { label: option.label })
                            : option.kind === 'custom_place'
                              ? plannerT('addCustomPlace', { name: option.label })
                              : option.kind === 'provider'
                                ? option.suggestion.name
                                : option.label}
                        </span>
                        {option.kind === 'trip_place' && option.usageLabel ? (
                          <Badge className="max-w-44" size="sm">
                            <Icons.Success aria-hidden="true" className="size-3" />
                            <span className="truncate">{option.usageLabel}</span>
                          </Badge>
                        ) : option.kind === 'saved' ? (
                          <Badge size="sm" variant="muted">
                            {plannerT('savedBadge')}
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
                      ) : option.kind === 'saved' &&
                        (option.saved.place.snapshot?.address ||
                          option.saved.place.providerAddress) ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {option.saved.place.snapshot?.address ??
                            option.saved.place.providerAddress}
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
              {typed ? (
                <div className="space-y-2 border-t p-2">
                  {search.results.length ? (
                    <p className="px-1 text-right text-xs font-normal tracking-normal text-muted-foreground">
                      <span translate="no">{t('googleMapsAttribution')}</span>
                    </p>
                  ) : search.status === 'loading' ? (
                    <p className="px-1 text-xs text-muted-foreground" role="status">
                      {t('searchingPlaces')}
                    </p>
                  ) : search.status === 'unavailable' ? (
                    <p className="px-1 text-xs text-muted-foreground" role="status">
                      {t('providerSearchUnavailable')}
                    </p>
                  ) : search.asked(typed) ? (
                    <p className="px-1 text-xs text-muted-foreground" role="status">
                      {t('googleSearchEmpty')}
                    </p>
                  ) : !online ? (
                    <p className="px-1 text-xs text-muted-foreground">{t('googleSearchOffline')}</p>
                  ) : typed.length < ON_DEMAND_SEARCH_MINIMUM ? (
                    <p className="px-1 text-xs text-muted-foreground">{t('googleSearchMinimum')}</p>
                  ) : (
                    <Button
                      className="w-full justify-start"
                      onClick={() => void search.search(typed)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <Search aria-hidden="true" />
                      {t('searchGoogle', { query: typed })}
                    </Button>
                  )}
                </div>
              ) : null}
            </ComboboxContent>
          </Combobox>
          <FieldDescription>{t('placeOrPlanHint')}</FieldDescription>
          {hasIdentity ? (
            <Button
              className="self-start px-0"
              onClick={() => {
                onKeepCurrent();
                changeQuery('');
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
    </>
  );
}
