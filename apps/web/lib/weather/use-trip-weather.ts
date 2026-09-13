'use client';

import { useQuery } from '@tanstack/react-query';

import { usePreferences } from '@/components/preferences-provider';
import { queryKeys } from '@/lib/query/keys';
import { getTripWeather, type TripWeather } from '@/lib/weather/api';

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

/**
 * How long an answer is held before it is worth asking again.
 *
 * The same three hours, and that is the point. This used to be a day, which
 * quietly broke the surfaces it was meant to serve: between three hours and
 * twenty-four the app held a reading it refused to present as current - the
 * rule directly above - while `refetchOnMount` declined to replace it, because
 * a query is only refetched on mount once it is stale. So for most of every day
 * Trip Mode showed a daily high instead of the hour it was standing in, with an
 * hourly forecast sitting unused in the payload.
 *
 * Tying the two together means the data stops being fresh at the same moment it
 * stops counting as now. Open-Meteo bills nothing and the API answers most of
 * these from its own three-hour snapshot, so the extra asking costs a request
 * rather than money.
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
