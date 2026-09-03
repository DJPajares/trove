'use client';

import { useQuery } from '@tanstack/react-query';

import { usePreferences } from '@/components/preferences-provider';
import { queryKeys } from '@/lib/query/keys';
import { getTripWeather, type TripWeather } from '@/lib/weather/api';

/**
 * Matches the server's snapshot window, so a client never asks for something the
 * API would answer from its own cache anyway. With `refetchOnMount`,
 * `refetchOnReconnect` and `refetchOnWindowFocus` all off globally, this is what
 * makes reopening Today, the day rail and the trip overview free rather than
 * three identical requests.
 */
const WEATHER_STALE_TIME_MS = 3 * 60 * 60 * 1_000;

export type TripWeatherQuery = {
  data: TripWeather | null;
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
    staleTime: WEATHER_STALE_TIME_MS,
  });

  return {
    data: query.data ?? null,
    isPending: query.isPending,
    refetch: () => void query.refetch(),
    status: query.isPending ? 'loading' : query.error ? 'error' : 'ready',
  };
}

/** The forecast for one date, or `null` when the provider cannot reach it yet. */
export function tripWeatherForDate(weather: TripWeather | null, date: string) {
  return weather?.days.find((day) => day.date === date) ?? null;
}

/** Whether a date is inside the window the provider can answer at all. */
export function isDateForecastable(weather: TripWeather | null, date: string) {
  if (!weather) return false;
  return date >= weather.horizon.startDate && date <= weather.horizon.endDate;
}

/**
 * Whether the answer on screen has outlived the window it was fetched for.
 *
 * The query cache is written to disk, so a traveller who opens Trip Mode on a
 * plane is reading something hours old. That is worth showing - it is better
 * than an empty panel - but PRD 11 is explicit that it must not be dressed up as
 * the weather right now, so surfaces label it and stop calling it current.
 */
export function isWeatherStale(weather: TripWeather | null, now = new Date()) {
  if (!weather) return false;
  const fetchedAt = new Date(weather.fetchedAt).getTime();
  if (!Number.isFinite(fetchedAt)) return true;
  return now.getTime() - fetchedAt > WEATHER_STALE_TIME_MS;
}
