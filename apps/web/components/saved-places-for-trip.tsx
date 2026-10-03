'use client';

import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { useTripContext } from '@/components/trip-provider';
import { Button } from '@/components/ui/button';
import { fetchSavedPlaces } from '@/lib/saved/api';
import { queryKeys } from '@/lib/query/keys';
import { addTripPlace, type TripPlace } from '@/lib/trip-places/api';
import { savedPlacesNearTrip } from '@/lib/trip-places/saved-near-trip';
import * as Icons from '@/lib/icons';

type Props = {
  onAdded: (tripPlace: TripPlace) => void;
  tripId: string;
  tripPlaces: readonly TripPlace[];
};

/**
 * "You have 5 saved places near Kyoto." Offers the Saved Places that sit in a
 * trip's destination and are not on the trip yet. Adding puts them on the trip
 * and leaves the Saved Places exactly as they were (PRD 14.2). Computed from
 * what Trove already stored, so it costs no provider request.
 */
export function SavedPlacesForTrip({ onAdded, tripId, tripPlaces }: Readonly<Props>) {
  const t = useTranslations('tripPlaces.savedNearby');
  const destinations = useTripContext()?.trip?.destinations;
  const saved = useQuery({ queryFn: fetchSavedPlaces, queryKey: queryKeys.savedPlaces() });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const groups = useMemo(
    () =>
      savedPlacesNearTrip({
        destinations: destinations ?? [],
        saved: saved.data?.savedPlaces ?? [],
        tripPlaceIds: new Set(tripPlaces.map((tripPlace) => tripPlace.place.id)),
      }),
    [destinations, saved.data, tripPlaces],
  );
  if (!groups.length) return null;

  async function add(key: string, placeIds: string[]) {
    setBusy(key);
    setFailed(false);
    try {
      for (const placeId of placeIds) {
        const { tripPlace } = await addTripPlace(tripId, placeId);
        onAdded(tripPlace);
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const name = (place: (typeof group.places)[number]['place']) =>
          place.name ?? place.snapshot?.name ?? place.providerLabel ?? t('unnamed');
        return (
          <section
            aria-label={t('title', {
              count: group.places.length,
              destination: group.destinationName,
            })}
            className="rounded-[var(--radius-lg)] border border-border p-4"
            key={group.destinationName}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Icons.Saved aria-hidden="true" className="size-4 text-muted-foreground" />
                {t('title', { count: group.places.length, destination: group.destinationName })}
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={() => setOpen((current) => !current)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {open ? t('hide') : t('review')}
                </Button>
                <Button
                  disabled={busy !== null}
                  onClick={() =>
                    void add(
                      group.destinationName,
                      group.places.map((entry) => entry.place.id),
                    )
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {busy === group.destinationName ? t('adding') : t('addAll')}
                </Button>
              </div>
            </div>
            {failed ? (
              <p className="mt-2 text-sm text-status-danger" role="alert">
                {t('error')}
              </p>
            ) : null}
            {open ? (
              <ul className="mt-3 divide-y divide-border">
                {group.places.map((entry) => (
                  <li className="flex items-center justify-between gap-3 py-2" key={entry.id}>
                    <span className="min-w-0 truncate text-sm">{name(entry.place)}</span>
                    <Button
                      aria-label={t('addOne', { name: name(entry.place) })}
                      disabled={busy !== null}
                      onClick={() => void add(entry.id, [entry.place.id])}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Plus aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">{t('note')}</p>
          </section>
        );
      })}
    </div>
  );
}
