import { find as findTimeZones } from 'geo-tz';

import type { PlaceCoordinates } from './places.js';
import { isValidIanaTimeZone } from './trip-rules.js';

// geo-tz caches boundary fragments. Cache the small final answer too, because
// one Place can appear in several items, a day base, and a reservation at once.
const coordinateTimeZones = new Map<string, string | null>();
const MAX_COORDINATE_TIME_ZONES = 1_000;

export function timeZoneAtCoordinates(coordinates: PlaceCoordinates): string | null {
  const { latitude, longitude } = coordinates;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  )
    return null;

  const key = `${latitude},${longitude}`;
  if (coordinateTimeZones.has(key)) return coordinateTimeZones.get(key) ?? null;
  let zone: string | null = null;
  try {
    // A boundary or a locally disputed clock can produce several answers.
    // That is not enough evidence to silently pick one for a timed booking.
    const matches = findTimeZones(latitude, longitude);
    if (matches.length === 1 && isValidIanaTimeZone(matches[0]!)) zone = matches[0]!;
  } catch {
    // Missing boundary data or an unresolvable coordinate leaves the existing
    // day/trip fallback in place rather than failing an itinerary write.
  }
  if (coordinateTimeZones.size >= MAX_COORDINATE_TIME_ZONES) {
    const oldest = coordinateTimeZones.keys().next();
    if (!oldest.done) coordinateTimeZones.delete(oldest.value);
  }
  coordinateTimeZones.set(key, zone);
  return zone;
}
