import type { TripWeather, TripWeatherDay } from './api';
import { forecastForDate, isArchivedForecast } from './freshness';
import { dateIsBeforeForecastWindow } from './history';

/**
 * What can honestly be said about one day's weather.
 *
 * - `forecast`: a dated forecast for an upcoming day or today.
 * - `archived`: the forecast a past day was given, kept as it was - never an
 *   observation of what happened.
 * - `later`: beyond the provider's reach; it arrives as the day comes closer.
 * - `past`: before the forecast window with nothing archived for it.
 * - `missing`: inside the window, but with nowhere located to have weather.
 */
export type DayForecast =
  | { forecast: TripWeatherDay; state: 'archived' | 'forecast' }
  | { forecast: null; state: 'later' | 'missing' | 'past' };

export function dayForecast(
  weather: TripWeather | null,
  date: string,
  now = new Date(),
): DayForecast | null {
  if (!weather) return null;
  const forecast = forecastForDate(weather, date);
  if (forecast)
    return { forecast, state: isArchivedForecast(forecast, now) ? 'archived' : 'forecast' };
  if (dateIsBeforeForecastWindow(weather.horizon, date)) return { forecast: null, state: 'past' };
  if (date > weather.horizon.endDate) return { forecast: null, state: 'later' };
  return { forecast: null, state: 'missing' };
}

/**
 * The one sentence a trip-wide forecast owes for the days it cannot show, so a
 * long trip says "later" once rather than down every column. The furthest-out
 * reason wins: days that will be forecast soon matter more than ones that
 * will never be.
 */
export function forecastGap(states: readonly DayForecast['state'][]) {
  if (states.includes('later')) return 'later' as const;
  if (states.includes('missing')) return 'missing' as const;
  if (states.includes('past')) return 'past' as const;
  return null;
}
