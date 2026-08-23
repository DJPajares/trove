import type { ItineraryDay, ItineraryItem, ItineraryRouteSegment } from './api';

export type DailyBaseIds = {
  arrivalTripPlaceId: string | null;
  departureTripPlaceId: string | null;
};

/**
 * Where the day begins and ends. The day's own fields are the truth when set.
 * When they are not, the API may still have inferred a base from that day's
 * accommodation reservations; the only place that inference surfaces on the
 * client is the route segments, so they are the fallback rather than a second
 * guess at the same rule.
 */
export function resolveDailyBases(input: {
  day: Pick<ItineraryDay, 'dailyBaseDepartureTripPlaceId' | 'dailyBaseTripPlaceId'> | null;
  routeSegments?: ItineraryRouteSegment[];
}): DailyBaseIds {
  if (!input.day) return { arrivalTripPlaceId: null, departureTripPlaceId: null };
  const segments = input.routeSegments ?? [];

  return {
    arrivalTripPlaceId:
      input.day.dailyBaseTripPlaceId ??
      segments.find(
        (segment) => segment.modeOwner.kind === 'day_start' && segment.origin.kind === 'daily_base',
      )?.origin.id ??
      null,
    departureTripPlaceId:
      input.day.dailyBaseDepartureTripPlaceId ??
      input.day.dailyBaseTripPlaceId ??
      segments.find((segment) => segment.destination.kind === 'daily_base')?.destination.id ??
      null,
  };
}

export type DayStopNumbers = {
  /** The base the day leaves from, always the day's first stop when there is one. */
  arrival: number | null;
  /** The base the day ends at, always the day's last stop when there is one. */
  departure: number | null;
  /** Added to an item's index to get its number, once a base has taken first place. */
  itemOffset: number;
};

/**
 * The day counted as it is travelled. A base is not scenery the day happens
 * around — it is where the day starts and ends — so it takes its place in the
 * sequence, and the stops after it move down one.
 *
 * Leaving a base in the morning and returning to it at night are two different
 * moments in the day, not one stop repeated — the same way a real itinerary
 * lists a hotel as both where the day begins and where it ends. Both get counted,
 * even when they are the same physical place.
 *
 * Every surface that numbers the day reads these, so a circle on the map and a
 * row in the list can never disagree about which stop they are.
 */
export function dayStopNumbers(input: { bases: DailyBaseIds; itemCount: number }): DayStopNumbers {
  const itemOffset = input.bases.arrivalTripPlaceId ? 1 : 0;

  return {
    arrival: input.bases.arrivalTripPlaceId ? 1 : null,
    departure: input.bases.departureTripPlaceId ? itemOffset + input.itemCount + 1 : null,
    itemOffset,
  };
}

export type DayTimelineEntry =
  | { kind: 'base'; role: 'arrival' | 'departure'; stopNumber: number; tripPlaceId: string }
  | { kind: 'leg'; segment: ItineraryRouteSegment }
  | { kind: 'stop'; item: ItineraryItem; stopNumber: number };

/**
 * The day in the order it is actually travelled: the base it starts from, then
 * each stop preceded by the leg that reaches it, then the leg home, then the
 * base it ends at.
 *
 * The sequence lives here rather than in JSX because travel order is a rule
 * about the day, not a rendering detail. Assembled inline it had drifted: the
 * legs that end at a base were appended after every item as a separate pass, so
 * a row's position stopped meaning "this is when it happens" and started
 * meaning "this is which loop emitted it".
 *
 * Numbering is `dayStopNumbers`', never recomputed here. The map numbers its
 * circles from the same function, and a list that counted for itself would
 * eventually count differently.
 */
export function buildDaySequence(input: {
  bases: DailyBaseIds;
  items: ItineraryItem[];
  routeSegments?: ItineraryRouteSegment[];
}): DayTimelineEntry[] {
  const numbers = dayStopNumbers({ bases: input.bases, itemCount: input.items.length });
  const segments = input.routeSegments ?? [];
  const entries: DayTimelineEntry[] = [];

  if (input.bases.arrivalTripPlaceId && numbers.arrival) {
    entries.push({
      kind: 'base',
      role: 'arrival',
      stopNumber: numbers.arrival,
      tripPlaceId: input.bases.arrivalTripPlaceId,
    });
  }

  input.items.forEach((item, index) => {
    const incoming = segments.find(
      (segment) =>
        segment.destination.kind === 'itinerary_item' && segment.destination.id === item.id,
    );
    if (incoming) entries.push({ kind: 'leg', segment: incoming });
    entries.push({ kind: 'stop', item, stopNumber: numbers.itemOffset + index + 1 });
  });

  // A return to base belongs directly before the base it returns to, whether
  // there is one such leg or several.
  segments
    .filter((segment) => segment.destination.kind === 'daily_base')
    .forEach((segment) => entries.push({ kind: 'leg', segment }));

  if (input.bases.departureTripPlaceId && numbers.departure) {
    entries.push({
      kind: 'base',
      role: 'departure',
      stopNumber: numbers.departure,
      tripPlaceId: input.bases.departureTripPlaceId,
    });
  }

  return entries;
}
