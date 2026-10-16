import type { ItineraryDay, ItineraryRouteSegment } from '@/lib/itinerary/api';
import { dayStopNumbers, resolveDailyBases } from '@/lib/itinerary/day-sequence';
import { decodeGooglePolyline, type ItineraryMapPoint } from '@/lib/maps/itinerary-map';

export type MapRouteEndpoint = ItineraryRouteSegment['origin'] & {
  order: number | null;
  pointId: string | null;
};

export type MapRouteLeg = Omit<ItineraryRouteSegment, 'origin' | 'destination'> & {
  cached: boolean;
  origin: MapRouteEndpoint;
  destination: MapRouteEndpoint;
};

/** Preserve the whole sequence, including legs without geometry. Identity comes
 * from the itinerary, never the position of a filtered polyline or nearby pin. */
export function buildMapRouteLegs(
  day: ItineraryDay | null,
  segments: ItineraryRouteSegment[],
  points: ItineraryMapPoint[],
  cached = false,
): MapRouteLeg[] {
  if (!day) return [];
  const numbers = dayStopNumbers({
    bases: resolveDailyBases({ day, routeSegments: segments }),
    itemCount: day.items.length,
  });
  const endpoint = (
    reference: ItineraryRouteSegment['origin'],
    end: 'origin' | 'destination',
  ): MapRouteEndpoint => {
    const index =
      reference.kind === 'itinerary_item'
        ? day.items.findIndex((item) => item.id === reference.id)
        : -1;
    const tripPlaceId =
      index >= 0
        ? day.items[index]?.tripPlace?.id
        : reference.kind === 'daily_base'
          ? reference.id
          : null;
    const point =
      points.find((candidate) =>
        reference.kind === 'itinerary_item'
          ? candidate.itemId === reference.id
          : reference.kind === 'daily_base' &&
            candidate.tripPlaceId === reference.id &&
            (candidate.baseRole === (end === 'origin' ? 'arrival' : 'departure') ||
              candidate.baseRole === 'both'),
      ) ??
      (tripPlaceId ? points.find((candidate) => candidate.tripPlaceId === tripPlaceId) : undefined);
    return {
      ...reference,
      label: reference.label ?? point?.name ?? null,
      order:
        index >= 0
          ? numbers.itemOffset + index + 1
          : reference.kind === 'daily_base'
            ? numbers[end === 'origin' ? 'arrival' : 'departure']
            : null,
      pointId: point?.id ?? null,
    };
  };
  return segments.map((segment) => ({
    ...segment,
    cached,
    origin: endpoint(segment.origin, 'origin'),
    destination: endpoint(segment.destination, 'destination'),
  }));
}

/** A deduplicated pin represents its first occurrence; route selection can
 * still name every later occurrence explicitly through the route chooser. */
export function routeForMapPoint(point: ItineraryMapPoint | null, legs: MapRouteLeg[]) {
  if (!point || point.kind === 'considered') return null;
  const matches = (end: MapRouteEndpoint) =>
    point.itemId
      ? end.kind === 'itinerary_item' && end.id === point.itemId
      : end.kind === 'daily_base' && end.id === point.tripPlaceId;
  const outgoing =
    point.baseRole === 'departure' ? undefined : legs.find((leg) => matches(leg.origin));
  return outgoing ?? legs.findLast((leg) => matches(leg.destination)) ?? null;
}

export type ScreenPoint = { x: number; y: number };

function distanceToSegment(point: ScreenPoint, a: ScreenPoint, b: ScreenPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared
    ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
    : 0;
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

/** All matching legs in itinerary order, including fully coincident paths. */
export function hitTestMapRoutes(
  point: ScreenPoint,
  paths: { id: string; path: ScreenPoint[] }[],
  radius: number,
) {
  return paths
    .filter(({ path }) =>
      path.some(
        (end, index) => index > 0 && distanceToSegment(point, path[index - 1]!, end) <= radius,
      ),
    )
    .map(({ id }) => id);
}

export function mapRoutePath(leg: MapRouteLeg) {
  return leg.encodedPolyline
    ? decodeGooglePolyline(leg.encodedPolyline).filter(
        (point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude),
      )
    : [];
}
