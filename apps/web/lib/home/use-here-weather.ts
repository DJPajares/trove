'use client';

import { useQuery } from '@tanstack/react-query';

import { usePreferences } from '@/components/preferences-provider';
import { useTravellerPosition } from '@/hooks/use-traveller-position';
import { cityFromTimeZone } from '@/lib/home/here';
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
 * Two sources, in the order of what they cost the traveller. A position they
 * have already agreed to share is read silently and used as-is. Everyone else -
 * which is most visits, because Trove never prompts for location - is answered
 * from the device's own time zone, which the server turns into the city the
 * zone is named after.
 *
 * That name is an approximation and the mismatch runs one way: with a shared
 * position the reading is exactly where the traveller is while the name is
 * still the zone's city, so someone in Hamilton reads "Auckland" over Hamilton's
 * temperature. The alternative was a billable reverse geocode on a screen that
 * renders every session, which AGENTS.md rules out for good reason.
 */
export function useHereWeather() {
  const { preferences } = usePreferences();
  const temperatureUnit = preferences.temperatureUnit;
  const timeZone = deviceTimeZone();
  // Probes an already-granted permission and prompts for nothing. A traveller
  // who has never shared their location simply falls through to the zone.
  const { position } = useTravellerPosition();

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
      city: data.place?.name ?? cityFromTimeZone(timeZone),
      condition: data.current.weatherCode,
      temperature: data.current.temperature,
    },
  } as const;
}
