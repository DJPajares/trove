import type { DistanceUnit } from '@/lib/profile/preferences';

const METRES_PER_MILE = 1609.344;
const METRES_PER_KILOMETRE = 1000;

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
