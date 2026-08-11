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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  createCustomPlace,
  fetchSavedPlaces,
  getProviderPlaceDetails,
  type ProviderPlaceDetails,
  type SavedPlace,
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
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [addStatus, setAddStatus] = useState<'error' | 'idle' | 'loading'>('idle');
  const [addingPlaceId, setAddingPlaceId] = useState<string | null>(null);
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
    const pending = [...tripPlaces, ...savedPlaces].filter(
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
  }, [providerDetails, savedPlaces, tripPlaces]);

  const sortedPlaces = useMemo(
    () =>
      tripPlaces.toSorted(
        (left, right) =>
          priorityRank(left.priority) - priorityRank(right.priority) ||
          left.createdAt.localeCompare(right.createdAt),
      ),
    [tripPlaces],
  );

  function placeName(place: TripPlace | SavedPlace) {
    if (place.place.kind === 'custom') return place.place.name ?? t('customPlace');
    return providerDetails[place.place.id]?.name ?? t('providerPlace');
  }
  function placeDescription(place: TripPlace | SavedPlace) {
    if (place.place.kind === 'custom') return place.place.note ?? t('customPlaceDescription');
    return providerDetails[place.place.id]?.formattedAddress ?? t('providerDetailsUnavailable');
  }
  function replaceTripPlace(next: TripPlace) {
    setTripPlaces((current) => current.map((item) => (item.id === next.id ? next : item)));
  }
  async function openAdd() {
    setAddOpen(true);
    setAddStatus('loading');
    try {
      setSavedPlaces((await fetchSavedPlaces()).savedPlaces);
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
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent closeLabel={t('close')}>
          <DialogHeader>
            <DialogTitle>{t('addPlaceTitle')}</DialogTitle>
            <DialogDescription>{t('addPlaceDescription')}</DialogDescription>
          </DialogHeader>
          {addStatus === 'loading' ? (
            <PageState headingLevel={2} kind="loading" title={t('loadingSaved')} />
          ) : addStatus === 'error' ? (
            <Alert role="alert" variant="destructive">
              <AlertDescription>{t('loadSavedError')}</AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="space-y-2">
                <h2 className="text-sm font-medium">{t('savedPlaces')}</h2>
                {savedPlaces.length ? (
                  <ItemGroup className="max-h-64 overflow-y-auto pr-1">
                    {savedPlaces.map((savedPlace) => {
                      const existing = tripPlaces.some(
                        (item) => item.place.id === savedPlace.place.id,
                      );
                      return (
                        <Item className="gap-3 px-3 py-2" key={savedPlace.id} variant="outline">
                          <ItemContent className="min-w-0">
                            <ItemTitle>{placeName(savedPlace)}</ItemTitle>
                            <ItemDescription>{placeDescription(savedPlace)}</ItemDescription>
                          </ItemContent>
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
                        </Item>
                      );
                    })}
                  </ItemGroup>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('noSavedPlaces')}</p>
                )}
              </div>
              <form
                className="space-y-4 border-t pt-5"
                onSubmit={(event) => void handleCreateCustom(event)}
              >
                <div>
                  <h2 className="text-sm font-medium">{t('customPlaceTitle')}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('customPlaceDescription')}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="trip-place-name">{t('customName')}</Label>
                  <Input
                    id="trip-place-name"
                    onChange={(event) => setCustomName(event.target.value)}
                    placeholder={t('customNamePlaceholder')}
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
                <Button disabled={creatingCustom || !customName.trim()} type="submit">
                  {creatingCustom ? t('adding') : t('addCustomPlace')}
                </Button>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
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
