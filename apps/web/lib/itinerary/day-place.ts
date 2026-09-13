/**
 * Words that mark a segment as a street rather than a settlement.
 *
 * A formatted address is not a structured field, and the segment that usually
 * holds the town sometimes holds the street instead - a Singapore address is
 * "370J Alexandra Rd, Singapore 159953", where counting from the end lands on
 * the road. Naming a day after a road would be worse than not naming it.
 */
const STREET_WORDS = new Set([
  'ave',
  'avenue',
  'blvd',
  'boulevard',
  'cres',
  'crescent',
  'dr',
  'drive',
  'hwy',
  'highway',
  'lane',
  'ln',
  'parade',
  'pl',
  'place',
  'rd',
  'road',
  'st',
  'street',
  'terrace',
  'way',
]);

/**
 * The town in a formatted address, or null when it cannot be read safely.
 *
 * Providers hand back one string, not a structured locality, so this reads the
 * segment before the country and strips the postcode off it - which is where a
 * town sits in the addresses Trove caches, whether or not a suburb is present.
 *
 * Every doubt resolves to null. A segment that is a street, a house number, a
 * bare postcode or a single letter is rejected rather than guessed at, because
 * the caller uses this to name a day and a wrong name is worse than a date.
 */
export function localityFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;

  const segments = address
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);
  // Two segments is a town and a country, or a street and a town - there is no
  // way to tell which, so it is left alone.
  if (segments.length < 3) return null;

  const candidate = segments.at(-2);
  if (!candidate) return null;

  // The postcode rides with the town in most countries and leads it in a few.
  const withoutPostcode = candidate
    .replace(/\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d?[A-Z]{0,2}\b/g, ' ')
    .replace(/\b\d{3,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (withoutPostcode.length < 2) return null;
  // A leading number is a building, not a town.
  if (/^\d/.test(withoutPostcode)) return null;

  const words = withoutPostcode.toLowerCase().split(' ');
  if (words.some((word) => STREET_WORDS.has(word))) return null;

  return withoutPostcode;
}

/**
 * Where a day happens, when its stops agree enough to say.
 *
 * The town most of the day is spent in, ties going to the one it starts in. A
 * day has to have at least two stops in the same place before it is called
 * anything - one stop is a visit, not a day somewhere - and a day whose stops
 * scatter is left unnamed rather than filed under whichever came first.
 */
export function dayLocality(addresses: readonly (string | null | undefined)[]): string | null {
  const localities = addresses
    .map((address) => localityFromAddress(address))
    .filter((locality): locality is string => locality !== null);
  if (localities.length < 2) return null;

  const counts = new Map<string, number>();
  for (const locality of localities) {
    counts.set(locality, (counts.get(locality) ?? 0) + 1);
  }

  let best: string | null = null;
  let bestCount = 0;
  // `localities` is in the day's own order, so the first to reach a count is
  // the earliest - which is what breaks a tie.
  for (const locality of localities) {
    const count = counts.get(locality) ?? 0;
    if (count > bestCount) {
      best = locality;
      bestCount = count;
    }
  }

  return bestCount >= 2 ? best : null;
}
