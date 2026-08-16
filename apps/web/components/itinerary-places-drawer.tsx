'use client';

import { MapPinned, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { AddTripPlaceSheet } from '@/components/add-trip-place-sheet';
import { PageState } from '@/components/page-state';
import { PlaceDetailSheet } from '@/components/place-detail-sheet';
import { TripPlacesPanel } from '@/components/trip-places-panel';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import type { ScheduledPlaceUse } from '@/lib/itinerary/places';
import type { TripPlace } from '@/lib/trip-places/api';
import { useTripPlaces } from '@/lib/trip-places/use-trip-places';

type ItineraryPlacesDrawerProps = {
  /** 1-based number of the day currently being planned. */
  dayNumber: number;
  onAddToDay: (tripPlace: TripPlace) => Promise<boolean>;
  onOpenChange: (open: boolean) => void;
  placeUse: Record<string, ScheduledPlaceUse>;
  tripId: string;
};

/**
 * The trip's Places, beside the day being planned rather than a page away. Mounted
 * only while open, so the itinerary does not pay for a collection nobody asked to see.
 */
export function ItineraryPlacesDrawer({
  dayNumber,
  onAddToDay,
  onOpenChange,
  placeUse,
  tripId,
}: Readonly<ItineraryPlacesDrawerProps>) {
  const t = useTranslations('tripPlaces');
  const places = useTripPlaces(tripId);
  const [detailPlace, setDetailPlace] = useState<TripPlace | null>(null);
  const [notePlace, setNotePlace] = useState<TripPlace | null>(null);
  const [noteValue, setNoteValue] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [removingPlace, setRemovingPlace] = useState<TripPlace | null>(null);
  const [removing, setRemoving] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const placeName = (tripPlace: TripPlace) =>
    tripPlace.place.kind === 'custom'
      ? (tripPlace.place.name ?? t('customPlace'))
      : (places.providerDetails[tripPlace.place.id]?.name ?? t('providerPlace'));

  async function addToDay(tripPlace: TripPlace) {
    setAddingId(tripPlace.id);
    setFeedback(null);
    const added = await onAddToDay(tripPlace);
    setFeedback(added ? t('addedToDay', { number: dayNumber }) : t('addToDayError'));
    setAddingId(null);
  }

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

  return (
    <>
      <Sheet onOpenChange={onOpenChange} open>
        <SheetContent className="sm:max-w-lg" closeLabel={t('close')} side="right">
          <SheetHeader>
            <SheetTitle>{t('placesDrawerTitle')}</SheetTitle>
            <SheetDescription>{t('placesDrawerDescription')}</SheetDescription>
          </SheetHeader>

          <div className="px-5 pb-3">
            <Button className="w-full" onClick={() => setAddOpen(true)} variant="outline">
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('addPlace')}
            </Button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5">
            <p aria-live="polite" className="sr-only" role="status">
              {feedback}
            </p>

            {places.error ? (
              <Alert role="alert" variant="destructive">
                <AlertDescription>{t(places.error.key, places.error.values)}</AlertDescription>
              </Alert>
            ) : null}

            {places.status === 'loading' ? <PageState kind="loading" title={t('loading')} /> : null}

            {places.status === 'idle' && !places.sorted.length ? (
              <PageState
                description={t('emptyDescription')}
                headingLevel={2}
                icon={<MapPinned aria-hidden="true" />}
                kind="empty"
                title={t('emptyTitle')}
              />
            ) : null}

            {places.sorted.length ? (
              <TripPlacesPanel
                addToDayLabel={t('addToDay', { number: dayNumber })}
                busyPlaceId={addingId}
                onAddToDay={(tripPlace) => void addToDay(tripPlace)}
                onEditNote={(tripPlace) => {
                  setNotePlace(tripPlace);
                  setNoteValue(tripPlace.note ?? '');
                }}
                onPriorityChange={(tripPlace, priority) =>
                  void places.setPriority(tripPlace, priority)
                }
                onRemove={setRemovingPlace}
                onViewDetails={setDetailPlace}
                placeUse={placeUse}
                providerDetails={places.providerDetails}
                tripPlaces={places.sorted}
              />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      {addOpen ? (
        <AddTripPlaceSheet
          onAdded={(tripPlace) => {
            places.setPlaces((current) =>
              current.some((entry) => entry.id === tripPlace.id)
                ? current
                : [...current, tripPlace],
            );
          }}
          onOpenChange={setAddOpen}
          tripId={tripId}
          tripPlaces={places.places}
        />
      ) : null}

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

      <Dialog onOpenChange={(open) => !open && setNotePlace(null)} open={Boolean(notePlace)}>
        <DialogContent className="sm:max-w-md" closeLabel={t('cancel')}>
          <DialogHeader>
            <DialogTitle>{t('noteTitle')}</DialogTitle>
          </DialogHeader>
          <Textarea
            aria-label={t('note')}
            maxLength={2000}
            onChange={(event) => setNoteValue(event.target.value)}
            placeholder={t('notePlaceholder')}
            rows={4}
            value={noteValue}
          />
          <DialogFooter>
            <Button onClick={() => setNotePlace(null)} variant="ghost">
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
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('removeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('removeDescription', { name: removingPlace ? placeName(removingPlace) : '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
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
    </>
  );
}
