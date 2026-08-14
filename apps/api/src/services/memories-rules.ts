import { formatInstantInTimeZone } from './itinerary-rules.js';
import { isValidIanaTimeZone } from './trip-rules.js';

export type MemoryTimeZoneResolution = {
  source: 'ITINERARY_DAY' | 'ITINERARY_ITEM' | 'TRIP_PLACE' | 'TRIP_REFERENCE';
  timeZone: string;
};

/**
 * A Memory takes its timezone from the context it was captured against, in the
 * order the traveller would expect: the itinerary item, then the Place, then the
 * day, then the trip reference. Callers re-run this only when the traveller
 * explicitly corrects the Memory's own time, day, or Place, so ordinary trip
 * edits never reinterpret an existing capture time.
 */
export function resolveMemoryTimeZone(input: {
  itineraryDayTimeZone: string | null;
  itineraryItemTimeZone: string | null;
  tripPlaceTimeZone: string | null;
  tripTimeZone: string;
}): MemoryTimeZoneResolution {
  if (input.itineraryItemTimeZone && isValidIanaTimeZone(input.itineraryItemTimeZone)) {
    return { source: 'ITINERARY_ITEM', timeZone: input.itineraryItemTimeZone };
  }

  if (input.tripPlaceTimeZone && isValidIanaTimeZone(input.tripPlaceTimeZone)) {
    return { source: 'TRIP_PLACE', timeZone: input.tripPlaceTimeZone };
  }

  if (input.itineraryDayTimeZone && isValidIanaTimeZone(input.itineraryDayTimeZone)) {
    return { source: 'ITINERARY_DAY', timeZone: input.itineraryDayTimeZone };
  }

  return { source: 'TRIP_REFERENCE', timeZone: input.tripTimeZone };
}

/**
 * The captured instant is authoritative. The stored local date and time are a
 * derived representation of that instant in the resolved timezone.
 */
export function deriveCapturedLocal(instant: Date, timeZone: string) {
  return formatInstantInTimeZone(instant, timeZone);
}

/**
 * Correcting the timezone can move a Memory to a different calendar day, which
 * changes where it appears in a Trip Story. Callers surface this rather than
 * letting the Memory move silently.
 */
export function describeCapturedLocalChange(
  instant: Date,
  previous: { timeZone: string },
  next: { timeZone: string },
) {
  const before = deriveCapturedLocal(instant, previous.timeZone);
  const after = deriveCapturedLocal(instant, next.timeZone);

  return { after, before, localDateChanged: before.date !== after.date };
}
