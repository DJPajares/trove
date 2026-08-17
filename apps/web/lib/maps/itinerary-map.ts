import type {
  Itinerary,
  ItineraryDay,
  ItineraryItem,
  ItineraryTripPlace,
} from '@/lib/itinerary/api';
import type { DailyBaseIds, DayStopNumbers } from '@/lib/itinerary/day-sequence';
import type { ScheduledPlaceUse } from '@/lib/itinerary/places';

export type ItineraryMapPoint = {
  /** Which end of the day a `base` point stands for. Absent on every other kind. */
  baseRole?: 'arrival' | 'both' | 'departure';
  id: string;
  itemId: string | null;
  kind: 'base' | 'considered' | 'scheduled';
  latitude: number;
  longitude: number;
  name: string;
  order: number | null;
  /** Other days this Place is already scheduled on. Only set on `considered` points. */
  otherDayNumbers?: number[];
  tripPlaceId: string;
};

export type ItineraryMapLocation = {
  latitude: number;
  longitude: number;
};

export function decodeGooglePolyline(encoded: string): ItineraryMapLocation[] {
  const path: ItineraryMapLocation[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    const coordinates: number[] = [];
    for (let coordinateIndex = 0; coordinateIndex < 2; coordinateIndex += 1) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index) - 63;
        index += 1;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index <= encoded.length);
      coordinates.push(result & 1 ? ~(result >> 1) : result >> 1);
    }

    latitude += coordinates[0] ?? 0;
    longitude += coordinates[1] ?? 0;
    path.push({ latitude: latitude / 1e5, longitude: longitude / 1e5 });
  }

  return path;
}

/**
 * Which points the viewport should frame. A trip's other Places are worth seeing
 * on the map, but they are not where the traveller is going that day — letting a
 * consideration two hundred kilometres away stretch the bounds zooms the day out
 * to nothing. Only the day's own locations decide the frame.
 *
 * A day with nothing located yet falls back to everything, so the map never opens
 * on empty space.
 */
export function viewportPoints(points: ItineraryMapPoint[]) {
  const ofTheDay = points.filter((point) => point.kind !== 'considered');
  return ofTheDay.length ? ofTheDay : points;
}

export function buildItineraryMapPoints(input: {
  itinerary: Pick<Itinerary, 'tripPlaces' | 'unscheduledItems'>;
  /** Stops the day's base already took, so item numbers continue rather than restart. */
  orderOffset?: number;
  /**
   * Where the trip's Places already sit in the plan, so a Place that is not on
   * this day can still say which day does have it. Omitted by surfaces that have
   * no cross-day story to tell.
   */
  placeUse?: Record<string, ScheduledPlaceUse>;
  resolveItemName: (item: ItineraryItem) => string;
  resolvePlaceLocation?: (tripPlace: ItineraryTripPlace) => ItineraryMapLocation | null;
  resolvePlaceName: (tripPlace: ItineraryTripPlace) => string;
  selectedDay: Pick<ItineraryDay, 'items'> | null;
  /** 1-based number of the day being planned, excluded from `otherDayNumbers`. */
  selectedDayNumber?: number;
}) {
  if (!input.selectedDay) return [];

  const resolvePlaceLocation =
    input.resolvePlaceLocation ?? ((tripPlace) => tripPlace.place.location);
  const points = new Map<string, ItineraryMapPoint>();
  input.selectedDay.items.forEach((item, index) => {
    const tripPlace = item.tripPlace;
    const location = tripPlace ? resolvePlaceLocation(tripPlace) : null;
    if (!tripPlace || !location || points.has(tripPlace.id)) return;
    points.set(tripPlace.id, {
      id: tripPlace.id,
      itemId: item.id,
      kind: 'scheduled',
      latitude: location.latitude,
      longitude: location.longitude,
      name: input.resolveItemName(item),
      order: index + 1 + (input.orderOffset ?? 0),
      tripPlaceId: tripPlace.id,
    });
  });

  input.itinerary.tripPlaces.forEach((tripPlace) => {
    const location = resolvePlaceLocation(tripPlace);
    if (!location || points.has(tripPlace.id)) return;
    const otherDayNumbers = (input.placeUse?.[tripPlace.id]?.dayNumbers ?? []).filter(
      (dayNumber) => dayNumber !== input.selectedDayNumber,
    );
    points.set(tripPlace.id, {
      id: tripPlace.id,
      itemId:
        input.itinerary.unscheduledItems.find((item) => item.tripPlace?.id === tripPlace.id)?.id ??
        null,
      kind: 'considered',
      latitude: location.latitude,
      longitude: location.longitude,
      name: input.resolvePlaceName(tripPlace),
      order: null,
      ...(otherDayNumbers.length ? { otherDayNumbers } : {}),
      tripPlaceId: tripPlace.id,
    });
  });

  return [...points.values()];
}

/**
 * The places a day starts from and returns to. The traveller sets these as
 * "Coming from" and "Returning to", and the day's first and last travel legs are
 * measured against them — so leaving them off the map hides the two locations the
 * day's shape actually depends on.
 *
 * They are stops of the day, numbered with the rest of it, and a base that is
 * already a scheduled stop needs no second marker: it is on the map, numbered,
 * where the traveller expects it.
 */
export function dailyBasePoints(input: {
  bases: DailyBaseIds;
  numbers: Pick<DayStopNumbers, 'arrival' | 'departure'>;
  resolvePlaceLocation: (tripPlace: ItineraryTripPlace) => ItineraryMapLocation | null;
  resolvePlaceName: (tripPlace: ItineraryTripPlace) => string;
  scheduledTripPlaceIds: Set<string>;
  tripPlaces: ItineraryTripPlace[];
}): ItineraryMapPoint[] {
  const { arrivalTripPlaceId: arrivalId, departureTripPlaceId: departureId } = input.bases;

  const point = (
    tripPlaceId: string,
    role: ItineraryMapPoint['baseRole'],
    order: number | null,
  ): ItineraryMapPoint | null => {
    if (input.scheduledTripPlaceIds.has(tripPlaceId)) return null;
    const tripPlace = input.tripPlaces.find((candidate) => candidate.id === tripPlaceId);
    const location = tripPlace ? input.resolvePlaceLocation(tripPlace) : null;
    if (!tripPlace || !location) return null;
    return {
      baseRole: role,
      id: `base:${role}:${tripPlace.id}`,
      itemId: null,
      kind: 'base',
      latitude: location.latitude,
      longitude: location.longitude,
      name: input.resolvePlaceName(tripPlace),
      order,
      tripPlaceId: tripPlace.id,
    } satisfies ItineraryMapPoint;
  };

  if (arrivalId && arrivalId === departureId) {
    const both = point(arrivalId, 'both', input.numbers.arrival);
    return both ? [both] : [];
  }

  return [
    arrivalId ? point(arrivalId, 'arrival', input.numbers.arrival) : null,
    departureId ? point(departureId, 'departure', input.numbers.departure) : null,
  ].filter((basePoint): basePoint is ItineraryMapPoint => basePoint !== null);
}
