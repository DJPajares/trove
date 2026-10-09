import { weatherForecastWindow } from '@trove/types';

/**
 * Open-Meteo serves today plus fifteen further days. The number is the
 * provider's, not a Trove preference: asking past it is a 400 rather than a
 * shorter answer, so the horizon has to be respected before the call is made.
 */
export { WEATHER_FORECAST_HORIZON_DAYS } from '@trove/types';

export type ForecastWindow = {
  endDate: string;
  startDate: string;
};

/**
 * The date range a single request may ask about on behalf of every time zone in
 * it.
 *
 * One request carries one `start_date`/`end_date` pair but may carry many
 * coordinates, and the provider validates the pair against each coordinate's own
 * local calendar. Tokyo and Los Angeles disagree about what day it is, so the
 * legal range is the intersection of their windows, not the union: taking the
 * union would put one of them a day out of bounds and fail the whole batch.
 */
export function resolveForecastWindow(
  timeZones: readonly string[],
  now = new Date(),
): ForecastWindow {
  return weatherForecastWindow(timeZones, now);
}

/** Whether a date-only day can be answered by the window at all. */
export function isWithinForecastWindow(date: string, window: ForecastWindow) {
  return date >= window.startDate && date <= window.endDate;
}
