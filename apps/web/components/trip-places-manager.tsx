'use client';

import { CircleAlert, MapPinned, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

import { AddTripPlaceSheet } from '@/components/add-trip-place-sheet';
import { EditTripPlaceDialog } from '@/components/edit-trip-place-dialog';
import { PageState } from '@/components/page-state';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { TripPlace } from '@/lib/trip-places/api';
import { resolveTripPlaceName } from '@/lib/trip-places/place-name';
import { sortTripPlaces, tripPlaceSorts, type TripPlaceSort } from '@/lib/trip-places/sort';
import { useTripPlaces } from '@/lib/trip-places/use-trip-places';

/**
 * The Places page. Navigation no longer points here — the itinerary opens the same
 * collection beside the day being planned — but the route stays for deep links,
 * bookmarks, and search results, and it gives the collection room to breathe.
 */
export function TripPlacesManager({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('tripPlaces');
  const places = useTripPlaces(tripId);
  const [sort, setSort] = useState<TripPlaceSort>('name');
  const [addOpen, setAddOpen] = useState(false);
  const [editPlace, setEditPlace] = useState<TripPlace | null>(null);
  const [removingPlace, setRemovingPlace] = useState<TripPlace | null>(null);
  const [removing, setRemoving] = useState(false);

  const placeName = (tripPlace: TripPlace) =>
    resolveTripPlaceName(tripPlace, {
      custom: t('customPlace'),
      provider: t('providerPlace'),
    });

  const sortedPlaces = useMemo(
    () => sortTripPlaces(places.places, sort, placeName),
    [places.places, sort, t],
  );

  async function removePlace() {
    if (!removingPlace) return;
    setRemoving(true);
    const result = await places.remove(removingPlace);
    setRemoving(false);
    // A refusal (the Place is still scheduled somewhere) is not a completed
    // removal: closing the dialog on it would read as success. It stays open
    // with the reason inline instead, same as Saved's own unsave confirmation.
    if (result.ok) setRemovingPlace(null);
  }

  const addButton = (label: string) => (
    <Button onClick={() => setAddOpen(true)}>
      <Plus aria-hidden="true" data-icon="inline-start" />
      {label}
    </Button>
  );

  return (
    <section className="space-y-7">
      <TripSectionHeader
        actions={addButton(t('addPlace'))}
        currentSection="places"
        description={t('description')}
      />

      {places.error && !removingPlace ? (
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{t(places.error.key, places.error.values)}</AlertDescription>
        </Alert>
      ) : null}

      {places.status === 'loading' ? (
        <PageState headingLevel={2} kind="loading" loadingShape="list" title={t('loading')} />
      ) : places.status === 'error' ? (
        <PageState
          actions={<Button onClick={() => void places.refresh()}>{t('tryAgain')}</Button>}
          description={t('loadErrorDescription')}
          headingLevel={2}
          icon={<CircleAlert aria-hidden="true" />}
          kind="error"
          title={t('loadError')}
        />
      ) : places.places.length === 0 ? (
        <PageState
          actions={addButton(t('addFirstPlace'))}
          description={t('emptyDescription')}
          headingLevel={2}
          icon={<MapPinned aria-hidden="true" />}
          kind="empty"
          title={t('emptyTitle')}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex justify-end">
            <div className="flex items-center gap-3">
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

          <TripPlacesPanel
            onEditPlace={setEditPlace}
            onPriorityChange={(tripPlace, priority) => void places.setPriority(tripPlace, priority)}
            onRemove={setRemovingPlace}
            tripPlaces={sortedPlaces}
          />
        </div>
      )}

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

      <EditTripPlaceDialog
        onOpenChange={(open) => !open && setEditPlace(null)}
        onRefresh={places.refresh}
        onSave={places.savePlace}
        tripPlace={editPlace}
      />

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setRemovingPlace(null);
            places.clearError();
          }
        }}
        open={Boolean(removingPlace)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('removeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('removeDescription', { name: removingPlace ? placeName(removingPlace) : '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {places.error ? (
            <Alert role="alert" variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{t(places.error.key, places.error.values)}</AlertDescription>
            </Alert>
          ) : null}
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
