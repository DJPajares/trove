'use client';

import { useWeatherQuery } from './use-weather-query';
import { tripWeatherUnit } from './client-service';

import { usePreferences } from '@/components/preferences-provider';
import { queryKeys } from '@/lib/query/keys';
import { type TripWeather } from '@/lib/weather/api';
import { forecastForDate } from '@/lib/weather/freshness';

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
export function useTripWeather(
  tripId: string,
  // Home asks only once a trip's first day is within the forecast's reach;
  // before that the answer could only be empty.
  { enabled = true }: { enabled?: boolean } = {},
): TripWeatherQuery {
  const { preferences } = usePreferences();
  const temperatureUnit = preferences.temperatureUnit;

  const query = useWeatherQuery(
    queryKeys.tripWeather(tripId, 'celsius'),
    (service) => service.trip(tripId),
    enabled,
  );

  return {
    data: query.data ? tripWeatherUnit(query.data, temperatureUnit) : null,
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
