'use client';

import { useQuery } from '@tanstack/react-query';

import { usePreferences } from '@/components/preferences-provider';
import { queryKeys } from '@/lib/query/keys';
import { getTripWeather, type TripWeather } from '@/lib/weather/api';

/**
 * How long an answer is held before it is worth asking again.
 *
 * With `refetchOnMount` and `refetchOnReconnect` turned back on for this one
 * query, this is the entire refresh policy: opening a weather surface, or
 * coming back online, past a day asks again, and everything inside the day -
 * Today, the day rail, the trip overview, Home - reads the answer already in
 * hand. Open-Meteo bills nothing and the API answers most of these from its own
 * snapshot, so the occasional refetch costs a request rather than money.
 */
const WEATHER_REFETCH_AFTER_MS = 24 * 60 * 60 * 1_000;

/**
 * How long a reading may still be called "now".
 *
 * Matches the API's forecast snapshot window. Past it the traveller is reading
 * something from earlier in the day - or, on a plane, from a good deal further
 * back - and PRD 11 is explicit that cached weather must not be dressed up as
 * the weather right now. So surfaces stop calling it current and show the day's
 * forecast, which the heading already says it is.
 */
const WEATHER_CURRENT_MAX_AGE_MS = 3 * 60 * 60 * 1_000;

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
  return weather?.days.find((day) => day.date === date) ?? null;
}

/** Whether a date is inside the window the provider can answer at all. */
export function isDateForecastable(weather: TripWeather | null, date: string) {
  if (!weather) return false;
  return date >= weather.horizon.startDate && date <= weather.horizon.endDate;
}

/**
 * Whether the answer on screen has outlived its claim to be current.
 *
 * Measured from when the query last reached the server, not from the payload's
 * `fetchedAt`: that field carries the age of the API's own forecast snapshot,
 * which is up to three hours old the moment it is served, so reading it here
 * called fresh data stale and left surfaces refusing to show what they had.
 */
export function isCurrentReadingStale(dataUpdatedAt: number, now = new Date()) {
  if (!dataUpdatedAt || !Number.isFinite(dataUpdatedAt)) return true;
  return now.getTime() - dataUpdatedAt > WEATHER_CURRENT_MAX_AGE_MS;
}
