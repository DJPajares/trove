import { recordProviderCall } from './provider-usage.js';

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';

export type TimeZonePlace = {
  latitude: number;
  longitude: number;
  /** The city the zone is named after, as the provider spells it. */
  name: string;
  timeZone: string;
};

/**
 * Where a time zone is, and what that place is called.
 *
 * Home has to answer "what is it like where you are" for a traveller who has
 * never granted location, and the only thing the browser offers unasked is its
 * own IANA zone. A zone carries a city in its name - Pacific/Auckland - so the
 * name is free; the coordinates are not, and this is where they come from.
 *
 * Open-Meteo's geocoder rather than Google's: it is the same provider family
 * the forecast already rides on, it bills nothing, and Home renders every
 * session. A Places lookup here would be a charge per visit per user, which is
 * the fan-out AGENTS.md names as the mistake that cost a development week.
 *
 * Cached for the process's life without a TTL, because the answer cannot go
 * stale: the city a zone is named after does not move, and a zone that is
 * renamed arrives as a different key.
 */
const resolved = new Map<string, TimeZonePlace | null>();

function cityFromTimeZone(timeZone: string) {
  const segment = timeZone.split('/').at(-1);
  if (!segment || segment === timeZone) return null;

  const city = segment.replaceAll('_', ' ').trim();

  return city.length ? city : null;
}

type GeocodingResult = {
  latitude?: unknown;
  longitude?: unknown;
  name?: unknown;
  timezone?: unknown;
};

export async function resolveTimeZonePlace(timeZone: string): Promise<TimeZonePlace | null> {
  const cached = resolved.get(timeZone);
  if (cached !== undefined) return cached;

  const city = cityFromTimeZone(timeZone);
  if (!city) {
    resolved.set(timeZone, null);
    return null;
  }

  const query = new URLSearchParams({ count: '10', format: 'json', name: city });
  let payload: { results?: GeocodingResult[] };

  try {
    const response = await fetch(`${GEOCODING_URL}?${query.toString()}`);
    recordProviderCall({
      endpoint: '/v1/search',
      expectedSku: 'geocoding-free',
      operation: 'search',
      provider: 'open_meteo',
      source: 'weather',
    });
    if (!response.ok) return null;
    payload = (await response.json()) as { results?: GeocodingResult[] };
  } catch {
    // A name Home cannot resolve is a strip Home does not draw. It is
    // supplementary, so it fails quiet rather than loudly.
    return null;
  }

  // The same city name exists in several countries, so prefer the hit whose own
  // zone is the one asked about - that is the city the zone is named for rather
  // than a namesake on another continent.
  const results = payload.results ?? [];
  const match =
    results.find((result) => result.timezone === timeZone) ??
    results.find((result) => typeof result.latitude === 'number');

  if (!match || typeof match.latitude !== 'number' || typeof match.longitude !== 'number') {
    resolved.set(timeZone, null);
    return null;
  }

  const place: TimeZonePlace = {
    latitude: match.latitude,
    longitude: match.longitude,
    name: typeof match.name === 'string' && match.name.trim() ? match.name.trim() : city,
    timeZone,
  };
  resolved.set(timeZone, place);

  return place;
}
