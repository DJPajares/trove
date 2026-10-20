'use client';

import { useQuery } from '@tanstack/react-query';
import { CircleAlert, Pencil, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { GoogleSearchRow } from '@/components/place-search/google-search-row';
import { PlaceRow, ResultGroup } from '@/components/place-search/result-list';
import { SearchField } from '@/components/search-field';
import { useTripContext } from '@/components/trip-provider';
import { useOnlineStatus } from '@/components/trip-sync-status';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeading } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { useKnownPlaces } from '@/hooks/use-known-places';
import { useOnDemandPlaceSearch } from '@/hooks/use-on-demand-place-search';
import {
  knownExternalIds,
  localPlaceAddress,
  localPlaceName,
  matchLocalPlaces,
  providerResults,
  type LocalPlaceRecord,
} from '@/lib/places/local-search';
import {
  createCustomPlace,
  fetchSavedPlaces,
  type ProviderSuggestion,
  resolveProviderPlace,
  type SavedPlace,
} from '@/lib/saved/api';
import { destinationLocationBias } from '@/lib/saved/provider-search-session';
import { addTripPlace, type TripPlace } from '@/lib/trip-places/api';
import { isAccommodation } from '@/lib/trip-places/categories';
import type { TrovePlaceCategory } from '@/lib/place-categories';
import { queryKeys } from '@/lib/query/keys';
import * as Icons from '@/lib/icons';

type AddTripPlaceSheetProps = {
  finalFocus?: () => HTMLElement | boolean;
  /** A search to start from, such as one that found nothing among the trip's own places. */
  initialQuery?: string;
  onAdded: (tripPlace: TripPlace) => void;
  onOpenChange: (open: boolean) => void;
  /** Picking somewhere this trip already has, which only a Stay can use. */
  onUseExisting?: (tripPlaceId: string) => void;
  /** Looking for somewhere to stay puts places to sleep first, in every group. */
  purpose?: 'place' | 'stay';
  /** Places already on the trip, so this never offers to add one twice. */
  tripPlaces: ReadonlyArray<{
    categories?: TrovePlaceCategory[];
    customName: string | null;
    id: string;
    place: LocalPlaceRecord;
  }>;
  tripId: string;
};

const EMPTY_SAVED_PLACES: SavedPlace[] = [];

/**
 * Adding a Place to a trip, in one field.
 *
 * Typing searches only what Trove already knows - this trip, Saved Places, and
 * the traveller's other trips - so it answers at once and costs nothing at the
 * provider. Google is one deliberate step below those answers, never a request
 * per keystroke (PRD 16.1), and creating a custom Place is always at the end.
 */
export function AddTripPlaceSheet({
  finalFocus,
  initialQuery = '',
  onAdded,
  onOpenChange,
  onUseExisting,
  purpose = 'place',
  tripId,
  tripPlaces,
}: Readonly<AddTripPlaceSheetProps>) {
  const t = useTranslations('tripPlaces');
  const locale = useLocale();
  const online = useOnlineStatus();
  const stay = purpose === 'stay';
  const [query, setQuery] = useState(initialQuery);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Which row has its name field open — only ever one, like `busyId`. */
  const [namingId, setNamingId] = useState<string | null>(null);
  const [nameValue, setNameValue] = useState('');
  const [error, setError] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customNote, setCustomNote] = useState('');
  const [creating, setCreating] = useState(false);

  // Both lists come from Trove's own database and are shared, persisted
  // queries: reopening this sheet asks for nothing, and they still answer
  // offline. Failing to load one only means fewer local answers.
  const savedPlaces =
    useQuery({ queryFn: fetchSavedPlaces, queryKey: queryKeys.savedPlaces() }).data?.savedPlaces ??
    EMPTY_SAVED_PLACES;
  const knownPlaces = useKnownPlaces();

  // Google is asked only on request, near where the trip is going, and each
  // answer is kept per query so typing back to it costs nothing.
  const destinations = useTripContext()?.trip?.destinations;
  const locationBias = useMemo(() => destinationLocationBias(destinations ?? []), [destinations]);
  const search = useOnDemandPlaceSearch(online, locationBias);
  const { track } = search;
  useEffect(() => track(initialQuery), [initialQuery, track]);

  const local = useMemo(() => {
    // A place already on the trip is never offered to add again. Looking for a
    // stay, only the trip's places to sleep are offered as one: the Stay sheet
    // already lists every other trip place.
    const onTrip = new Set(tripPlaces.map((tripPlace) => tripPlace.place.id));
    const elsewhere = <T extends { place: { id: string } }>(entries: readonly T[]) =>
      entries.filter((entry) => !onTrip.has(entry.place.id));
    return matchLocalPlaces(
      query,
      {
        known: elsewhere(knownPlaces),
        saved: elsewhere(savedPlaces),
        trip: stay ? tripPlaces.filter(isAccommodation) : tripPlaces,
      },
      { stay },
    );
  }, [knownPlaces, query, savedPlaces, stay, tripPlaces]);
  const googleResults = useMemo(
    () =>
      providerResults(search.results, knownExternalIds(tripPlaces, local.saved, local.known), {
        stay,
      }),
    [local.known, local.saved, search.results, stay, tripPlaces],
  );

  function changeQuery(value: string) {
    setQuery(value);
    track(value);
  }

  function closeNaming() {
    setNamingId(null);
    setNameValue('');
  }

  async function add(placeId: string, busyKey: string, customName?: string | null) {
    setBusyId(busyKey);
    setError(false);
    try {
      const { tripPlace } = await addTripPlace(tripId, placeId, { customName });
      onAdded(tripPlace);
      closeNaming();
      return true;
    } catch {
      setError(true);
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function addProvider(suggestion: ProviderSuggestion, customName?: string | null) {
    setBusyId(suggestion.externalPlaceId);
    setError(false);
    try {
      // The text the traveller just read is worth keeping: it is what names this
      // Place on a day Google cannot be reached. The answer's session token ends
      // the search session here, so searching and picking bill as one.
      const { place } = await resolveProviderPlace(
        suggestion.externalPlaceId,
        { address: suggestion.description, name: suggestion.name },
        locale,
        search.sessionToken ?? undefined,
        'itinerary',
      );
      const { tripPlace } = await addTripPlace(tripId, place.id, { customName });
      onAdded(tripPlace);
      closeNaming();
    } catch {
      setError(true);
    } finally {
      setBusyId(null);
    }
  }

  /**
   * The name field a row reveals. Adding stays one click by default; this is only
   * for when the traveller already knows what they want to call the place.
   */
  const namingField = (key: string, onSubmit: (customName: string) => void) =>
    namingId === key ? (
      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (nameValue.trim()) onSubmit(nameValue.trim());
        }}
      >
        <Input
          aria-label={t('nameItLabel')}
          autoFocus
          className="min-w-0 flex-1"
          maxLength={200}
          onChange={(event) => setNameValue(event.target.value)}
          placeholder={t('nameItPlaceholder')}
          value={nameValue}
        />
        <Button onClick={closeNaming} size="sm" type="button" variant="ghost">
          {t('cancel')}
        </Button>
        <Button disabled={busyId === key || !nameValue.trim()} size="sm" type="submit">
          {busyId === key ? t('adding') : t('add')}
        </Button>
      </form>
    ) : null;

  /** Add, with a pencil to name it first. */
  const addActions = (key: string, label: string, onAdd: (customName?: string) => void) => (
    <>
      {namingId === key ? null : (
        <Button
          aria-label={t('nameItAction', { name: label })}
          onClick={() => {
            setNamingId(key);
            setNameValue(label);
          }}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Pencil aria-hidden="true" />
        </Button>
      )}
      <Button disabled={busyId === key} onClick={() => onAdd()} size="sm" variant="outline">
        {busyId === key ? t('adding') : t('add')}
      </Button>
    </>
  );

  async function createCustom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customName.trim()) return;
    setCreating(true);
    setError(false);
    try {
      const { place } = await createCustomPlace({ name: customName, note: customNote || null });
      if (await add(place.id, place.id)) {
        setCustomOpen(false);
        setCustomName('');
        changeQuery('');
        setCustomNote('');
      }
    } catch {
      setError(true);
    } finally {
      setCreating(false);
    }
  }

  const typed = query.trim();
  const unnamed = t('providerPlace');

  return (
    <Sheet onOpenChange={onOpenChange} open>
      <SheetContent
        finalFocus={finalFocus}
        className="w-full md:data-[side=right]:w-[min(34rem,calc(100%-0.5rem))]"
        closeLabel={t('close')}
      >
        <SheetHeading title={t('addPlaceTitle')} description={t('addPlaceDescription')} />

        <div className="min-h-0 space-y-5 overflow-y-auto p-5">
          <SearchField
            autoFocus
            enterKeyHint="search"
            label={t('searchLabel')}
            onChange={(event) => changeQuery(event.target.value)}
            onKeyDown={(event) => {
              // Enter is the keyboard's way of asking to look further.
              if (event.key !== 'Enter') return;
              event.preventDefault();
              if (search.canSearch(typed)) void search.search(typed);
            }}
            placeholder={t(stay ? 'searchStayPlaceholder' : 'searchPlaceholder')}
            value={query}
          />

          {error ? (
            <Alert role="alert" variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{t('actionError')}</AlertDescription>
            </Alert>
          ) : null}

          {!typed ? (
            <p className="text-sm leading-6 text-muted-foreground">{t('searchHint')}</p>
          ) : (
            <div className="space-y-5">
              {local.trip.length ? (
                <ResultGroup heading={t('onTripHeading')}>
                  {local.trip.map((tripPlace) => (
                    <PlaceRow
                      description={localPlaceAddress(tripPlace.place)}
                      icon={<Icons.Place aria-hidden="true" />}
                      key={tripPlace.id}
                      title={localPlaceName(tripPlace.place, tripPlace.customName) ?? unnamed}
                    >
                      {onUseExisting ? (
                        <Button
                          onClick={() => onUseExisting(tripPlace.id)}
                          size="sm"
                          variant="outline"
                        >
                          {t('useAsStay')}
                        </Button>
                      ) : (
                        <Badge variant="muted">{t('added')}</Badge>
                      )}
                    </PlaceRow>
                  ))}
                </ResultGroup>
              ) : null}

              {local.saved.length ? (
                <ResultGroup heading={t('savedResultsHeading')}>
                  {local.saved.map((savedPlace) => {
                    const name = localPlaceName(savedPlace.place) ?? unnamed;
                    return (
                      <PlaceRow
                        description={localPlaceAddress(savedPlace.place)}
                        icon={
                          savedPlace.place.kind === 'custom' ? (
                            <Icons.CustomPlace aria-hidden="true" />
                          ) : (
                            <Icons.Saved aria-hidden="true" />
                          )
                        }
                        key={savedPlace.id}
                        naming={namingField(
                          savedPlace.place.id,
                          (customName) =>
                            void add(savedPlace.place.id, savedPlace.place.id, customName),
                        )}
                        title={name}
                      >
                        {addActions(
                          savedPlace.place.id,
                          name,
                          (customName) =>
                            void add(savedPlace.place.id, savedPlace.place.id, customName),
                        )}
                      </PlaceRow>
                    );
                  })}
                </ResultGroup>
              ) : null}

              {local.known.length ? (
                <ResultGroup heading={t('knownResultsHeading')}>
                  {local.known.map((known) => {
                    const name = localPlaceName(known.place, known.tripName) ?? unnamed;
                    return (
                      <PlaceRow
                        description={localPlaceAddress(known.place)}
                        hint={known.lastTrip ? t('fromTrip', { trip: known.lastTrip.name }) : null}
                        icon={<Icons.Trips aria-hidden="true" />}
                        key={known.place.id}
                        naming={namingField(
                          known.place.id,
                          (customName) => void add(known.place.id, known.place.id, customName),
                        )}
                        title={name}
                      >
                        {addActions(
                          known.place.id,
                          name,
                          (customName) => void add(known.place.id, known.place.id, customName),
                        )}
                      </PlaceRow>
                    );
                  })}
                </ResultGroup>
              ) : null}

              {googleResults.length ? (
                <ResultGroup heading={t('resultsHeading')}>
                  {googleResults.map((suggestion) => (
                    <PlaceRow
                      description={suggestion.description ?? unnamed}
                      icon={<Icons.Places aria-hidden="true" />}
                      key={suggestion.externalPlaceId}
                      naming={namingField(
                        suggestion.externalPlaceId,
                        (customName) => void addProvider(suggestion, customName),
                      )}
                      provider
                      title={suggestion.name}
                    >
                      {addActions(
                        suggestion.externalPlaceId,
                        suggestion.name,
                        (customName) => void addProvider(suggestion, customName),
                      )}
                    </PlaceRow>
                  ))}
                </ResultGroup>
              ) : null}

              <GoogleSearchRow
                online={online}
                prominent={!local.total && !googleResults.length}
                query={typed}
                search={search}
              />
            </div>
          )}

          {/* Always reachable: whatever the search turns up, a place Trove has never
              heard of is still a place the traveller can go. */}
          <div className="border-t border-border pt-4">
            {customOpen ? (
              <form className="space-y-4" onSubmit={(event) => void createCustom(event)}>
                <Field>
                  <FieldLabel htmlFor="add-place-custom-name">{t('customName')}</FieldLabel>
                  <Input
                    autoFocus
                    id="add-place-custom-name"
                    maxLength={200}
                    onChange={(event) => setCustomName(event.target.value)}
                    placeholder={t('customNamePlaceholder')}
                    required
                    value={customName}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="add-place-custom-note">{t('customNote')}</FieldLabel>
                  <Textarea
                    id="add-place-custom-note"
                    maxLength={2000}
                    onChange={(event) => setCustomNote(event.target.value)}
                    placeholder={t('customNotePlaceholder')}
                    rows={3}
                    value={customNote}
                  />
                </Field>
                <div className="flex justify-end gap-2">
                  <Button onClick={() => setCustomOpen(false)} type="button" variant="ghost">
                    {t('cancel')}
                  </Button>
                  <Button disabled={creating || !customName.trim()} type="submit">
                    {creating ? t('adding') : t('addCustomPlace')}
                  </Button>
                </div>
              </form>
            ) : (
              <Button
                className="w-full"
                onClick={() => {
                  setCustomName(typed);
                  setCustomOpen(true);
                }}
                variant="outline"
              >
                <Plus aria-hidden="true" data-icon="inline-start" />
                {typed ? t('createNamedCustomPlace', { name: typed }) : t('createCustomPlace')}
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
