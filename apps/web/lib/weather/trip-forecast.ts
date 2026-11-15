import type { TripWeather, TripWeatherDay } from './api';
import { forecastForDate } from './freshness';
import { dateIsBeforeForecastWindow } from './history';

/**
 * What can honestly be said about one day's weather.
 *
 * - `forecast`: the day's weather, whether it is still ahead or already kept.
 *   A past day is not set apart: the trip keeps its weather on the server and
 *   it reads the same as any other day.
 * - `later`: beyond the provider's reach; it arrives as the day comes closer.
 * - `past`: before the forecast window with nothing archived for it.
 * - `missing`: inside the window, but with nowhere located to have weather.
 */
export type DayForecast =
  | { forecast: TripWeatherDay; state: 'forecast' }
  | { forecast: null; state: 'later' | 'missing' | 'past' };

export function dayForecast(weather: TripWeather | null, date: string): DayForecast | null {
  if (!weather) return null;
  const forecast = forecastForDate(weather, date);
  if (forecast) return { forecast, state: 'forecast' };
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
