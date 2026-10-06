'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

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
import type { ScheduledPlaceUse } from '@/lib/itinerary/places';
import type { TripPlace } from '@/lib/trip-places/api';
import { itineraryReferences } from '@/lib/trip-places/list-view';
import type { TripPlacesError } from '@/lib/trip-places/use-trip-places';

/**
 * Removing a Place from the trip, for the Places page and the itinerary's
 * drawer alike. The API refuses while any itinerary stop still uses the Place,
 * and the list already knows when that is so - so instead of offering a removal
 * that is bound to fail, the dialog says up front what has to happen first. The
 * API's own refusal still lands here if the list's count was out of date.
 */
export function RemoveTripPlaceDialog({
  error,
  nameOf,
  onClose,
  onRemove,
  placeUse,
  tripPlace,
}: Readonly<{
  error: TripPlacesError | null;
  nameOf: (tripPlace: TripPlace) => string;
  onClose: () => void;
  onRemove: (tripPlace: TripPlace) => Promise<{ ok: boolean }>;
  placeUse?: Readonly<Record<string, ScheduledPlaceUse>>;
  tripPlace: TripPlace | null;
}>) {
  const t = useTranslations('tripPlaces');
  const [removing, setRemoving] = useState(false);
  // The dialog keeps showing the place it opened for while it animates closed,
  // rather than flipping to another state for the length of the fade.
  const [shown, setShown] = useState(tripPlace);
  if (tripPlace && tripPlace !== shown) setShown(tripPlace);

  const references = shown ? itineraryReferences(shown, placeUse) : 0;

  async function remove() {
    if (!tripPlace) return;
    setRemoving(true);
    const result = await onRemove(tripPlace);
    setRemoving(false);
    // A refusal is not a completed removal: closing on it would read as
    // success. The dialog stays open with the reason inline instead.
    if (result.ok) onClose();
  }

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={Boolean(tripPlace)}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {references ? t('removeBlockedTitle') : t('removeTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {references
              ? t('referencedError', { count: references })
              : t('removeDescription', { name: shown ? nameOf(shown) : '' })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && !references ? (
          <Alert role="alert" variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{t(error.key, error.values)}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          {references ? (
            <AlertDialogCancel>{t('close')}</AlertDialogCancel>
          ) : (
            <>
              <AlertDialogCancel disabled={removing}>{t('cancel')}</AlertDialogCancel>
              <AlertDialogAction
                disabled={removing}
                onClick={() => void remove()}
                variant="destructive"
              >
                {removing ? t('removing') : t('removePlace')}
              </AlertDialogAction>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
