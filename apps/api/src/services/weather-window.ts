import { formatDateOnly, getLocalDate, parseDateOnly } from './trip-rules.js';

/**
 * Open-Meteo serves today plus fifteen further days. The number is the
 * provider's, not a Trove preference: asking past it is a 400 rather than a
 * shorter answer, so the horizon has to be respected before the call is made.
 */
export const WEATHER_FORECAST_HORIZON_DAYS = 15;

export type ForecastWindow = {
  endDate: string;
  startDate: string;
};

function shiftDate(date: string, days: number) {
  const shifted = parseDateOnly(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return formatDateOnly(shifted);
}

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
  const today = timeZones.length
    ? timeZones.map((timeZone) => getLocalDate(now, timeZone))
    : [getLocalDate(now, 'UTC')];

  const earliestToday = today.reduce((earliest, date) => (date < earliest ? date : earliest));

  // The end is measured from the *earliest* local today, because that is the
  // zone whose horizon runs out first. Measuring from the latest would push the
  // request one day past what the earliest zone allows, and the provider
  // rejects the whole batch rather than trimming it.
  const localEnd = shiftDate(earliestToday, WEATHER_FORECAST_HORIZON_DAYS);

  // The provider's horizon is anchored to its own today, which is UTC's - not
  // the traveller's. Every zone east of UTC reaches tomorrow first, so from
  // about 16:00 UTC a Singapore or Auckland trip measured only from local time
  // asks for a day the provider does not have yet, and the whole batch comes
  // back 400. Whichever end arrives first is the one that binds.
  const providerEnd = shiftDate(getLocalDate(now, 'UTC'), WEATHER_FORECAST_HORIZON_DAYS);

  // The start needs no such guard: a zone west of UTC asks for yesterday at the
  // earliest, and the provider serves months of past days.
  return {
    endDate: localEnd < providerEnd ? localEnd : providerEnd,
    startDate: earliestToday,
  };
}

/** Whether a date-only day can be answered by the window at all. */
export function isWithinForecastWindow(date: string, window: ForecastWindow) {
  return date >= window.startDate && date <= window.endDate;
}
