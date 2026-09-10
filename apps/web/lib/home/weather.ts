import type { TripModeContext } from '@/lib/itinerary/api';
import type { Trip } from '@/lib/trips/api';
import type { TripWeather } from '@/lib/weather/api';

export type HomeWeatherTarget = {
  date: string;
  kind: 'current' | 'forecast';
  tripId: string;
};

function clampToTrip(date: string, trip: Trip) {
  if (date < trip.startDate) return trip.startDate;
  if (date > trip.endDate) return trip.endDate;
  return date;
}

/**
 * Which day of the focal trip the ribbon should speak about.
 *
 * The location that day sits at is no longer decided here: the server resolves
 * it per day from the itinerary, which is the only place that knows a trip has
 * moved on to another city. What is left is the question Home actually owns -
 * whether the traveller wants to know about right now or about the day they
 * leave.
 *
 * A trip already under way asks about the day Trip Mode is showing, and about
 * today when that context has not loaded or would not load. It used to fall
 * back to the day the trip started, which on the third day of a trip is a date
 * the forecast window no longer covers - so Home asked about a day nothing
 * could answer and drew a blank while Trip Mode, one tap away, showed weather.
 */
export function resolveHomeWeatherTarget(
  trip: Trip,
  context: TripModeContext | null,
  now = new Date(),
): HomeWeatherTarget | null {
  if (trip.lifecycle === 'completed') return null;

  if (trip.lifecycle === 'planning') {
    return { date: trip.startDate, kind: 'forecast', tripId: trip.id };
  }

  return {
    date: context?.selectedDate ?? clampToTrip(localDate(now, trip.referenceTimeZone), trip),
    kind: 'current',
    tripId: trip.id,
  };
}

function localDate(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * The reading to draw, what it is honestly a reading of, and which day it is
 * about.
 *
 * A current reading is only ever current: it is served from the API's
 * short-lived tier, the date still has to be today where the traveller is, and
 * `allowCurrent` is how the caller withholds it once the answer on screen has
 * outlived its claim to be now. Withholding it downgrades the ribbon to the
 * day's forecast rather than emptying it.
 *
 * A day the itinerary cannot place has no forecast of its own, and the trip's
 * first day is often exactly that day. Rather than say nothing, the soonest day
 * the provider did answer stands in - and the reading carries that day's date,
 * so the ribbon names the day it is actually showing.
 */
export function selectHomeWeatherReading(
  data: TripWeather,
  target: HomeWeatherTarget,
  now = new Date(),
  allowCurrent = true,
) {
  const forecast =
    data.days.find((day) => day.date === target.date) ??
    data.days.find((day) => day.date > target.date) ??
    null;
  const timeZone = forecast?.location.timeZone ?? data.days[0]?.location.timeZone ?? 'UTC';
  const showCurrent =
    allowCurrent &&
    target.kind === 'current' &&
    data.current !== null &&
    target.date === localDate(now, timeZone);

  if (showCurrent && data.current) {
    return { date: target.date, kind: 'current' as const, reading: data.current };
  }

  return forecast
    ? { date: forecast.date, kind: 'forecast' as const, reading: forecast }
    : { date: target.date, kind: 'out_of_range' as const, reading: null };
}
