/**
 * The city an IANA time zone is named after.
 *
 * `Pacific/Auckland` is Auckland, `America/New_York` is New York, and
 * `America/Argentina/Buenos_Aires` is Buenos Aires - the last segment, with its
 * underscores read as the spaces they stand in for.
 *
 * This is an approximation and worth naming as one: a zone is a region, not a
 * place, so someone in Hamilton reads "Auckland" and someone in Boston reads
 * "New York". It is the only city name available anywhere in Trove without a
 * billable reverse geocode on a screen that renders every session, which is the
 * fan-out AGENTS.md names as the mistake that cost $300. A traveller who wants
 * the exact city has the trip's own weather for that.
 *
 * Returns null for a zone with no city in it - `UTC`, or a bare `GMT` - because
 * those name no place at all.
 */
export function cityFromTimeZone(timeZone: string | undefined): string | null {
  if (!timeZone) return null;

  const segment = timeZone.split('/').at(-1);
  if (!segment || segment === timeZone) return null;

  const city = segment.replaceAll('_', ' ').trim();

  return city.length ? city : null;
}
