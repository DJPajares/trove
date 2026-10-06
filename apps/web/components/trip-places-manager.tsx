'use client';

import { CircleAlert, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

import { AddTripPlaceSheet } from '@/components/add-trip-place-sheet';
import { EditTripPlaceSheet } from '@/components/edit-trip-place-sheet';
import { PageState } from '@/components/page-state';
import { RemoveTripPlaceDialog } from '@/components/remove-trip-place-dialog';
import { SavedPlacesForTrip } from '@/components/saved-places-for-trip';
import { useTripPlaceSignals } from '@/hooks/use-trip-place-signals';
import { TripPlacesPanel } from '@/components/trip-places-panel';
import { TripPlacesNoMatches, TripPlacesToolbar } from '@/components/trip-places-toolbar';
import { TripSectionHeader } from '@/components/trip-section-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { TripPlace } from '@/lib/trip-places/api';
import { fetchItinerary } from '@/lib/itinerary/api';
import { scheduledPlaceUse } from '@/lib/itinerary/places';
import { queryKeys } from '@/lib/query/keys';
import { useTripResource } from '@/lib/query/use-trip-resource';
import { resolveTripPlaceName } from '@/lib/trip-places/place-name';
import { tripPlaceSorts } from '@/lib/trip-places/sort';
import { useTripPlaces } from '@/lib/trip-places/use-trip-places';
import { useTripPlacesView } from '@/lib/trip-places/use-trip-places-view';
import * as Icons from '@/lib/icons';

/**
 * The Places page. Navigation no longer points here — the itinerary opens the same
 * collection beside the day being planned — but the route stays for deep links,
 * bookmarks, and search results, and it gives the collection room to breathe.
 */
export function TripPlacesManager({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('tripPlaces');
  const places = useTripPlaces(tripId);
  const { data: itinerary } = useTripResource(queryKeys.itinerary(tripId), () =>
    fetchItinerary(tripId),
  );
  const placeUse = useMemo(
    () => (itinerary ? scheduledPlaceUse(itinerary) : undefined),
    [itinerary],
  );
  // Ratings Trove already has stored; this page has no day, so no hours or distance.
  const { signalsFor } = useTripPlaceSignals(tripId);
  /** What the Add sheet opens with: null while it is closed, a search when one is carried over. */
  const [addQuery, setAddQuery] = useState<string | null>(null);
  const [editPlace, setEditPlace] = useState<TripPlace | null>(null);
  const [removingPlace, setRemovingPlace] = useState<TripPlace | null>(null);

  const placeName = (tripPlace: TripPlace) =>
    resolveTripPlaceName(tripPlace, {
      custom: t('customPlace'),
      provider: t('providerPlace'),
    });

  const view = useTripPlacesView(places.places, {
    nameOf: placeName,
    placeUse,
    sorts: tripPlaceSorts,
  });

  return (
    <section className="space-y-7">
      <TripSectionHeader
        description={t('description')}
        primaryAction={{ label: t('addPlace'), onSelect: () => setAddQuery('') }}
      />

      {places.error && !removingPlace ? (
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{t(places.error.key, places.error.values)}</AlertDescription>
        </Alert>
      ) : null}

      {places.status === 'idle' ? (
        <SavedPlacesForTrip
          onAdded={(tripPlace) =>
            places.setPlaces((current) =>
              current.some((entry) => entry.id === tripPlace.id)
                ? current
                : [...current, tripPlace],
            )
          }
          tripId={tripId}
          tripPlaces={places.places}
        />
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
          actions={
            <Button onClick={() => setAddQuery('')}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('addFirstPlace')}
            </Button>
          }
          description={t('emptyDescription')}
          headingLevel={2}
          icon={<Icons.Places aria-hidden="true" />}
          kind="empty"
          title={t('emptyTitle')}
        />
      ) : (
        <div className="space-y-4">
          <TripPlacesToolbar view={view} />

          {view.visible.length ? (
            <TripPlacesPanel
              placeUse={placeUse}
              onEditPlace={setEditPlace}
              onPlaceLocated={places.placeLocated}
              onPriorityChange={(tripPlace, priority) =>
                void places.setPriority(tripPlace, priority)
              }
              onRemove={setRemovingPlace}
              rowClassName="px-3"
              signalsFor={signalsFor}
              tripId={tripId}
              tripPlaces={view.visible}
            />
          ) : (
            <TripPlacesNoMatches onAddQuery={setAddQuery} view={view} />
          )}
        </div>
      )}

      {addQuery !== null ? (
        <AddTripPlaceSheet
          initialQuery={addQuery}
          onAdded={(tripPlace) =>
            places.setPlaces((current) =>
              current.some((item) => item.id === tripPlace.id) ? current : [...current, tripPlace],
            )
          }
          onOpenChange={(open) => !open && setAddQuery(null)}
          tripId={tripId}
          tripPlaces={places.places}
        />
      ) : null}

      <EditTripPlaceSheet
        onOpenChange={(open) => !open && setEditPlace(null)}
        onRefresh={places.refresh}
        onSave={places.savePlace}
        tripPlace={editPlace}
      />

      <RemoveTripPlaceDialog
        error={places.error}
        nameOf={placeName}
        onClose={() => {
          setRemovingPlace(null);
          places.clearError();
        }}
        onRemove={places.remove}
        placeUse={placeUse}
        tripPlace={removingPlace}
      />
    </section>
  );
}
