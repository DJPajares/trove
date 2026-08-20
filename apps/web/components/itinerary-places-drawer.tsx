'use client';

import { MapPinned, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { AddTripPlaceSheet } from '@/components/add-trip-place-sheet';
import { EditTripPlaceDialog } from '@/components/edit-trip-place-dialog';
import { PageState } from '@/components/page-state';
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
import type { ScheduledPlaceUse } from '@/lib/itinerary/places';
import type { TripPlace } from '@/lib/trip-places/api';
import { resolveTripPlaceName } from '@/lib/trip-places/place-name';
import { sortTripPlaces, tripPlaceSorts, type TripPlaceSort } from '@/lib/trip-places/sort';
import { useTripPlaces } from '@/lib/trip-places/use-trip-places';

type ItineraryPlacesDrawerProps = {
  /** 1-based number of the day currently being planned. */
  dayNumber: number;
  onAddToDay: (tripPlace: TripPlace) => Promise<boolean>;
  onTripPlaceAdded: (tripPlace: TripPlace) => void;
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
  onTripPlaceAdded,
  placeUse,
  tripId,
}: Readonly<ItineraryPlacesDrawerProps>) {
  const locale = useLocale();
  const t = useTranslations('tripPlaces');
  const places = useTripPlaces(tripId);
  const [editPlace, setEditPlace] = useState<TripPlace | null>(null);
  const [removingPlace, setRemovingPlace] = useState<TripPlace | null>(null);
  const [removing, setRemoving] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [sort, setSort] = useState<TripPlaceSort>('name');

  const placeName = (tripPlace: TripPlace) =>
    resolveTripPlaceName(tripPlace, {
      custom: t('customPlace'),
      provider: t('providerPlace'),
    });

  const sortedPlaces = useMemo(
    () => sortTripPlaces(places.places, sort, placeName),
    [places.places, sort, t],
  );
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    [locale],
  );
  const listFormatter = useMemo(
    () => new Intl.ListFormat(locale, { style: 'short', type: 'conjunction' }),
    [locale],
  );

  async function addToDay(tripPlace: TripPlace) {
    setAddingId(tripPlace.id);
    setFeedback(null);
    const added = await onAddToDay(tripPlace);
    setFeedback(added ? t('addedToDay', { number: dayNumber }) : t('addToDayError'));
    setAddingId(null);
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

          <div className="space-y-3 px-5 pb-3">
            <Button className="w-full" onClick={() => setAddOpen(true)} variant="outline">
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('addPlace')}
            </Button>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">{t('sortLabel')}</span>
              <Select
                onValueChange={(value) => value && setSort(value as TripPlaceSort)}
                value={sort}
              >
                <SelectTrigger aria-label={t('sortBy')} size="sm">
                  <SelectValue>{t(`sort.${sort}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  {tripPlaceSorts.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`sort.${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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

            {places.status === 'idle' && !places.places.length ? (
              <PageState
                description={t('emptyDescription')}
                headingLevel={2}
                icon={<MapPinned aria-hidden="true" />}
                kind="empty"
                title={t('emptyTitle')}
              />
            ) : null}

            {sortedPlaces.length ? (
              <TripPlacesPanel
                addToDayLabel={t('addToDay', { number: dayNumber })}
                busyPlaceId={addingId}
                onAddToDay={(tripPlace) => void addToDay(tripPlace)}
                onEditPlace={setEditPlace}
                onPriorityChange={(tripPlace, priority) =>
                  void places.setPriority(tripPlace, priority)
                }
                onRemove={setRemovingPlace}
                placeUse={placeUse}
                formatUsageDates={(dates) =>
                  listFormatter.format(
                    dates.map((date) => dateFormatter.format(new Date(`${date}T00:00:00Z`))),
                  )
                }
                tripPlaces={sortedPlaces}
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
            onTripPlaceAdded(tripPlace);
          }}
          onOpenChange={setAddOpen}
          tripId={tripId}
          tripPlaces={places.places}
        />
      ) : null}

      <EditTripPlaceDialog
        onOpenChange={(open) => !open && setEditPlace(null)}
        onRefresh={places.refresh}
        onSave={places.savePlace}
        tripPlace={editPlace}
      />

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
