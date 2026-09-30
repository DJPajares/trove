'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback } from 'react';

import { usePreferences } from '@/components/preferences-provider';
import type { Coordinate } from '@/lib/maps/haversine';
import type { TripPlace } from '@/lib/trip-places/api';
import {
  describeHours,
  describeRating,
  formatNearbyDistance,
  nearestDistanceMeters,
  type SignalsTranslator,
} from '@/lib/trip-places/signals';
import { useTripPlaceHours } from '@/lib/trip-places/use-trip-place-hours';

const MIN_SHOWN_DISTANCE_METRES = 30;

/**
 * The facts Trove already stores about a trip's places, ready for a list row.
 * With a `date` it adds whether each place is open that day; with `anchors` (the
 * day's located stops) it adds how far each is from them. Both are derived from
 * stored evidence and coordinates, so nothing here reaches a provider.
 */
export function useTripPlaceSignals(
  tripId: string,
  options: { anchors?: readonly Coordinate[]; date?: string | null } = {},
) {
  const t = useTranslations('placeSignals') as unknown as SignalsTranslator;
  const locale = useLocale();
  const { preferences } = usePreferences();
  const signals = useTripPlaceHours(tripId, options.date ?? null);
  const anchors = options.anchors ?? [];
  const hour12 = preferences.timeFormat === '12h';

  const distanceOf = useCallback(
    (tripPlace: TripPlace) => nearestDistanceMeters(tripPlace.place.location, anchors),
    [anchors],
  );
  const hoursOf = useCallback(
    (tripPlace: TripPlace) => signals[tripPlace.id]?.hours?.status ?? null,
    [signals],
  );

  const signalsFor = useCallback(
    (tripPlace: TripPlace) => {
      const entry = signals[tripPlace.id];
      const lines: Array<{ emphasis?: boolean; text: string }> = [];
      const hours = describeHours(entry?.hours, { hour12, locale, t });
      if (hours) lines.push({ emphasis: entry?.hours?.status === 'closed', text: hours });
      const rating = describeRating(entry?.rating, { locale, t });
      if (rating) lines.push({ text: rating });
      const distance = distanceOf(tripPlace);
      // A place that is already one of the day's stops needs no distance to itself.
      if (distance !== null && distance >= MIN_SHOWN_DISTANCE_METRES) {
        lines.push({
          text: t('fromDay', {
            distance: formatNearbyDistance(distance, preferences.distanceUnit, locale),
          }),
        });
      }
      return lines;
    },
    [distanceOf, hour12, locale, preferences.distanceUnit, signals, t],
  );

  return { distanceOf, hoursOf, signalsFor };
}
