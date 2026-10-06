import type {
  Itinerary,
  ItineraryDay,
  ItineraryItem,
  ItineraryRouteSegment,
  ItineraryTripPlace,
} from '@/lib/itinerary/api';
import {
  type DailyBaseIds,
  type DayStopNumbers,
  dayStopNumbers,
  resolveDailyBases,
} from '@/lib/itinerary/day-sequence';
import type { ScheduledPlaceUse } from '@/lib/itinerary/places';

export type ItineraryMapPoint = {
  /** Which end of the day a `base` point stands for. Absent on every other kind. */
  baseRole?: 'arrival' | 'both' | 'departure';
  /**
   * The 0-based day a `scheduled` point is tinted for. Only the whole-trip map
   * sets it; a single day's map has one day and needs no colour to say which.
   */
  dayIndex?: number;
  /** Every 1-based day this Place is on. Only the whole-trip map sets it. */
  dayNumbers?: number[];
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

type TripMapDay = Pick<
  ItineraryDay,
  | 'dailyBaseDepartureTripPlaceId'
  | 'dailyBaseTripPlaceId'
  | 'defaultTimeZoneSource'
  | 'defaultTimeZoneSourceTripPlaceId'
  | 'id'
  | 'items'
>;

export type TripMapPoints = {
  /** The day the map shows, or null for the whole trip. Only a located day can be shown. */
  focusDayId: string | null;
  /** Days with something to put on the map: the only ones worth focusing on. */
  locatedDayIds: Set<string>;
  points: ItineraryMapPoint[];
  /**
   * Stops that name a location the map cannot draw: a Custom Place with no
   * coordinates, or a location typed in as text. A plain label such as "Free
   * afternoon" names no location, so it is not missing one.
   */
  unlocatedStopCount: number;
};

/**
 * The whole trip on one map.
 *
 * A stop keeps the number it has on its own day, worked out by the same
 * function from the same inputs as the Day view, and takes its day's colour so
 * the days can be told apart. A Place on several days is one marker, on the
 * first of them, that knows all of them.
 *
 * A stay is one marker however many nights it covers, and none at all when the
 * same Place is already a stop. A booked stay is learnt from a day's legs, as
 * the Day view learns it; a day whose legs are not in hand falls back to the
 * accommodation its time zone comes from, as Trip Mode does, so the stay still
 * shows without asking anyone for a route.
 *
 * The trip's other Places are shown too, quietly, and never frame the view.
 * Focusing on a day narrows the map to that day's own stops and stay, numbered
 * exactly as its timeline numbers them.
 */
export function buildTripMapPoints(input: {
  days: TripMapDay[];
  focusDayId: string | null;
  resolveItemName: (item: ItineraryItem) => string;
  resolvePlaceLocation: (tripPlace: ItineraryTripPlace) => ItineraryMapLocation | null;
  resolvePlaceName: (tripPlace: ItineraryTripPlace) => string;
  /** Legs already in hand, by day. Only read, never asked for. */
  routeSegmentsByDayId?: Readonly<Record<string, ItineraryRouteSegment[] | undefined>>;
  tripPlaces: ItineraryTripPlace[];
}): TripMapPoints {
  const tripPlaceById = new Map(input.tripPlaces.map((tripPlace) => [tripPlace.id, tripPlace]));
  const located = (tripPlaceId: string | null) => {
    const tripPlace = tripPlaceId ? tripPlaceById.get(tripPlaceId) : undefined;
    const location = tripPlace ? input.resolvePlaceLocation(tripPlace) : null;
    return tripPlace && location ? { location, tripPlace } : null;
  };

  const readings = input.days.map((day, dayIndex) => {
    const bases = resolveDailyBases({ day, routeSegments: input.routeSegmentsByDayId?.[day.id] });
    const numbers = dayStopNumbers({ bases, itemCount: day.items.length });
    const stops = new Map<string, ItineraryMapPoint>();
    let unlocated = 0;
    day.items.forEach((item, index) => {
      const tripPlace = item.tripPlace;
      const location = tripPlace ? input.resolvePlaceLocation(tripPlace) : null;
      if (!tripPlace || !location) {
        if (tripPlace || item.customLocation) unlocated += 1;
        return;
      }
      if (stops.has(tripPlace.id)) return;
      stops.set(tripPlace.id, {
        dayIndex,
        id: tripPlace.id,
        itemId: item.id,
        kind: 'scheduled',
        latitude: location.latitude,
        longitude: location.longitude,
        name: input.resolveItemName(item),
        order: index + 1 + numbers.itemOffset,
        tripPlaceId: tripPlace.id,
      });
    });
    const accommodationId =
      day.defaultTimeZoneSource === 'accommodation' ? day.defaultTimeZoneSourceTripPlaceId : null;
    const fallbackStayId =
      !bases.arrivalTripPlaceId && !bases.departureTripPlaceId ? accommodationId : null;
    const stayIds = [
      ...new Set(
        [bases.arrivalTripPlaceId, bases.departureTripPlaceId, fallbackStayId].filter(
          (id): id is string => Boolean(id && located(id)),
        ),
      ),
    ];
    return { bases, day, dayIndex, fallbackStayId, numbers, stayIds, stops, unlocated };
  });

  const dayNumbersByPlace = new Map<string, number[]>();
  const noteDay = (tripPlaceId: string, dayNumber: number) => {
    const numbers = dayNumbersByPlace.get(tripPlaceId) ?? [];
    if (!numbers.includes(dayNumber)) numbers.push(dayNumber);
    dayNumbersByPlace.set(tripPlaceId, numbers);
  };
  readings.forEach((reading) => {
    reading.stops.forEach((_, tripPlaceId) => noteDay(tripPlaceId, reading.dayIndex + 1));
    reading.stayIds.forEach((tripPlaceId) => noteDay(tripPlaceId, reading.dayIndex + 1));
  });

  const locatedDayIds = new Set(
    readings
      .filter((reading) => reading.stops.size > 0 || reading.stayIds.length > 0)
      .map((reading) => reading.day.id),
  );
  const focus =
    input.focusDayId && locatedDayIds.has(input.focusDayId)
      ? readings.find((reading) => reading.day.id === input.focusDayId)
      : undefined;

  const stayPoint = (tripPlaceId: string): ItineraryMapPoint | null => {
    const found = located(tripPlaceId);
    if (!found) return null;
    return {
      dayNumbers: dayNumbersByPlace.get(tripPlaceId) ?? [],
      id: `stay:${tripPlaceId}`,
      itemId: null,
      kind: 'base',
      latitude: found.location.latitude,
      longitude: found.location.longitude,
      name: input.resolvePlaceName(found.tripPlace),
      order: null,
      tripPlaceId,
    };
  };

  if (focus) {
    const stops = [...focus.stops.values()].map((point) => ({
      ...point,
      dayNumbers: dayNumbersByPlace.get(point.tripPlaceId) ?? [],
    }));
    const scheduledTripPlaceIds = new Set(focus.stops.keys());
    const bases = dailyBasePoints({
      bases: focus.bases,
      numbers: focus.numbers,
      resolvePlaceLocation: input.resolvePlaceLocation,
      resolvePlaceName: input.resolvePlaceName,
      scheduledTripPlaceIds,
      tripPlaces: input.tripPlaces,
    });
    // An inferred stay is not part of the day's numbering until its legs say
    // so, so it is drawn the way a stay is drawn across the whole trip.
    const fallback =
      focus.fallbackStayId && !scheduledTripPlaceIds.has(focus.fallbackStayId)
        ? stayPoint(focus.fallbackStayId)
        : null;
    return {
      focusDayId: focus.day.id,
      locatedDayIds,
      points: [...stops, ...bases, ...(fallback ? [fallback] : [])],
      unlocatedStopCount: focus.unlocated,
    };
  }

  const points = new Map<string, ItineraryMapPoint>();
  readings.forEach((reading) => {
    reading.stops.forEach((point, tripPlaceId) => {
      if (points.has(tripPlaceId)) return;
      points.set(tripPlaceId, { ...point, dayNumbers: dayNumbersByPlace.get(tripPlaceId) ?? [] });
    });
  });
  const stays = new Map<string, ItineraryMapPoint>();
  readings.forEach((reading) => {
    reading.stayIds.forEach((tripPlaceId) => {
      if (points.has(tripPlaceId) || stays.has(tripPlaceId)) return;
      const point = stayPoint(tripPlaceId);
      if (point) stays.set(tripPlaceId, point);
    });
  });
  const considered = input.tripPlaces.flatMap((tripPlace): ItineraryMapPoint[] => {
    const location = input.resolvePlaceLocation(tripPlace);
    if (!location || points.has(tripPlace.id) || stays.has(tripPlace.id)) return [];
    return [
      {
        id: tripPlace.id,
        itemId: null,
        kind: 'considered',
        latitude: location.latitude,
        longitude: location.longitude,
        name: input.resolvePlaceName(tripPlace),
        order: null,
        tripPlaceId: tripPlace.id,
      },
    ];
  });

  return {
    focusDayId: null,
    locatedDayIds,
    points: [...points.values(), ...stays.values(), ...considered],
    unlocatedStopCount: readings.reduce((total, reading) => total + reading.unlocated, 0),
  };
}
