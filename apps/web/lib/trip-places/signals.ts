import type { PlaceHoursStatus, TripPlaceSignals } from '@/lib/itinerary/api';
import { formatSuggestedClock } from '@/lib/itinerary/day-time-suggestions';
import { haversineMeters, type Coordinate } from '@/lib/maps/haversine';
import { tripPlaceSorts, type TripPlaceSort } from '@/lib/trip-places/sort';

/**
 * What Trove already knows about a place, phrased for a list row: whether it is
 * open on a date, how it is rated, how far it is from the day. Everything here
 * is derived from stored evidence and coordinates, so none of it costs a
 * provider request, and an unknown is left out rather than guessed.
 */

export type SignalsTranslator = (key: string, values?: Record<string, number | string>) => string;

const METRES_PER_MILE = 1609.344;
const FEET_PER_METRE = 3.28084;

/** A place's hours on a day, split so a row can set their age quieter than the hours themselves. */
export type HoursParts = { checked: string; closed: boolean; label: string };

/** A rating split into the number, its review count, and the full sentence for assistive tech. */
export type RatingParts = { count: string | null; label: string; value: string };

/** Everything a Trip Place row can say about a place without asking a provider. */
export type TripPlaceRowSignals = {
  distance?: { far: boolean; text: string };
  hours?: HoursParts;
  rating?: RatingParts;
};

/** "Open 9:00 AM – 5:00 PM", "Closed this day", or null when nothing is known. */
export function describeHours(
  status: PlaceHoursStatus | undefined,
  options: { hour12: boolean; locale: string; t: SignalsTranslator },
): string | null {
  const parts = describeHoursParts(status, options);
  return parts ? `${parts.label} · ${parts.checked}` : null;
}

/** The same as `describeHours`, with the hours and the date they were checked kept apart. */
export function describeHoursParts(
  status: PlaceHoursStatus | undefined,
  options: { hour12: boolean; locale: string; t: SignalsTranslator },
): HoursParts | null {
  if (!status) return null;
  const { hour12, locale, t } = options;
  const checked = t('checked', {
    date: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(
      new Date(status.asOf),
    ),
  });

  if (status.status === 'closed') return { checked, closed: true, label: t('closed') };

  const allDay =
    status.spans.length === 1 &&
    status.spans[0]?.open === '00:00' &&
    status.spans[0]?.close === '24:00';
  const times = allDay
    ? null
    : status.spans
        .map(
          (span) =>
            `${formatSuggestedClock(span.open, locale, hour12)} – ${formatSuggestedClock(span.close, locale, hour12)}`,
        )
        .join(', ');
  const label = allDay
    ? t('allDay')
    : t(status.special ? 'specialHours' : 'openHours', { times: times ?? '' });

  return { checked, closed: false, label };
}

/** "4.5 on Google (1.2K reviews)": the source is named because the number is theirs. */
export function describeRating(
  rating: TripPlaceSignals['rating'] | undefined,
  options: { locale: string; t: SignalsTranslator },
): string | null {
  return describeRatingParts(rating, options)?.label ?? null;
}

/** The same as `describeRating`, with the number and the compact review count kept apart. */
export function describeRatingParts(
  rating: TripPlaceSignals['rating'] | undefined,
  options: { locale: string; t: SignalsTranslator },
): RatingParts | null {
  if (!rating) return null;
  const { locale, t } = options;
  const value = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(rating.value);
  if (!rating.reviewCount) return { count: null, label: t('rating', { rating: value }), value };

  const count = new Intl.NumberFormat(locale, { notation: 'compact' }).format(rating.reviewCount);
  return { count, label: t('ratingWithCount', { count, rating: value }), value };
}

/** Straight-line distance to the closest of the day's stops, or null with nothing to measure from. */
export function nearestDistanceMeters(
  location: Coordinate | null | undefined,
  anchors: readonly Coordinate[],
): number | null {
  if (!location || !anchors.length) return null;
  return Math.min(...anchors.map((anchor) => haversineMeters(location, anchor)));
}

/** A short distance in the traveller's own unit, from Intl so no unit word is hard-coded. */
export function formatNearbyDistance(meters: number, unit: 'km' | 'mi', locale: string) {
  const show = (value: number, intlUnit: string, digits: number) =>
    new Intl.NumberFormat(locale, {
      maximumFractionDigits: digits,
      style: 'unit',
      unit: intlUnit,
      unitDisplay: 'short',
    }).format(value);

  if (unit === 'mi') {
    return meters / METRES_PER_MILE < 0.1
      ? show(Math.round((meters * FEET_PER_METRE) / 10) * 10, 'foot', 0)
      : show(meters / METRES_PER_MILE, 'mile', meters / METRES_PER_MILE < 10 ? 1 : 0);
  }
  return meters < 1000
    ? show(Math.round(meters / 10) * 10, 'meter', 0)
    : show(meters / 1000, 'kilometer', meters < 10_000 ? 1 : 0);
}

/** The Places page has no day in context; a day's drawer can also order by fit to it. */
export const tripPlaceDaySorts = [...tripPlaceSorts, 'nearest', 'open'] as const;
export type TripPlaceDaySort = (typeof tripPlaceDaySorts)[number];

export function isDaySort(sort: TripPlaceDaySort): sort is 'nearest' | 'open' {
  return sort === 'nearest' || sort === 'open';
}

/**
 * Orders places for the day being planned. "Nearest" puts places with a known
 * distance first, closest first; "open" puts those open that day first, then
 * those with unknown hours, and closed ones last. Ties fall back to name.
 */
export function sortForDay<T>(
  places: readonly T[],
  sort: 'nearest' | 'open',
  nameFor: (place: T) => string,
  context: {
    distanceOf: (place: T) => number | null;
    hoursOf: (place: T) => PlaceHoursStatus['status'] | null;
  },
) {
  const openRank = (place: T) => {
    const status = context.hoursOf(place);
    return status === 'open' ? 0 : status === null ? 1 : 2;
  };

  return places.toSorted((left, right) => {
    const byName = nameFor(left).localeCompare(nameFor(right));
    if (sort === 'open') return openRank(left) - openRank(right) || byName;
    const a = context.distanceOf(left);
    const b = context.distanceOf(right);
    if (a === null && b === null) return byName;
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b || byName;
  });
}

export type { TripPlaceSort };
