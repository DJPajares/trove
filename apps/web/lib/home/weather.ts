import type { TripModeContext } from '@/lib/itinerary/api';
import type { Trip } from '@/lib/trips/api';
import type { TripWeather } from '@/lib/weather/api';

export type HomeWeatherTarget = {
  date: string;
  kind: 'current' | 'forecast';
  tripId: string;
};

/**
 * Which day of the focal trip the ribbon should speak about.
 *
 * The location that day sits at is no longer decided here: the server resolves
 * it per day from the itinerary, which is the only place that knows a trip has
 * moved on to another city. What is left is the question Home actually owns -
 * whether the traveller wants to know about right now or about the day they
 * leave.
 */
export function resolveHomeWeatherTarget(
  trip: Trip,
  context: TripModeContext | null,
): HomeWeatherTarget | null {
  if (trip.lifecycle === 'completed') return null;

  if (trip.lifecycle === 'planning') {
    return { date: trip.startDate, kind: 'forecast', tripId: trip.id };
  }

  return {
    date: context?.selectedDate ?? trip.startDate,
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
 * The reading to draw, and what it is honestly a reading of.
 *
 * A current reading is only ever current: it is served from the API's
 * short-lived tier and never from the day snapshot, and the date still has to be
 * today where the traveller is. Anything else is labelled a forecast, and a day
 * the provider cannot reach yet says so rather than borrowing a nearby one.
 */
export function selectHomeWeatherReading(
  data: TripWeather,
  target: HomeWeatherTarget,
  now = new Date(),
) {
  const forecast = data.days.find((day) => day.date === target.date) ?? null;
  const timeZone = forecast?.location.timeZone ?? data.days[0]?.location.timeZone ?? 'UTC';
  const showCurrent =
    target.kind === 'current' && data.current !== null && target.date === localDate(now, timeZone);

  if (showCurrent && data.current) {
    return { kind: 'current' as const, reading: data.current };
  }

  return forecast
    ? { kind: 'forecast' as const, reading: forecast }
    : { kind: 'out_of_range' as const, reading: null };
}
