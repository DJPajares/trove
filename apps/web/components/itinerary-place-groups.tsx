'use client';

import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useOnlineStatus } from '@/components/trip-sync-status';
import { Button } from '@/components/ui/button';
import {
  createItineraryItem,
  fetchPlaceGroupings,
  type ItineraryDay,
  type ItineraryTripPlace,
} from '@/lib/itinerary/api';
import { queryKeys } from '@/lib/query/keys';

type Props = {
  dayLabel: (day: ItineraryDay) => string;
  days: readonly ItineraryDay[];
  onAdded: () => Promise<void>;
  placeName: (tripPlace: ItineraryTripPlace) => string;
  tripId: string;
  tripPlaces: readonly ItineraryTripPlace[];
};

/**
 * Trip Places not on any day yet, grouped under the day whose stops they sit
 * near. Worked out from stored coordinates only; nothing is scheduled until the
 * traveller adds a place or a whole group (PRD 29.4).
 */
export function ItineraryPlaceGroups({
  dayLabel,
  days,
  onAdded,
  placeName,
  tripId,
  tripPlaces,
}: Readonly<Props>) {
  const t = useTranslations('itinerary.placeGroups');
  const online = useOnlineStatus();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const groupings = useQuery({
    enabled: online,
    queryFn: ({ signal }) => fetchPlaceGroupings(tripId, { signal }),
    queryKey: queryKeys.placeGroupings(tripId),
    retry: false,
  });

  const byDay = new Map(days.map((day) => [day.id, day]));
  const byPlace = new Map(tripPlaces.map((tripPlace) => [tripPlace.id, tripPlace]));
  const groups = (groupings.data?.groups ?? []).flatMap((group) => {
    const day = byDay.get(group.dayId);
    const places = group.tripPlaceIds.flatMap((id) => {
      const tripPlace = byPlace.get(id);
      return tripPlace ? [tripPlace] : [];
    });
    return day && places.length ? [{ day, places }] : [];
  });
  if (!groups.length) return null;

  async function add(key: string, day: ItineraryDay, placeIds: string[]) {
    setBusy(key);
    setFailed(false);
    try {
      for (const tripPlaceId of placeIds) {
        await createItineraryItem(tripId, {
          itineraryDayId: day.id,
          schedule: { kind: 'none' },
          tripPlaceId,
        });
      }
      await onAdded();
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="itinerary-place-groups" className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold" id="itinerary-place-groups">
          {t('title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>
      {failed ? (
        <p className="text-sm text-status-danger" role="alert">
          {t('error')}
        </p>
      ) : null}
      <ul className="space-y-3">
        {groups.map(({ day, places }) => (
          <li className="rounded-[var(--radius-lg)] border border-border p-4" key={day.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {t('near', { count: places.length, day: dayLabel(day) })}
              </p>
              {places.length > 1 ? (
                <Button
                  disabled={busy !== null}
                  onClick={() =>
                    void add(
                      day.id,
                      day,
                      places.map((place) => place.id),
                    )
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {busy === day.id ? t('adding') : t('addAll', { day: dayLabel(day) })}
                </Button>
              ) : null}
            </div>
            <ul className="mt-2 divide-y divide-border">
              {places.map((tripPlace) => (
                <li className="flex items-center justify-between gap-3 py-2" key={tripPlace.id}>
                  <span className="min-w-0 truncate text-sm">{placeName(tripPlace)}</span>
                  <Button
                    aria-label={t('addOne', { day: dayLabel(day), name: placeName(tripPlace) })}
                    disabled={busy !== null}
                    onClick={() => void add(`${day.id}:${tripPlace.id}`, day, [tripPlace.id])}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Plus aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
