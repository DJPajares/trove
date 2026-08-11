'use client';

import {
  ArrowLeft,
  Bookmark,
  CircleAlert,
  MapPinned,
  NotebookPen,
  Plus,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { PageHeader } from '@/components/page-header';
import { PageState } from '@/components/page-state';
import { SearchField } from '@/components/search-field';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  cacheProviderPlaceDetails,
  createCustomPlace,
  fetchSavedPlaces,
  getCachedProviderPlaceDetails,
  GOOGLE_PLACES_SEARCH_DEBOUNCE_MS,
  getProviderPlaceDetails,
  type ProviderPlaceDetails,
  type ProviderSuggestion,
  resolveProviderPlace,
  type SavedPlace,
  searchProviderPlaces,
} from '@/lib/saved/api';
import {
  addTripPlace,
  fetchTripPlaces,
  removeTripPlace,
  TripPlaceApiError,
  type TripPlace,
  type TripPlacePriority,
  updateTripPlace,
} from '@/lib/trip-places/api';

type ProviderDetails = Record<string, ProviderPlaceDetails | null | undefined>;

function priorityRank(priority: TripPlacePriority | null) {
  return priority === 'must_go' ? 0 : priority === 'interested' ? 1 : priority === 'maybe' ? 2 : 3;
}

export function TripPlacesManager({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('tripPlaces');
  const [tripName, setTripName] = useState('');
  const [tripPlaces, setTripPlaces] = useState<TripPlace[]>([]);
  const [providerDetails, setProviderDetails] = useState<ProviderDetails>({});
  const [status, setStatus] = useState<'error' | 'idle' | 'loading'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<'custom' | 'search'>('search');
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [addStatus, setAddStatus] = useState<'error' | 'idle' | 'loading'>('idle');
  const [addingPlaceId, setAddingPlaceId] = useState<string | null>(null);
  const [addingProviderId, setAddingProviderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProviderSuggestion[]>([]);
  const [searchStatus, setSearchStatus] = useState<'empty' | 'idle' | 'loading' | 'unavailable'>(
    'idle',
  );
  const [customName, setCustomName] = useState('');
  const [customNote, setCustomNote] = useState('');
  const [creatingCustom, setCreatingCustom] = useState(false);
  const [notePlace, setNotePlace] = useState<TripPlace | null>(null);
  const [noteValue, setNoteValue] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [removingPlace, setRemovingPlace] = useState<TripPlace | null>(null);
  const [removing, setRemoving] = useState(false);

  const refresh = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const result = await fetchTripPlaces(tripId);
      setTripName(result.trip.name);
      setTripPlaces(result.tripPlaces);
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  }, [tripId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const pending = tripPlaces.filter(
      (item) =>
        item.place.kind === 'provider' &&
        providerDetails[item.place.id] === undefined &&
        item.place.providerRefs[0],
    );
    if (!pending.length) return;
    let active = true;
    void Promise.all(
      pending.map(async (item) => {
        const providerId = item.place.providerRefs[0]?.externalPlaceId;
        if (!providerId) return { id: item.place.id, details: null };
        try {
          const result = await getProviderPlaceDetails(providerId);
          return {
            id: item.place.id,
            details: result.status === 'ok' ? (result.place ?? null) : null,
          };
        } catch {
          return { id: item.place.id, details: null };
        }
      }),
    ).then((results) => {
      if (!active) return;
      setProviderDetails((current) => ({
        ...current,
        ...Object.fromEntries(results.map((result) => [result.id, result.details])),
      }));
    });
    return () => {
      active = false;
    };
  }, [providerDetails, tripPlaces]);

  useEffect(() => {
    const input = searchQuery.trim();
    if (!input) {
      setSearchResults([]);
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
            setSearchResults([]);
            setSearchStatus('unavailable');
            return;
          }
          setSearchResults(result.suggestions ?? []);
          setSearchStatus(result.status === 'empty' ? 'empty' : 'idle');
        })
        .catch((cause: unknown) => {
          if (
            controller.signal.aborted ||
            (cause instanceof DOMException && cause.name === 'AbortError')
          ) {
            return;
          }
          setSearchResults([]);
          setSearchStatus('unavailable');
        });
    }, GOOGLE_PLACES_SEARCH_DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [searchQuery]);

  const sortedPlaces = useMemo(
    () =>
      tripPlaces.toSorted(
        (left, right) =>
          priorityRank(left.priority) - priorityRank(right.priority) ||
          left.createdAt.localeCompare(right.createdAt),
      ),
    [tripPlaces],
  );

  const matchingSavedPlaces = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return savedPlaces;

    const matchingProviderIds = new Set(
      searchResults.map((suggestion) => suggestion.externalPlaceId),
    );
    return savedPlaces.filter((savedPlace) => {
      if (savedPlace.place.kind === 'custom') {
        return [savedPlace.place.name, savedPlace.place.note]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLocaleLowerCase().includes(query));
      }

      const details = providerDetails[savedPlace.place.id];
      return (
        [details?.name, details?.formattedAddress]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLocaleLowerCase().includes(query)) ||
        savedPlace.place.providerRefs.some((reference) =>
          matchingProviderIds.has(reference.externalPlaceId),
        )
      );
    });
  }, [providerDetails, savedPlaces, searchQuery, searchResults]);

  const providerResults = useMemo(() => {
    const savedProviderIds = new Set(
      savedPlaces.flatMap((savedPlace) =>
        savedPlace.place.providerRefs.map((reference) => reference.externalPlaceId),
      ),
    );
    return searchResults.filter((suggestion) => !savedProviderIds.has(suggestion.externalPlaceId));
  }, [savedPlaces, searchResults]);

  function placeName(place: TripPlace | SavedPlace) {
    if (place.place.kind === 'custom') return place.place.name ?? t('customPlace');
    return providerDetails[place.place.id]?.name ?? t('providerPlace');
  }
  function placeDescription(place: TripPlace | SavedPlace) {
    if (place.place.kind === 'custom') return place.place.note ?? t('customPlaceDescription');
    return providerDetails[place.place.id]?.formattedAddress ?? t('providerDetailsUnavailable');
  }
  function savedPlaceSuggestion(savedPlace: SavedPlace) {
    return searchResults.find((suggestion) =>
      savedPlace.place.providerRefs.some(
        (reference) => reference.externalPlaceId === suggestion.externalPlaceId,
      ),
    );
  }
  function savedPlaceName(savedPlace: SavedPlace) {
    return savedPlaceSuggestion(savedPlace)?.name ?? placeName(savedPlace);
  }
  function savedPlaceDescription(savedPlace: SavedPlace) {
    return savedPlaceSuggestion(savedPlace)?.description ?? placeDescription(savedPlace);
  }
  function hasTripPlaceForProvider(suggestion: ProviderSuggestion) {
    return tripPlaces.some((tripPlace) =>
      tripPlace.place.providerRefs.some(
        (reference) => reference.externalPlaceId === suggestion.externalPlaceId,
      ),
    );
  }
  function replaceTripPlace(next: TripPlace) {
    setTripPlaces((current) => current.map((item) => (item.id === next.id ? next : item)));
  }
  function resetAddFlow() {
    setAddMode('search');
    setCustomName('');
    setCustomNote('');
    setSearchQuery('');
    setSearchResults([]);
    setSearchStatus('idle');
    setAddingPlaceId(null);
    setAddingProviderId(null);
    setAddStatus('idle');
  }
  async function openAdd() {
    resetAddFlow();
    setAddOpen(true);
    setAddStatus('loading');
    try {
      const nextSavedPlaces = (await fetchSavedPlaces()).savedPlaces;
      setSavedPlaces(nextSavedPlaces);
      setProviderDetails((current) => ({
        ...current,
        ...Object.fromEntries(
          nextSavedPlaces.flatMap((savedPlace) => {
            const details = getCachedProviderPlaceDetails(savedPlace.place.id);
            return details ? [[savedPlace.place.id, details]] : [];
          }),
        ),
      }));
      setAddStatus('idle');
    } catch {
      setAddStatus('error');
    }
  }
  async function handleAdd(placeId: string) {
    setAddingPlaceId(placeId);
    setError(null);
    try {
      const { tripPlace } = await addTripPlace(tripId, placeId);
      setTripPlaces((current) =>
        current.some((item) => item.id === tripPlace.id) ? current : [...current, tripPlace],
      );
      return true;
    } catch {
      setError(t('actionError'));
      return false;
    } finally {
      setAddingPlaceId(null);
    }
  }
  async function handleProviderAdd(suggestion: ProviderSuggestion) {
    setAddingProviderId(suggestion.externalPlaceId);
    setError(null);
    try {
      const { place } = await resolveProviderPlace(suggestion.externalPlaceId);
      const { tripPlace } = await addTripPlace(tripId, place.id);
      setTripPlaces((current) =>
        current.some((item) => item.id === tripPlace.id) ? current : [...current, tripPlace],
      );
      setProviderDetails((current) => ({
        ...current,
        [place.id]: {
          category: suggestion.category,
          formattedAddress: suggestion.description,
          name: suggestion.name,
        },
      }));
      cacheProviderPlaceDetails(place.id, {
        category: suggestion.category,
        formattedAddress: suggestion.description,
        name: suggestion.name,
      });
    } catch {
      setError(t('actionError'));
    } finally {
      setAddingProviderId(null);
    }
  }
  async function handleCreateCustom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customName.trim()) return;
    setCreatingCustom(true);
    setError(null);
    try {
      const { place } = await createCustomPlace({ name: customName, note: customNote || null });
      const added = await handleAdd(place.id);
      if (!added) return;
      setCustomName('');
      setCustomNote('');
      resetAddFlow();
      setAddOpen(false);
    } catch {
      setError(t('actionError'));
    } finally {
      setCreatingCustom(false);
    }
  }
  async function handlePriority(tripPlace: TripPlace, priority: TripPlacePriority | null) {
    try {
      replaceTripPlace((await updateTripPlace(tripId, tripPlace.id, { priority })).tripPlace);
    } catch {
      setError(t('actionError'));
    }
  }
  async function handleSaveNote() {
    if (!notePlace) return;
    setSavingNote(true);
    try {
      replaceTripPlace(
        (await updateTripPlace(tripId, notePlace.id, { note: noteValue || null })).tripPlace,
      );
      setNotePlace(null);
    } catch {
      setError(t('actionError'));
    } finally {
      setSavingNote(false);
    }
  }
  async function handleRemove() {
    if (!removingPlace) return;
    setRemoving(true);
    setError(null);
    try {
      await removeTripPlace(tripId, removingPlace.id);
      setTripPlaces((current) => current.filter((item) => item.id !== removingPlace.id));
      setRemovingPlace(null);
    } catch (cause) {
      setRemovingPlace(null);
      setError(
        cause instanceof TripPlaceApiError && cause.code === 'trip_place_referenced'
          ? t('referencedError', { count: cause.referenceCount ?? 0 })
          : t('actionError'),
      );
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-5xl space-y-8">
      <div>
        <Button nativeButton={false} render={<Link href="/trips" />} size="sm" variant="ghost">
          <ArrowLeft aria-hidden="true" data-icon="inline-start" />
          {t('backToTrips')}
        </Button>
      </div>
      <PageHeader
        actions={
          <Button onClick={() => void openAdd()}>
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t('addPlace')}
          </Button>
        }
        description={t('description')}
        title={tripName ? t('title', { trip: tripName }) : t('titleLoading')}
      />
      {error ? (
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {status === 'loading' ? (
        <PageState headingLevel={2} kind="loading" title={t('loading')} />
      ) : status === 'error' ? (
        <PageState
          actions={<Button onClick={() => void refresh()}>{t('tryAgain')}</Button>}
          description={t('loadErrorDescription')}
          headingLevel={2}
          icon={<CircleAlert aria-hidden="true" />}
          kind="error"
          title={t('loadError')}
        />
      ) : tripPlaces.length === 0 ? (
        <PageState
          actions={
            <Button onClick={() => void openAdd()}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('addFirstPlace')}
            </Button>
          }
          description={t('emptyDescription')}
          headingLevel={2}
          icon={<MapPinned aria-hidden="true" />}
          kind="empty"
          title={t('emptyTitle')}
        />
      ) : (
        <ItemGroup aria-label={t('listLabel')} variant="list">
          {sortedPlaces.map((tripPlace) => (
            <Item
              className="min-h-20 items-start gap-3 px-3 py-3"
              key={tripPlace.id}
              variant="default"
            >
              <ItemMedia
                className="mt-0.5 size-10 rounded-[var(--radius-md)] bg-secondary text-secondary-foreground"
                variant="icon"
              >
                {tripPlace.place.kind === 'custom' ? (
                  <MapPinned aria-hidden="true" className="size-4" />
                ) : (
                  <Bookmark aria-hidden="true" className="size-4" />
                )}
              </ItemMedia>
              <ItemContent className="min-w-0 gap-1.5">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <ItemTitle className="min-w-0 flex-1 truncate">{placeName(tripPlace)}</ItemTitle>
                  {tripPlace.isSaved ? (
                    <span className="text-xs font-medium text-brand">{t('alsoSaved')}</span>
                  ) : null}
                </div>
                <ItemDescription>{placeDescription(tripPlace)}</ItemDescription>
                {tripPlace.note ? (
                  <p className="line-clamp-2 text-sm text-text-subtle">{tripPlace.note}</p>
                ) : null}
                {tripPlace.referenceCount ? (
                  <p className="text-xs text-muted-foreground">
                    {t('scheduledReference', { count: tripPlace.referenceCount })}
                  </p>
                ) : null}
              </ItemContent>
              <ItemActions className="ml-auto flex-wrap justify-end gap-1">
                <Select
                  onValueChange={(value) =>
                    void handlePriority(
                      tripPlace,
                      value === 'none' ? null : (value as TripPlacePriority),
                    )
                  }
                  value={tripPlace.priority ?? 'none'}
                >
                  <SelectTrigger
                    aria-label={t('priorityFor', { name: placeName(tripPlace) })}
                    size="sm"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('priority.none')}</SelectItem>
                    <SelectItem value="must_go">{t('priority.must_go')}</SelectItem>
                    <SelectItem value="interested">{t('priority.interested')}</SelectItem>
                    <SelectItem value="maybe">{t('priority.maybe')}</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  aria-label={t('editNote', { name: placeName(tripPlace) })}
                  onClick={() => {
                    setNotePlace(tripPlace);
                    setNoteValue(tripPlace.note ?? '');
                  }}
                  size="icon-sm"
                  variant="ghost"
                >
                  <NotebookPen aria-hidden="true" />
                </Button>
                <Button
                  aria-label={t('remove', { name: placeName(tripPlace) })}
                  onClick={() => setRemovingPlace(tripPlace)}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
      <Sheet
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) resetAddFlow();
        }}
        open={addOpen}
      >
        <SheetContent
          className="data-[side=right]:w-[min(34rem,calc(100%-0.5rem))]"
          closeLabel={t('close')}
        >
          <SheetHeader className="border-b">
            <SheetTitle>{t('addPlaceTitle')}</SheetTitle>
            <SheetDescription>{t('addPlaceDescription')}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 overflow-y-auto p-5">
            {addMode === 'search' ? (
              <div className="space-y-5">
                <SearchField
                  autoFocus
                  label={t('searchLabel')}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={t('searchPlaceholder')}
                  value={searchQuery}
                />

                {addStatus === 'loading' ? (
                  <p aria-live="polite" className="text-sm text-muted-foreground" role="status">
                    {t('loadingSaved')}
                  </p>
                ) : addStatus === 'error' ? (
                  <Alert role="alert" variant="destructive">
                    <CircleAlert aria-hidden="true" />
                    <AlertDescription>{t('loadSavedError')}</AlertDescription>
                  </Alert>
                ) : matchingSavedPlaces.length ? (
                  <div className="space-y-2">
                    <h2 className="text-sm font-medium">{t('savedPlaces')}</h2>
                    <ItemGroup aria-label={t('savedPlaces')} className="gap-2">
                      {matchingSavedPlaces.map((savedPlace) => {
                        const existing = tripPlaces.some(
                          (item) => item.place.id === savedPlace.place.id,
                        );
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
                              <ItemTitle>{savedPlaceName(savedPlace)}</ItemTitle>
                              <ItemDescription>{savedPlaceDescription(savedPlace)}</ItemDescription>
                            </ItemContent>
                            <ItemActions className="shrink-0">
                              <Button
                                disabled={existing || addingPlaceId === savedPlace.place.id}
                                onClick={() => void handleAdd(savedPlace.place.id)}
                                size="sm"
                                variant={existing ? 'secondary' : 'outline'}
                              >
                                {existing
                                  ? t('added')
                                  : addingPlaceId === savedPlace.place.id
                                    ? t('adding')
                                    : t('add')}
                              </Button>
                            </ItemActions>
                          </Item>
                        );
                      })}
                    </ItemGroup>
                  </div>
                ) : addStatus === 'idle' && !searchQuery.trim() ? (
                  <p className="text-sm leading-6 text-muted-foreground">{t('noSavedPlaces')}</p>
                ) : null}

                {!searchQuery.trim() ? (
                  <p className="text-sm leading-6 text-muted-foreground">{t('searchHint')}</p>
                ) : searchStatus === 'loading' ? (
                  <p aria-live="polite" className="text-sm text-muted-foreground" role="status">
                    {t('searching')}
                  </p>
                ) : searchStatus === 'unavailable' ? (
                  <Alert role="alert" variant="warning">
                    <CircleAlert aria-hidden="true" />
                    <AlertDescription>{t('searchUnavailable')}</AlertDescription>
                  </Alert>
                ) : providerResults.length ? (
                  <div className="space-y-2">
                    <h2 className="text-sm font-medium">{t('searchResults')}</h2>
                    <ItemGroup aria-label={t('searchResults')} className="gap-2">
                      {providerResults.map((suggestion) => {
                        const existing = hasTripPlaceForProvider(suggestion);
                        return (
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
                            </ItemContent>
                            <ItemActions className="shrink-0">
                              <Button
                                disabled={
                                  existing || addingProviderId === suggestion.externalPlaceId
                                }
                                onClick={() => void handleProviderAdd(suggestion)}
                                size="sm"
                                variant={existing ? 'secondary' : 'outline'}
                              >
                                {existing
                                  ? t('added')
                                  : addingProviderId === suggestion.externalPlaceId
                                    ? t('adding')
                                    : t('add')}
                              </Button>
                            </ItemActions>
                          </Item>
                        );
                      })}
                    </ItemGroup>
                  </div>
                ) : searchStatus === 'empty' ? (
                  <p className="text-sm leading-6 text-muted-foreground">{t('searchEmpty')}</p>
                ) : null}

                <Button className="px-0" onClick={() => setAddMode('custom')} variant="link">
                  {t('createCustomPlace')}
                </Button>
              </div>
            ) : (
              <form className="space-y-5" onSubmit={(event) => void handleCreateCustom(event)}>
                <div className="space-y-2">
                  <Label htmlFor="trip-place-name">{t('customName')}</Label>
                  <Input
                    autoFocus
                    id="trip-place-name"
                    onChange={(event) => setCustomName(event.target.value)}
                    placeholder={t('customNamePlaceholder')}
                    required
                    value={customName}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="trip-place-note">{t('customNote')}</Label>
                  <Textarea
                    id="trip-place-note"
                    onChange={(event) => setCustomNote(event.target.value)}
                    placeholder={t('customNotePlaceholder')}
                    value={customNote}
                  />
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button disabled={creatingCustom || !customName.trim()} type="submit">
                    {creatingCustom ? t('adding') : t('addCustomPlace')}
                  </Button>
                  <Button onClick={() => setAddMode('search')} type="button" variant="outline">
                    {t('backToSearch')}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <Dialog open={Boolean(notePlace)} onOpenChange={(open) => !open && setNotePlace(null)}>
        <DialogContent closeLabel={t('close')}>
          <DialogHeader>
            <DialogTitle>{t('noteTitle')}</DialogTitle>
            <DialogDescription>
              {t('noteDescription', { name: notePlace ? placeName(notePlace) : '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="trip-place-note-editor">{t('note')}</Label>
            <Textarea
              id="trip-place-note-editor"
              onChange={(event) => setNoteValue(event.target.value)}
              placeholder={t('notePlaceholder')}
              value={noteValue}
            />
          </div>
          <DialogFooter>
            <Button disabled={savingNote} onClick={() => setNotePlace(null)} variant="outline">
              {t('cancel')}
            </Button>
            <Button disabled={savingNote} onClick={() => void handleSaveNote()}>
              {savingNote ? t('saving') : t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(removingPlace)}
        onOpenChange={(open) => !open && setRemovingPlace(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('removeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('removeDescription', { name: removingPlace ? placeName(removingPlace) : '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={removing}
              onClick={() => void handleRemove()}
              variant="destructive"
            >
              {removing ? t('removing') : t('removePlace')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
