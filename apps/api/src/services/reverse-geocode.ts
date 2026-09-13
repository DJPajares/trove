import { recordProviderCall } from './provider-usage.js';

const REVERSE_GEOCODE_URL = 'https://api.bigdatacloud.net/data/reverse-geocode-client';

/**
 * Roughly a kilometre, which is the grain a city name is true at.
 *
 * Two decimal places, the same rounding the weather snapshot uses, so walking
 * across a town reuses one answer instead of asking again at every corner.
 */
const COORDINATE_PRECISION = 100;

/**
 * How long a name is held. A city does not move, but a traveller does, and a
 * cache with no ceiling would keep a process's memory growing for the life of
 * the server.
 */
const MAX_ENTRIES = 500;

const resolved = new Map<string, string | null>();

function cacheKey(latitude: number, longitude: number) {
  const round = (value: number) => Math.round(value * COORDINATE_PRECISION) / COORDINATE_PRECISION;

  return `${round(latitude)}:${round(longitude)}`;
}

type ReverseGeocodeResponse = {
  city?: unknown;
  locality?: unknown;
  principalSubdivision?: unknown;
};

function firstName(payload: ReverseGeocodeResponse) {
  // `city` first, and the order matters: `locality` is finer than a city and in
  // a large one it is the neighbourhood. Checked against the provider - Auckland
  // answers `locality: "Waitemata"`, Boston `"Downtown Boston"`, Kyoto
  // `"Nakagyo Ku"` - none of which is what a traveller would say when asked
  // where they are. `city` is right in every one of those, and the two agree in
  // a town small enough not to have boroughs.
  //
  // `locality` still stands in where there is no city at all, which is most of
  // the countryside, and the region is the last thing worth saying: better
  // "Northland" than nothing.
  for (const value of [payload.city, payload.locality, payload.principalSubdivision]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  return null;
}

/**
 * What the place at these coordinates is called.
 *
 * The missing half of Trove's geocoding. The forecast has always known exactly
 * where a traveller is standing, because the device hands over coordinates -
 * but the only name available was the one in their IANA time zone, so everyone
 * in New Zealand read "Auckland" and everyone near Boston read "New York". A
 * zone is a region, not a place.
 *
 * BigDataCloud rather than Google: it answers this one question, it needs no
 * key, it bills nothing, and Home renders every session. A Places lookup here
 * would be a charge per visit per user, which is the fan-out AGENTS.md names as
 * the mistake that cost a development week. It is counted through the provider
 * ledger anyway, the way the other free providers are, so a regression that
 * turns this into a fan-out is caught by a test rather than by a bill.
 *
 * Fails quiet and returns null. The label is supplementary, and PRD 21.1 forbids
 * fabricating a current physical location - so a name Trove cannot vouch for is
 * no name at all, never the zone's city standing in for it.
 */
export async function resolvePlaceName(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  const key = cacheKey(latitude, longitude);
  const cached = resolved.get(key);
  if (cached !== undefined) return cached;

  const query = new URLSearchParams({
    latitude: String(latitude),
    localityLanguage: 'en',
    longitude: String(longitude),
  });

  try {
    const response = await fetch(`${REVERSE_GEOCODE_URL}?${query.toString()}`, {
      signal: AbortSignal.timeout(4_000),
    });
    recordProviderCall({
      endpoint: '/data/reverse-geocode-client',
      expectedSku: 'reverse-geocoding-free',
      operation: 'search',
      provider: 'big_data_cloud',
      source: 'weather',
    });
    if (!response.ok) return null;

    const name = firstName((await response.json()) as ReverseGeocodeResponse);
    if (resolved.size >= MAX_ENTRIES) resolved.clear();
    resolved.set(key, name);

    return name;
  } catch {
    // A name that did not arrive is not cached: the next request should be free
    // to try again rather than inherit a network blip for the process's life.
    return null;
  }
}
