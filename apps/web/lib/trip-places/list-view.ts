import type { ScheduledPlaceUse } from '@/lib/itinerary/places';
import { DESTINATION_REACH_KM } from '@/lib/trip-places/saved-near-trip';

/**
 * How a trip's Place collection is narrowed and described in a list: what a
 * search or the "not on a day" filter keeps, how a place's days read, and when
 * a place sits too far from a day to fit it. Pure, so the Places page and the
 * itinerary's drawer agree by construction rather than by copying each other.
 */

/** Everything, or only the places no day has claimed yet: what is left to plan. */
export const tripPlaceShows = ['all', 'unplanned'] as const;
export type TripPlaceShow = (typeof tripPlaceShows)[number];

/**
 * Text folded for matching. Case, accents, spacing and punctuation all fall
 * away, as does the Vietnamese đ, which Unicode does not decompose - so "ha
 * noi" and "hanoi" both find "Hà Nội", and "dong da" finds "Đống Đa".
 */
export function foldPlaceText(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Every word of the query has to appear somewhere in the place's own text. */
export function matchesPlaceQuery(fields: readonly (string | null | undefined)[], query: string) {
  const terms = query.split(/\s+/).map(foldPlaceText).filter(Boolean);
  if (!terms.length) return true;

  // Joined with a separator the folding never produces, so a term cannot
  // match across the end of one field and the start of the next.
  const haystack = fields.flatMap((field) => (field ? [foldPlaceText(field)] : [])).join('\n');
  return terms.every((term) => haystack.includes(term));
}

/** On at least one day of the itinerary. A place parked in Unscheduled is not. */
export function isOnADay(use: ScheduledPlaceUse | undefined) {
  return Boolean(use?.dayNumbers.length);
}

/**
 * The places a list shows for a query and a filter. `keep` holds places the
 * traveller has just added to a day: under "not on a day" they would vanish
 * from beneath the button that added them, so they stay until the view changes.
 */
export function filterTripPlaces<T extends { id: string }>(
  places: readonly T[],
  options: {
    fieldsOf: (place: T) => readonly (string | null | undefined)[];
    keep?: ReadonlySet<string>;
    placeUse?: Readonly<Record<string, ScheduledPlaceUse>>;
    query: string;
    show: TripPlaceShow;
  },
) {
  return places.filter((place) => {
    if (
      options.show === 'unplanned' &&
      isOnADay(options.placeUse?.[place.id]) &&
      !options.keep?.has(place.id)
    ) {
      return false;
    }
    return matchesPlaceQuery(options.fieldsOf(place), options.query);
  });
}

export function countTripPlaces<T extends { id: string }>(
  places: readonly T[],
  placeUse?: Readonly<Record<string, ScheduledPlaceUse>>,
) {
  return {
    all: places.length,
    unplanned: places.filter((place) => !isOnADay(placeUse?.[place.id])).length,
  };
}

/**
 * A place's days in order, with consecutive days joined into a range: "4",
 * "2–3", "1–3, 5". The range and the list both come from Intl, so neither the
 * dash nor the separator is hard-coded.
 */
export function formatDayNumbers(days: readonly number[], locale: string) {
  const sorted = [...new Set(days)].toSorted((left, right) => left - right);
  const numbers = new Intl.NumberFormat(locale);
  const runs: string[] = [];

  let start = 0;
  for (let index = 1; index <= sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous !== undefined && current === previous + 1) continue;

    const first = sorted[start];
    if (first !== undefined && previous !== undefined) {
      runs.push(first === previous ? numbers.format(first) : numbers.formatRange(first, previous));
    }
    start = index;
  }

  return new Intl.ListFormat(locale, { style: 'short', type: 'unit' }).format(runs);
}

/**
 * A destination is a city or region, and this is its reach (see
 * `DESTINATION_REACH_KM`). A place further than that from every stop of a day
 * is in another part of the trip from it, which is worth saying before it is
 * added there.
 */
export const FAR_FROM_DAY_METRES = DESTINATION_REACH_KM * 1000;

export function isFarFromDay(metres: number) {
  return metres > FAR_FROM_DAY_METRES;
}

/**
 * How many itinerary stops still use this place. The API refuses to remove a
 * Trip Place while any do, so a list can say so before asking to confirm.
 * Either count may be the fresher one, so the larger is trusted.
 */
export function itineraryReferences(
  tripPlace: { id: string; referenceCount: number },
  placeUse?: Readonly<Record<string, ScheduledPlaceUse>>,
) {
  return Math.max(tripPlace.referenceCount, placeUse?.[tripPlace.id]?.itemCount ?? 0);
}
