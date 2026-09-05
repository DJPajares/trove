import type { DistanceUnit } from '@/lib/profile/preferences';

const METRES_PER_MILE = 1609.344;
const METRES_PER_KILOMETRE = 1000;
const METRES_PER_FOOT = 0.3048;
/** Below this a large unit rounds the whole distance away, so the small one wins. */
const SHORT_LEG_METRES = METRES_PER_KILOMETRE;
const SHORT_LEG_MILES = 0.1;

/**
 * A distance as a bare number in the traveller's own unit.
 *
 * The unit word is deliberately not part of this: every caller already has a
 * translated unit label to pair it with, and returning a joined string here
 * would put a second, untranslated copy of that word in the codebase.
 *
 * Under ten, one decimal - the difference between 1.2 km and 1 km is the
 * difference between two streets. Above it, whole units; nobody walks 12.4 km
 * differently to 12 km.
 */
export function formatDistanceValue(meters: number, distanceUnit: DistanceUnit, locale: string) {
  const value = meters / (distanceUnit === 'mi' ? METRES_PER_MILE : METRES_PER_KILOMETRE);

  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
}

export type EstimatedDistanceUnit = 'ft' | 'km' | 'm' | 'mi';

/**
 * A straight-line estimate, in whichever unit still says something.
 *
 * Two stops in the same courtyard are a few metres apart, and "0 km" is a
 * worse answer than none at all - so below a kilometre the estimate drops to
 * the smaller unit. It rounds to the nearest ten there: a distance measured as
 * the crow flies has no business claiming single metres.
 */
export function formatEstimatedDistance(
  meters: number,
  distanceUnit: DistanceUnit,
  locale: string,
): { unit: EstimatedDistanceUnit; value: string } {
  const whole = (value: number, unit: EstimatedDistanceUnit) => ({
    unit,
    value: new Intl.NumberFormat(locale).format(Math.round(value / 10) * 10),
  });

  if (distanceUnit === 'mi') {
    if (meters / METRES_PER_MILE < SHORT_LEG_MILES) return whole(meters / METRES_PER_FOOT, 'ft');
  } else if (meters < SHORT_LEG_METRES) {
    return whole(meters, 'm');
  }

  return { unit: distanceUnit, value: formatDistanceValue(meters, distanceUnit, locale) };
}
