'use client';

import { useQuery } from '@tanstack/react-query';

import { usePreferences } from '@/components/preferences-provider';
import { useTravellerPosition } from '@/hooks/use-traveller-position';
import { deviceTimeZone } from '@/lib/itinerary/api';
import { queryKeys } from '@/lib/query/keys';
import { getLocationWeather } from '@/lib/weather/api';

export type HereWeather = {
  /** Where the reading came from, so the strip can link back to it. */
  attribution: { label: string; url: string };
  city: string | null;
  condition: number;
  temperature: number;
};

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
  const { position } = useTravellerPosition({ askOnce: true });

  const query = useQuery({
    enabled: Boolean(timeZone),
    queryFn: ({ signal }) =>
      getLocationWeather({
        ...(position
          ? { latitude: position.latitude, longitude: position.longitude }
          : ({} as { latitude?: number; longitude?: number })),
        signal,
        temperatureUnit,
        timeZone: timeZone as string,
      }),
    queryKey: queryKeys.locationWeather(
      position?.latitude ?? 0,
      position?.longitude ?? 0,
      temperatureUnit,
    ),
    // The same policy the trip's weather runs on: a free provider behind a
    // server-side cache, so a stale reading costs a request rather than money.
    refetchOnMount: true,
    refetchOnReconnect: true,
    staleTime: 24 * 60 * 60 * 1_000,
  });

  const data = query.data;
  if (!data?.current)
    return { status: query.isPending ? 'loading' : 'error', weather: null } as const;

  return {
    status: 'ready',
    weather: {
      attribution: data.attribution,
      // Only named when the device said where it was. The server can still put
      // a name to the zone it fell back to, but that names the region the
      // reading came from rather than the traveller - and "Auckland" over a
      // traveller in Whangarei is the claim PRD 21.1 forbids. Without a
      // position the strip shows the reading and says nothing about where.
      city: position ? (data.place?.name ?? null) : null,
      condition: data.current.weatherCode,
      temperature: data.current.temperature,
    },
  } as const;
}
