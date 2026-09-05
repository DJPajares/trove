import { resolveDailyBases } from '@/lib/itinerary/day-sequence';

import type {
  ItineraryDay,
  ItineraryItem,
  ItineraryTripPlace,
  TripModeLeg,
  TripModeLegEndpoint,
} from '@/lib/itinerary/api';

type PlaceLike = ItineraryTripPlace['place'];

function coordinate(place: PlaceLike) {
  return place.location
    ? { latitude: place.location.latitude, longitude: place.location.longitude }
    : null;
}

/** The same name chain the day's list reads, so a stop keeps its name here. */
function placeName(place: PlaceLike) {
  return place.name ?? place.snapshot?.name ?? place.providerLabel ?? null;
}

/**
 * A snapshot written before travel modes existed carries none, and the server
 * lands on the same answer for anything it cannot read: driving is the mode a
 * leg has when nobody has said otherwise.
 */
function legMode(item: ItineraryItem) {
  return item.travelModeToNext ?? 'drive';
}

/** The server's own rule: a place to itself is a standstill, not a leg. */
function sameLocation(origin: TripModeLegEndpoint, destination: TripModeLegEndpoint) {
  if (!origin.coordinate || !destination.coordinate) return false;

  return (
    origin.coordinate.latitude === destination.coordinate.latitude &&
    origin.coordinate.longitude === destination.coordinate.longitude
  );
}

function itemEndpoint(item: ItineraryItem): TripModeLegEndpoint | null {
  if (!item.tripPlace) {
    return item.customLabel
      ? { coordinate: null, id: item.id, kind: 'itinerary_item', name: item.customLabel }
      : null;
  }

  return {
    coordinate: coordinate(item.tripPlace.place),
    id: item.id,
    kind: 'itinerary_item',
    name: item.customLabel ?? item.tripPlace.customName ?? placeName(item.tripPlace.place),
  };
}

function baseEndpoint(tripPlace: ItineraryTripPlace | undefined): TripModeLegEndpoint | null {
  if (!tripPlace) return null;

  return {
    coordinate: coordinate(tripPlace.place),
    id: tripPlace.id,
    kind: 'daily_base',
    name: tripPlace.customName ?? placeName(tripPlace.place),
  };
}

/**
 * The leg the traveller is on, worked out from what is already on the device.
 *
 * The server answers this too; this is the offline copy, and it has to agree
 * with that one. Both walk the day in position order rather than from the
 * current-item selection, because that is the order the route planner builds
 * and the order `travelModeToNext` describes - the mode belongs to the stop a
 * leg leaves, not the one it reaches.
 */
export function resolveOfflineTripModeLeg(input: {
  day: ItineraryDay | null;
  nextItemId: string | null;
  tripPlaces: readonly ItineraryTripPlace[];
}): TripModeLeg | null {
  const { day, nextItemId, tripPlaces } = input;
  if (!day) return null;

  const bases = resolveDailyBases({ day });
  const byId = (id: string | null) =>
    id ? tripPlaces.find((candidate) => candidate.id === id) : undefined;

  if (nextItemId) {
    const index = day.items.findIndex((item) => item.id === nextItemId);
    if (index < 0) return null;

    const next = day.items[index];
    if (!next) return null;
    const destination = itemEndpoint(next);
    if (!destination) return null;

    const previous = index > 0 ? day.items[index - 1] : undefined;
    // Before the day's first stop the traveller is still where they slept.
    const origin = previous ? itemEndpoint(previous) : baseEndpoint(byId(bases.arrivalTripPlaceId));
    if (!origin) return null;

    if (sameLocation(origin, destination)) return null;

    return {
      destination,
      mode: previous ? legMode(previous) : day.routeStartTravelMode,
      origin,
    };
  }

  const last = day.items.at(-1);
  if (!last) return null;
  const destination = baseEndpoint(byId(bases.departureTripPlaceId));
  const origin = itemEndpoint(last);
  if (!destination || !origin || sameLocation(origin, destination)) return null;

  return { destination, mode: legMode(last), origin };
}
