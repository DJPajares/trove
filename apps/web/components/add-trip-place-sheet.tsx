'use client';

import { useQuery } from '@tanstack/react-query';
import { Bookmark, CircleAlert, MapPinned, NotebookPen, Pencil, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { SearchField } from '@/components/search-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  createCustomPlace,
  fetchSavedPlaces,
  GOOGLE_PLACES_SEARCH_DEBOUNCE_MS,
  type ProviderSuggestion,
  resolveProviderPlace,
  type SavedPlace,
  searchProviderPlaces,
} from '@/lib/saved/api';
import { PROVIDER_SEARCH_RESULT_LIMIT } from '@/lib/saved/search-results';
import { addTripPlace, type TripPlace } from '@/lib/trip-places/api';
import { queryKeys } from '@/lib/query/keys';

type AddTripPlaceSheetProps = {
  onAdded: (tripPlace: TripPlace) => void;
  onOpenChange: (open: boolean) => void;
  /** Places already on the trip, so this never offers to add one twice. */
  tripPlaces: TripPlace[];
  tripId: string;
};

/**
 * Adding a Place to a trip, in one field.
 *
 * The old flow asked which kind of place you wanted before you knew whether it
 * existed. Here the search is the whole surface: Saved Places first, provider
 * results once there is something to search for, and creating a custom Place is
 * always available at the bottom rather than behind a mode.
 *
 * An empty field never calls the provider, per PRD section 16.1.
 */
const EMPTY_SAVED_PLACES: SavedPlace[] = [];

export function AddTripPlaceSheet({
  onAdded,
  onOpenChange,
  tripId,
  tripPlaces,
}: Readonly<AddTripPlaceSheetProps>) {
  const t = useTranslations('tripPlaces');
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProviderSuggestion[]>([]);
  const [searchStatus, setSearchStatus] = useState<'empty' | 'idle' | 'loading' | 'unavailable'>(
    'idle',
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Which row has its name field open — only ever one, like `busyId`. */
  const [namingId, setNamingId] = useState<string | null>(null);
  const [nameValue, setNameValue] = useState('');
  const [error, setError] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customNote, setCustomNote] = useState('');
  const [creating, setCreating] = useState(false);

  // Saved Places answer the search locally, and they arrive already named — the
  // API serves what Trove stored, so this costs nothing at the provider. The
  // shared cache means opening this sheet a second time asks for nothing at
  // all. Failing to load them costs the traveller nothing they can see: the
  // provider search still works.
  const savedPlaces =
    useQuery({ queryFn: fetchSavedPlaces, queryKey: queryKeys.savedPlaces() }).data?.savedPlaces ??
    EMPTY_SAVED_PLACES;

  // Nothing typed means nothing to ask the provider about.
  useEffect(() => {
    const input = query.trim();
    if (!input) {
      setResults([]);
      setSearchStatus('idle');
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setSearchStatus('loading');
      void searchProviderPlaces(input, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          if (result.status === 'unavailable') {
            setResults([]);
            setSearchStatus('unavailable');
            return;
          }
          setResults(result.suggestions ?? []);
          setSearchStatus(result.status === 'empty' ? 'empty' : 'idle');
        })
        .catch((cause: unknown) => {
          if (
            controller.signal.aborted ||
            (cause instanceof DOMException && cause.name === 'AbortError')
          ) {
            return;
          }
          setResults([]);
          setSearchStatus('unavailable');
        });
    }, GOOGLE_PLACES_SEARCH_DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [query]);

  const savedName = (savedPlace: SavedPlace) =>
    savedPlace.place.kind === 'custom'
      ? (savedPlace.place.name ?? t('customPlace'))
      : (savedPlace.place.snapshot?.name ?? savedPlace.place.providerLabel ?? t('providerPlace'));

  const savedDescription = (savedPlace: SavedPlace) =>
    savedPlace.place.kind === 'custom'
      ? (savedPlace.place.note ?? t('customPlaceDescription'))
      : (savedPlace.place.snapshot?.address ??
        savedPlace.place.providerAddress ??
        t('providerDetailsUnavailable'));

  // Saved Places answer the query from what Trove already knows, so they are matched
  // here rather than asked of the provider. Nothing is listed before there is a query.
  const matchingSaved = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return [];
    return savedPlaces
      .toSorted((left, right) => savedName(left).localeCompare(savedName(right)))
      .filter((savedPlace) =>
        [savedName(savedPlace), savedDescription(savedPlace)].some((value) =>
          value.toLocaleLowerCase().includes(needle),
        ),
      );
    // savedName reads only from the Places themselves, so the list is complete
    // the moment they load rather than settling as names arrive.
  }, [query, savedPlaces]);

  /**
   * One list, so the question is "what can I add?" rather than "which section is it in?".
   * A suggestion already on the trip, or already answered by a Saved Place above it,
   * would only be the same Place a second time.
   */
  const providerResults = useMemo(() => {
    const known = new Set(
      [
        ...tripPlaces.flatMap((tripPlace) => tripPlace.place.providerRefs),
        ...matchingSaved.flatMap((savedPlace) => savedPlace.place.providerRefs),
      ].map((reference) => reference.externalPlaceId),
    );
    return results
      .filter((suggestion) => !known.has(suggestion.externalPlaceId))
      .slice(0, PROVIDER_SEARCH_RESULT_LIMIT);
  }, [matchingSaved, results, tripPlaces]);

  const alreadyOnTrip = (placeId: string) =>
    tripPlaces.some((tripPlace) => tripPlace.place.id === placeId);

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
      // Place on a day Google cannot be reached.
      const { place } = await resolveProviderPlace(
        suggestion.externalPlaceId,
        { address: suggestion.description, name: suggestion.name },
        locale,
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

  const nameItButton = (key: string, seedName: string, label: string) => (
    <Button
      aria-label={t('nameItAction', { name: label })}
      onClick={() => {
        setNamingId(key);
        setNameValue(seedName);
      }}
      size="icon-sm"
      type="button"
      variant="ghost"
    >
      <Pencil aria-hidden="true" />
    </Button>
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
        setCustomNote('');
        setQuery('');
      }
    } catch {
      setError(true);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Sheet onOpenChange={onOpenChange} open>
      <SheetContent
        className="w-full md:data-[side=right]:w-[min(34rem,calc(100%-0.5rem))]"
        closeLabel={t('close')}
      >
        <SheetHeader className="border-b">
          <SheetTitle>{t('addPlaceTitle')}</SheetTitle>
          <SheetDescription>{t('addPlaceDescription')}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 space-y-5 overflow-y-auto p-5">
          <SearchField
            autoFocus
            label={t('searchLabel')}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            value={query}
          />

          {error ? (
            <Alert role="alert" variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{t('actionError')}</AlertDescription>
            </Alert>
          ) : null}

          {!query.trim() ? (
            <p className="text-sm leading-6 text-muted-foreground">{t('searchHint')}</p>
          ) : searchStatus === 'unavailable' && !matchingSaved.length ? (
            <Alert role="alert" variant="warning">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{t('searchUnavailable')}</AlertDescription>
            </Alert>
          ) : matchingSaved.length || providerResults.length ? (
            <div className="space-y-5">
              {/* Two headed groups rather than one flat list with a badge per row:
                  which places are already the traveller's own is worth knowing
                  before reading a single result. */}
              {matchingSaved.length ? (
                <div className="space-y-2">
                  <h2 className="text-sm font-medium">{t('savedResultsHeading')}</h2>
                  <ItemGroup aria-label={t('savedResultsHeading')} className="gap-2">
                    {matchingSaved.map((savedPlace) => {
                      const existing = alreadyOnTrip(savedPlace.place.id);
                      return (
                        <Item className="gap-3 px-3 py-3" key={savedPlace.id} variant="outline">
                          <ItemMedia
                            className="size-10 rounded-[var(--radius-md)] bg-secondary text-secondary-foreground"
                            variant="icon"
                          >
                            {savedPlace.place.kind === 'custom' ? (
                              <NotebookPen aria-hidden="true" />
                            ) : (
                              <Bookmark aria-hidden="true" />
                            )}
                          </ItemMedia>
                          <ItemContent className="min-w-0">
                            <ItemTitle className="min-w-0 truncate">
                              {savedName(savedPlace)}
                            </ItemTitle>
                            <ItemDescription>{savedDescription(savedPlace)}</ItemDescription>
                            {namingField(
                              savedPlace.place.id,
                              (customName) =>
                                void add(savedPlace.place.id, savedPlace.place.id, customName),
                            )}
                          </ItemContent>
                          <ItemActions className="shrink-0">
                            {existing || namingId === savedPlace.place.id
                              ? null
                              : nameItButton(
                                  savedPlace.place.id,
                                  savedName(savedPlace),
                                  savedName(savedPlace),
                                )}
                            <Button
                              disabled={existing || busyId === savedPlace.place.id}
                              onClick={() => void add(savedPlace.place.id, savedPlace.place.id)}
                              size="sm"
                              variant={existing ? 'secondary' : 'outline'}
                            >
                              {existing
                                ? t('added')
                                : busyId === savedPlace.place.id
                                  ? t('adding')
                                  : t('add')}
                            </Button>
                          </ItemActions>
                        </Item>
                      );
                    })}
                  </ItemGroup>
                </div>
              ) : null}

              {providerResults.length ? (
                <div className="space-y-2">
                  <h2 className="text-sm font-medium">{t('resultsHeading')}</h2>
                  <ItemGroup aria-label={t('resultsHeading')} className="gap-2">
                    {providerResults.map((suggestion) => (
                      <Item
                        className="gap-3 px-3 py-3"
                        key={suggestion.externalPlaceId}
                        variant="outline"
                      >
                        <ItemMedia
                          className="size-10 rounded-[var(--radius-md)] bg-brand/10 text-brand"
                          variant="icon"
                        >
                          <MapPinned aria-hidden="true" />
                        </ItemMedia>
                        <ItemContent className="min-w-0">
                          <ItemTitle>{suggestion.name}</ItemTitle>
                          <ItemDescription>
                            {suggestion.description ?? t('providerPlace')}
                          </ItemDescription>
                          {namingField(
                            suggestion.externalPlaceId,
                            (customName) => void addProvider(suggestion, customName),
                          )}
                        </ItemContent>
                        <ItemActions className="shrink-0">
                          {namingId === suggestion.externalPlaceId
                            ? null
                            : nameItButton(
                                suggestion.externalPlaceId,
                                suggestion.name,
                                suggestion.name,
                              )}
                          <Button
                            disabled={busyId === suggestion.externalPlaceId}
                            onClick={() => void addProvider(suggestion)}
                            size="sm"
                            variant="outline"
                          >
                            {busyId === suggestion.externalPlaceId ? t('adding') : t('add')}
                          </Button>
                        </ItemActions>
                      </Item>
                    ))}
                  </ItemGroup>
                </div>
              ) : null}
            </div>
          ) : searchStatus === 'loading' ? (
            <p aria-live="polite" className="text-sm text-muted-foreground" role="status">
              {t('searching')}
            </p>
          ) : searchStatus === 'empty' || searchStatus === 'idle' ? (
            <p className="text-sm leading-6 text-muted-foreground">{t('noSearchResults')}</p>
          ) : null}

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
                  setCustomName(query.trim());
                  setCustomOpen(true);
                }}
                variant="outline"
              >
                <Plus aria-hidden="true" data-icon="inline-start" />
                {query.trim()
                  ? t('createNamedCustomPlace', { name: query.trim() })
                  : t('createCustomPlace')}
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
