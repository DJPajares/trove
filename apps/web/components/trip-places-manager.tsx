'use client';

import { CircleAlert, MapPinned, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { AddTripPlaceSheet } from '@/components/add-trip-place-sheet';
import { PageState } from '@/components/page-state';
import { PlaceDetailSheet } from '@/components/place-detail-sheet';
import { TripPlacesPanel } from '@/components/trip-places-panel';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { TripPlace } from '@/lib/trip-places/api';
import { useTripPlaces } from '@/lib/trip-places/use-trip-places';

/**
 * The Places page. Navigation no longer points here — the itinerary opens the same
 * collection beside the day being planned — but the route stays for deep links,
 * bookmarks, and search results, and it gives the collection room to breathe.
 */
export function TripPlacesManager({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('tripPlaces');
  const places = useTripPlaces(tripId);
  const [addOpen, setAddOpen] = useState(false);
  const [detailPlace, setDetailPlace] = useState<TripPlace | null>(null);
  const [notePlace, setNotePlace] = useState<TripPlace | null>(null);
  const [noteValue, setNoteValue] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [removingPlace, setRemovingPlace] = useState<TripPlace | null>(null);
  const [removing, setRemoving] = useState(false);

  const placeName = (tripPlace: TripPlace) =>
    tripPlace.place.kind === 'custom'
      ? (tripPlace.place.name ?? t('customPlace'))
      : (places.providerDetails[tripPlace.place.id]?.name ?? t('providerPlace'));

  async function saveNote() {
    if (!notePlace) return;
    setSavingNote(true);
    if (await places.saveNote(notePlace, noteValue)) setNotePlace(null);
    setSavingNote(false);
  }

  async function removePlace() {
    if (!removingPlace) return;
    setRemoving(true);
    await places.remove(removingPlace);
    setRemovingPlace(null);
    setRemoving(false);
  }

  const addButton = (label: string) => (
    <Button onClick={() => setAddOpen(true)}>
      <Plus aria-hidden="true" data-icon="inline-start" />
      {label}
    </Button>
  );

  return (
    <section className="mx-auto w-full max-w-5xl space-y-8">
      <TripSectionHeader
        actions={addButton(t('addPlace'))}
        currentSection="places"
        description={t('description')}
        tripId={tripId}
      />

      {places.error ? (
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{t(places.error.key, places.error.values)}</AlertDescription>
        </Alert>
      ) : null}

      {places.status === 'loading' ? (
        <PageState headingLevel={2} kind="loading" title={t('loading')} />
      ) : places.status === 'error' ? (
        <PageState
          actions={<Button onClick={() => void places.refresh()}>{t('tryAgain')}</Button>}
          description={t('loadErrorDescription')}
          headingLevel={2}
          icon={<CircleAlert aria-hidden="true" />}
          kind="error"
          title={t('loadError')}
        />
      ) : places.sorted.length === 0 ? (
        <PageState
          actions={addButton(t('addFirstPlace'))}
          description={t('emptyDescription')}
          headingLevel={2}
          icon={<MapPinned aria-hidden="true" />}
          kind="empty"
          title={t('emptyTitle')}
        />
      ) : (
        <TripPlacesPanel
          onEditNote={(tripPlace) => {
            setNotePlace(tripPlace);
            setNoteValue(tripPlace.note ?? '');
          }}
          onPriorityChange={(tripPlace, priority) => void places.setPriority(tripPlace, priority)}
          onRemove={setRemovingPlace}
          onViewDetails={setDetailPlace}
          providerDetails={places.providerDetails}
          tripPlaces={places.sorted}
        />
      )}

      <PlaceDetailSheet
        context={{
          isSaved: detailPlace?.isSaved,
          note: detailPlace?.note,
          tripName: places.tripName,
        }}
        onOpenChange={(open) => !open && setDetailPlace(null)}
        open={Boolean(detailPlace)}
        place={detailPlace?.place ?? null}
      />

      {addOpen ? (
        <AddTripPlaceSheet
          onAdded={(tripPlace) =>
            places.setPlaces((current) =>
              current.some((item) => item.id === tripPlace.id) ? current : [...current, tripPlace],
            )
          }
          onOpenChange={setAddOpen}
          tripId={tripId}
          tripPlaces={places.places}
        />
      ) : null}

      <Dialog onOpenChange={(open) => !open && setNotePlace(null)} open={Boolean(notePlace)}>
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
            <Button disabled={savingNote} onClick={() => void saveNote()}>
              {savingNote ? t('saving') : t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        onOpenChange={(open) => !open && setRemovingPlace(null)}
        open={Boolean(removingPlace)}
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
              onClick={() => void removePlace()}
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
