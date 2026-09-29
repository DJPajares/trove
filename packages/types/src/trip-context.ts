/**
 * What a traveller should know about the time and place of a trip, read from
 * providers rather than authored in Trove: public holidays from the
 * `date-holidays` dataset and typical conditions from Open-Meteo's archive.
 * It never feeds Plan Score; it only informs Insights.
 */
export const TRIP_CONTEXT_VERSION = 1;

export type TripContextHoliday = {
  /** The local calendar date in the holiday's country. */
  date: string;
  dayIds: string[];
  countryCode: string;
  name: string;
  /** Moon-sighted dates can move by a day once announced, so they are expected. */
  certainty: 'official' | 'expected';
};

export type TripContextClimate = {
  dayIds: string[];
  /** Calendar month, 1-12. */
  month: number;
  years: { from: number; to: number };
  temperatureMaxC: number;
  temperatureMinC: number;
  /** Share of the sampled days with at least 1 mm of precipitation, 0-1. */
  wetDayShare: number;
};

export type TripContext = {
  version: typeof TRIP_CONTEXT_VERSION;
  /** The days this context covers, in trip order, so entries can name "Day 3". */
  days: { id: string; date: string }[];
  holidays: TripContextHoliday[];
  climate: TripContextClimate[];
};
