'use client';

import { useEffect, useState } from 'react';

import { useWeatherQuery } from '@/lib/weather/use-weather-query';
import { locationWeatherUnit } from '@/lib/weather/client-service';

import { usePreferences } from '@/components/preferences-provider';
import { useTravellerPosition } from '@/hooks/use-traveller-position';
import { useNowTick } from '@/hooks/use-now-tick';
import { forgetHere, rememberHere, useLastHere } from '@/lib/home/last-here';
import { deviceTimeZone } from '@/lib/itinerary/api';
import { queryKeys } from '@/lib/query/keys';
import { selectLocationWeather } from '@/lib/weather/freshness';

export type HereWeather = {
  /** Where the reading came from, so the strip can link back to it. */
  attribution: { label: string; url: string };
  city: string | null;
  timeZone: string;
  fetchedAt: string;
} & NonNullable<ReturnType<typeof selectLocationWeather>>;

/**
 * What it is like where the traveller is standing.
 *
 * Home asks for location once, the first time it draws this, because the whole
 * claim of the strip is that it is about where you are - and without a position
 * it can only be about the time zone, which is a region the size of a country.
 * A refusal is remembered and never asked again.
 *
 * With a position, both halves are true: the reading is taken at those
 * coordinates and the server names the place they are actually in. Without one,
 * the reading is the zone's city and it is labelled as nothing at all - PRD 21.1
 * forbids fabricating a current physical location, and "Auckland" over
 * Whangarei's weather was exactly that.
 */
export function useHereWeather() {
  const { preferences } = usePreferences();
  const temperatureUnit = preferences.temperatureUnit;
  const timeZone = deviceTimeZone();
  // Asks once, then never again. A granted permission is still read silently.
  const { position: fix, status: fixStatus } = useTravellerPosition({ askOnce: true });
  const lastHere = useLastHere();
  const now = useNowTick(true, true);

  useEffect(() => {
    if (fix) rememberHere(fix);
    else if (fixStatus === 'denied') forgetHere();
  }, [fix, fixStatus]);

  // A fresh fix takes seconds and sometimes never comes. Until it does, the
  // place found last time stands in, so the strip opens on the reading and the
  // name it had rather than on neither; the fix replaces it only when it lands
  // somewhere else. A refusal is never papered over.
  const position = fix ?? (fixStatus === 'denied' ? null : lastHere);

  const query = useWeatherQuery(
    queryKeys.locationWeather(
      position?.latitude ?? null,
      position?.longitude ?? null,
      'celsius',
      timeZone ?? null,
    ),
    (service) =>
      service.location({
        ...(position ? { latitude: position.latitude, longitude: position.longitude } : {}),
        temperatureUnit: 'celsius',
        timeZone: timeZone!,
      }),
    Boolean(timeZone),
  );
  // Moving to a new place keeps the last reading taken at coordinates, and its
  // name, on screen until the new one arrives, so the strip changes once
  // instead of blanking. Only a positioned reading is kept: the time zone's
  // would lend its region's name to the traveller's fix while that loads.
  const [lastPositioned, setLastPositioned] = useState<typeof query.data>(undefined);
  useEffect(() => {
    if (position && query.data && !query.isFetching) setLastPositioned(query.data);
  }, [position, query.data, query.isFetching]);
  const shown = query.data ?? (position ? lastPositioned : undefined);
  const data = shown ? locationWeatherUnit(shown, temperatureUnit) : null;
  const selected = data ? selectLocationWeather(data, now) : null;
  if (!data || !selected)
    return {
      status: query.isPending ? 'loading' : 'error',
      weather: null,
    } as const;

  return {
    status: 'ready',
    weather: {
      attribution: data.attribution,
      // Only named when the device said where it was, now or on a recent
      // visit. The server can still put
      // a name to the zone it fell back to, but that names the region the
      // reading came from rather than the traveller - and "Auckland" over a
      // traveller in Whangarei is the claim PRD 21.1 forbids. Without a
      // position the strip shows the reading and says nothing about where.
      city: position ? (data.place?.name ?? null) : null,
      timeZone: data.location.timeZone,
      fetchedAt: data.fetchedAt,
      ...selected,
    },
  } as const;
}
