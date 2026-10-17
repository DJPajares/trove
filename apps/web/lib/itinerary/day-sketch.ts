import { decodePolyline } from '@/lib/maps/polyline';
import {
  routeSketch,
  sketchProjection,
  type RouteSketchBox,
  type SketchPoint,
} from '@/lib/maps/route-sketch';

import type { ItineraryRouteSegment, ItineraryTripPlace } from './api';
import type { DayTimelineEntry } from './day-sequence';

export type DaySketchPlace = {
  /**
   * The leg that arrives here from the place just before it in the day - or
   * null when that one has no leg, or undefined when the day's legs are not
   * known at all (the whole trip's view, or while they are still on their way).
   */
  incoming?: ItineraryRouteSegment | null;
  /** Stable within the day: a Stay end, or the stop's own item. */
  key: string;
  kind: 'stay' | 'stop';
  latitude: number;
  longitude: number;
  /** The same number the list and the map give this stop. */
  number: number;
  /** The place just before this one in the day, located or not. */
  previousKey: string | null;
};

/**
 * Where a day goes, in the order it is travelled: the Stay it starts from, each
 * stop with a location, and the Stay it ends at - read off the same sequence
 * the list and the map are built from, so the sketch can never draw a different
 * day from the one beside it. Stops with nowhere to be are left out rather
 * than guessed at, and a day that starts and ends at one Stay closes its loop.
 */
export function daySketchPlaces(
  entries: readonly DayTimelineEntry[],
  tripPlaces: readonly ItineraryTripPlace[],
): DaySketchPlace[] {
  const places: DaySketchPlace[] = [];
  const routed = entries.some((entry) => entry.kind === 'leg');
  let incoming: ItineraryRouteSegment | null = null;
  let previousKey: string | null = null;

  for (const entry of entries) {
    if (entry.kind === 'leg') {
      incoming = entry.segment;
      continue;
    }

    const key = entry.kind === 'base' ? `stay-${entry.role}` : entry.item.id;
    const location =
      entry.kind === 'base'
        ? tripPlaces.find((tripPlace) => tripPlace.id === entry.tripPlaceId)?.place.location
        : entry.item.tripPlace?.place.location;
    if (location) {
      places.push({
        incoming: routed ? incoming : undefined,
        key,
        kind: entry.kind === 'base' ? 'stay' : 'stop',
        latitude: location.latitude,
        longitude: location.longitude,
        number: entry.stopNumber,
        previousKey,
      });
    }
    incoming = null;
    previousKey = key;
  }

  return places;
}

/**
 * How one leg of the day is drawn: along the road when the day's legs already
 * carry its geometry, straight when the leg is measured but its road is not on
 * hand, and as a faint dotted guess when nothing measured it - a stop without
 * a location between, a leg that could not be routed, or a long-distance hop.
 */
export type DaySketchLeg = {
  key: string;
  path: string;
  style: 'road' | 'straight' | 'unknown';
  /** Leaves or returns to the Stay: dashed, as the timeline draws it. */
  stay: boolean;
};

export type DayRouteDrawing = {
  height: number;
  /** One line per leg, or a single smoothed line when the legs are not known. */
  legs: DaySketchLeg[];
  /** One per place, in the same order. */
  points: Array<{ x: number; y: number }>;
  width: number;
};

/** A road's shape survives this many points; more is detail the box cannot show. */
const ROAD_POINTS = 24;

function thin(points: readonly SketchPoint[]) {
  if (points.length <= ROAD_POINTS) return points;
  const step = (points.length - 1) / (ROAD_POINTS - 1);
  return Array.from({ length: ROAD_POINTS }, (_, index) => points[Math.round(index * step)]!);
}

/**
 * The day drawn into a box from what Trove already holds. It never asks a
 * provider for anything: a leg's road is used only when the day's legs were
 * already fetched with it - when the map has been opened - and otherwise the
 * drawing joins the stops directly. A day whose legs are not known is one
 * smoothed line through its stops, as before. Null when fewer than two
 * distinct places are located, or they are too close together to make a shape.
 */
export function dayRouteDrawing(
  places: readonly DaySketchPlace[],
  box: RouteSketchBox,
): DayRouteDrawing | null {
  if (places.every((place) => place.incoming === undefined)) {
    const sketch = routeSketch(places, box, { minDistinct: 2 });
    return sketch
      ? {
          height: sketch.height,
          legs: [{ key: 'shape', path: sketch.path, stay: false, style: 'straight' }],
          points: sketch.points,
          width: sketch.width,
        }
      : null;
  }

  const distinct = new Set(
    places.map((place) => `${place.latitude.toFixed(5)},${place.longitude.toFixed(5)}`),
  );
  if (distinct.size < 2) return null;

  const legs = places.slice(1).map((place, index) => {
    const from = places[index]!;
    // A leg belongs to this pair only when nothing unlocated came between them.
    const segment = place.previousKey === from.key ? place.incoming : null;
    const known = segment?.status === 'ok' && segment.scope === 'local';
    const road =
      known && segment.encodedPolyline ? thin(decodePolyline(segment.encodedPolyline)) : [];
    return {
      from,
      place,
      road,
      style: known ? (road.length > 1 ? 'road' : 'straight') : 'unknown',
    };
  });

  const project = sketchProjection([...places, ...legs.flatMap((leg) => leg.road)], box);
  if (!project) return null;
  const points = places.map(project);

  return {
    height: box.height,
    legs: legs.map(({ from, place, road, style }) => {
      const line = [project(from), ...road.map(project), project(place)];
      return {
        key: `${from.key}-${place.key}`,
        path: line.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`).join(' '),
        stay: from.kind === 'stay' || place.kind === 'stay',
        style: style as DaySketchLeg['style'],
      };
    }),
    points,
    width: box.width,
  };
}
