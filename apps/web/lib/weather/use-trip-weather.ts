'use client';

import { useQuery } from '@tanstack/react-query';

import { usePreferences } from '@/components/preferences-provider';
import { queryKeys } from '@/lib/query/keys';
import { getTripWeather, type TripWeather } from '@/lib/weather/api';
import { forecastForDate, WEATHER_CURRENT_MAX_AGE_MS } from '@/lib/weather/freshness';

/**
 * How long an answer is held before it is worth asking again.
 *
 * Query receipt age controls requests only. Current-condition eligibility is
 * independently measured from the provider observation, so serving a cached
 * response cannot extend its current window. Keep the existing request policy.
 */
const WEATHER_REFETCH_AFTER_MS = WEATHER_CURRENT_MAX_AGE_MS;

export type TripWeatherQuery = {
  data: TripWeather | null;
  /** When this answer last came from the server. 0 until one has. */
  dataUpdatedAt: number;
  isPending: boolean;
  refetch: () => void;
  status: 'error' | 'loading' | 'ready';
};

/**
 * The trip's weather, asked once and read by every surface that draws it.
 *
 * Deliberately parameterless beyond the trip: Today, the day rail, the trip
 * overview, the Now card and the home ribbon all ask the identical question, so
 * they share one entry and navigating between them costs nothing. A flag that
 * split the key would have made each crossing a fresh round trip for a forecast
 * already in hand.
 */
export function useTripWeather(tripId: string): TripWeatherQuery {
  const { preferences } = usePreferences();
  const temperatureUnit = preferences.temperatureUnit;

  const query = useQuery({
    queryFn: ({ signal }) => getTripWeather(tripId, { signal, temperatureUnit }),
    queryKey: queryKeys.tripWeather(tripId, temperatureUnit),
    // Trove turns all three of these off globally, because several read
    // endpoints reach Google and an automatic refetch would be a per-focus
    // charge. This one reaches a free provider through a cache of its own, and
    // a forecast nobody refreshes is the thing that made surfaces apologise for
    // their own data. The stale time above is what keeps it from being chatty.
    refetchOnMount: true,
    refetchOnReconnect: true,
    staleTime: WEATHER_REFETCH_AFTER_MS,
  });

  return {
    data: query.data ?? null,
    dataUpdatedAt: query.dataUpdatedAt,
    isPending: query.isPending,
    refetch: () => void query.refetch(),
    status: query.isPending ? 'loading' : query.error ? 'error' : 'ready',
  };
}

/** The forecast for one date, or `null` when the provider cannot reach it yet. */
export function tripWeatherForDate(weather: TripWeather | null, date: string) {
  return forecastForDate(weather, date);
}

/** Whether a date is inside the window the provider can answer at all. */
export function isDateForecastable(weather: TripWeather | null, date: string) {
  if (!weather) return false;
  return date >= weather.horizon.startDate && date <= weather.horizon.endDate;
}
