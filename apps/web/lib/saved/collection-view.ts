import { haversineMeters, type Coordinate } from '@/lib/maps/haversine';
import { DESTINATION_REACH_KM } from '@/lib/trip-places/saved-near-trip';

/**
 * How the Saved collection relates to trips and to time, read from what Trove
 * already holds. Pure, so the page and its tests agree, and nothing here asks
 * a provider for anything.
 */

type TripLike = {
  destinations: readonly { location?: Coordinate | null; name: string }[];
  endDate: string;
  id: string;
  lifecycle: 'active' | 'completed' | 'planning';
  startDate: string;
};

/** A trip still worth planning for: not finished, and not already over. */
function isAhead(trip: TripLike, today: string) {
  return trip.lifecycle !== 'completed' && trip.endDate >= today;
}

/**
 * The trip saved places can help next: the soonest one still ahead with a
 * destination Trove can place, since "near the trip" needs somewhere to measure.
 */
export function nextTripForSaved<T extends TripLike>(trips: readonly T[], today: string): T | null {
  return (
    trips
      .filter(
        (trip) =>
          isAhead(trip, today) && trip.destinations.some((destination) => destination.location),
      )
      .toSorted((left, right) => left.startDate.localeCompare(right.startDate))[0] ?? null
  );
}

/**
 * The trips a saved place could join, nearest first: a trip with a destination
 * within reach of the place leads, then the rest by date. A place with no
 * stored location cannot be near anything, so every trip is simply by date.
 */
export function tripsForSavedPlace<T extends TripLike>(
  location: Coordinate | null | undefined,
  trips: readonly T[],
  today: string,
): { near: boolean; trip: T }[] {
  return trips
    .filter((trip) => isAhead(trip, today))
    .map((trip) => ({
      near: Boolean(
        location &&
        trip.destinations.some(
          (destination) =>
            destination.location &&
            haversineMeters(location, destination.location) <= DESTINATION_REACH_KM * 1000,
        ),
      ),
      trip,
    }))
    .toSorted(
      (left, right) =>
        Number(right.near) - Number(left.near) ||
        left.trip.startDate.localeCompare(right.trip.startDate),
    );
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * One place saved long ago, brought back so a large collection does not bury
 * it: the oldest saved at least a year ago that the traveller has not already
 * said to keep. One at a time, so it reads as a question rather than a chore.
 */
export function rediscoverSaved<T extends { createdAt: string; id: string }>(
  saved: readonly T[],
  now: number,
  kept: ReadonlySet<string>,
): T | null {
  return (
    saved
      .filter((entry) => !kept.has(entry.id) && now - Date.parse(entry.createdAt) >= YEAR_MS)
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))[0] ?? null
  );
}

type CoverCandidate = {
  collections: readonly { id: string }[];
  createdAt: string;
  place: { kind: 'custom' | 'provider' };
};

/** A cover holds one lead photo and at most two beside it. */
const COVER_TILES = 3;

/**
 * The places a collection's cover is made of. Only a provider place can carry
 * a photograph, so the cover is drawn from those, newest first - up to three.
 * A collection of personal places alone shows one of them as its tile rather
 * than a row of placeholders standing in for photos that do not exist.
 */
export function collectionCoverTiles<T extends CoverCandidate>(
  collectionId: string,
  savedPlaces: readonly T[],
): T[] {
  const members = savedPlaces
    .filter((savedPlace) => savedPlace.collections.some((item) => item.id === collectionId))
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  const photographic = members.filter((member) => member.place.kind === 'provider');
  return photographic.length ? photographic.slice(0, COVER_TILES) : members.slice(0, 1);
}

/**
 * The order cover photos are asked for: every cover's lead before any cover's
 * second, so a capped request never leaves one collection without a photo
 * while another fills its small tiles. A place in two collections is asked for
 * once.
 */
export function coverRequestOrder<T>(covers: readonly (readonly T[])[]): T[] {
  const ordered = new Set<T>();
  const deepest = Math.max(0, ...covers.map((tiles) => tiles.length));
  for (let index = 0; index < deepest; index += 1) {
    for (const tiles of covers) {
      const tile = tiles[index];
      if (tile !== undefined) ordered.add(tile);
    }
  }
  return [...ordered];
}
