import type { Itinerary } from '@/lib/itinerary/api';

import type { Memory } from './api';

/**
 * "The route, drawn": an ink line through the places Memories were kept at, in
 * the order they were kept. It is drawn from coordinates Trove already holds -
 * no map, no tiles, no provider request - and it is decoration, so it says
 * nothing a reader needs and appears only when there is a shape worth drawing.
 */

export type SketchPoint = { latitude: number; longitude: number };

export type RouteSketch = {
  height: number;
  /** An SVG path through every point, smoothed through the midpoints between them. */
  path: string;
  points: Array<{ x: number; y: number }>;
  width: number;
};

/** Fewer places than this is a line, not a route. */
const MIN_PLACES = 3;
/** About 200 metres. A smaller spread would draw a scribble, not a journey. */
const MIN_SPAN_DEGREES = 0.002;

/**
 * Where each Memory was kept, in the order given, for Memories at a Place with
 * coordinates. A Memory carries its Trip Place but not where that is, so the
 * coordinates come from the itinerary's Trip Places, which the journal has
 * already loaded. Staying put between Memories adds no new point.
 */
export function locatedMemoryPlaces(
  memories: readonly Memory[],
  tripPlaces: Itinerary['tripPlaces'],
): SketchPoint[] {
  const locations = new Map(
    tripPlaces.flatMap((tripPlace) =>
      tripPlace.place.location ? [[tripPlace.id, tripPlace.place.location] as const] : [],
    ),
  );
  const points: SketchPoint[] = [];
  let previousId: string | null = null;

  for (const memory of memories) {
    const id = memory.tripPlace?.id ?? null;
    if (!id || id === previousId) continue;
    const location = locations.get(id);
    if (!location) continue;
    previousId = id;
    points.push({ latitude: location.latitude, longitude: location.longitude });
  }

  return points;
}

/**
 * Longitudes made continuous, so a route across the antimeridian is drawn as
 * the short hop it was rather than the long way round the world.
 */
function unwrapLongitudes(points: readonly SketchPoint[]) {
  const longitudes: number[] = [];
  for (const point of points) {
    const previous = longitudes.at(-1);
    let longitude = point.longitude;
    if (previous !== undefined) {
      while (longitude - previous > 180) longitude -= 360;
      while (longitude - previous < -180) longitude += 360;
    }
    longitudes.push(longitude);
  }
  return longitudes;
}

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * Fits the places into a box, north up, with distances kept true to each other
 * at the trip's latitude, and returns the line and its points. Null when the
 * places are too few or too close together to make a shape.
 */
export function routeSketch(
  places: readonly SketchPoint[],
  box: Readonly<{ height: number; padding: number; width: number }>,
): RouteSketch | null {
  const distinct = new Set(
    places.map((place) => `${place.latitude.toFixed(5)},${place.longitude.toFixed(5)}`),
  );
  if (distinct.size < MIN_PLACES) return null;

  const longitudes = unwrapLongitudes(places);
  const latitudes = places.map((place) => place.latitude);
  const meanLatitude = latitudes.reduce((total, value) => total + value, 0) / latitudes.length;
  const squeeze = Math.max(0.05, Math.cos((meanLatitude * Math.PI) / 180));

  const minX = Math.min(...longitudes) * squeeze;
  const maxX = Math.max(...longitudes) * squeeze;
  const minY = Math.min(...latitudes);
  const maxY = Math.max(...latitudes);
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (Math.max(spanX, spanY) < MIN_SPAN_DEGREES) return null;

  const innerWidth = box.width - box.padding * 2;
  const innerHeight = box.height - box.padding * 2;
  const scale = Math.min(
    spanX > 0 ? innerWidth / spanX : Number.POSITIVE_INFINITY,
    spanY > 0 ? innerHeight / spanY : Number.POSITIVE_INFINITY,
  );
  // Centred in the box along whichever axis has room to spare.
  const offsetX = box.padding + (innerWidth - spanX * scale) / 2;
  const offsetY = box.padding + (innerHeight - spanY * scale) / 2;

  const points = places.map((place, index) => ({
    x: round(offsetX + ((longitudes[index] ?? place.longitude) * squeeze - minX) * scale),
    y: round(offsetY + (maxY - place.latitude) * scale),
  }));

  return { height: box.height, path: smoothPath(points), points, width: box.width };
}

/**
 * A line through every point that bends through each one rather than kinking
 * at it: straight to the first midpoint, a curve around every point in between
 * with the midpoints as its ends, and straight in to the last.
 */
function smoothPath(points: ReadonlyArray<{ x: number; y: number }>) {
  const first = points[0];
  if (!first) return '';

  const midpoint = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    `${round((a.x + b.x) / 2)} ${round((a.y + b.y) / 2)}`;

  let path = `M${first.x} ${first.y}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (!previous || !point) continue;
    if (index === 1) path += ` L${midpoint(previous, point)}`;
    else path += ` Q${previous.x} ${previous.y} ${midpoint(previous, point)}`;
  }
  const last = points.at(-1);
  if (last && last !== first) path += ` L${last.x} ${last.y}`;

  return path;
}
