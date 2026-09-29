import type { ItineraryDayRoutes } from './itinerary-route-reader.js';
import type {
  PlanScoreDayItem,
  PlanScoreRouteEfficiencyInput,
  PlanScoreRouteLeg,
} from './plan-score-factors.js';

type Coordinates = { latitude: number; longitude: number };
type ChainPoint = ItineraryDayRoutes['segments'][number]['origin'];

/** A day whose stops sit this close together has no order worth comparing. */
const MINIMUM_PLANNED_KM = 0.5;

export function haversineKm(a: Coordinates, b: Coordinates) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * An estimated comparison of the day's planned order with the best order of
 * the same stops, for `evaluateRouteEfficiency`.
 *
 * Only the planned chain is ever routed, so every other pair is estimated from
 * straight-line distance scaled by the day's own pace: the planned legs' routed
 * minutes over their straight-line kilometres. The planned order therefore
 * costs exactly its routed minutes, and the ratio the evaluator reports is the
 * ratio of distances. Nothing here asks a provider for anything.
 *
 * The chain's ends stay put - the stay the day starts from and returns to, or
 * the first and last stops when there is none - and so does any stop with a
 * booking or a time the traveller set. Only flexible stops may move.
 *
 * `undefined` when the comparison cannot be made honestly: a long-distance
 * leg, a gap in the chain, an unrouted leg, or a stop with no known location.
 */
export function estimatedRouteComparison(input: {
  segments: ItineraryDayRoutes['segments'];
  items: readonly PlanScoreDayItem[];
  locate: (point: ChainPoint) => Coordinates | null;
}): PlanScoreRouteEfficiencyInput | undefined {
  let segments = [...input.segments];
  // A day-one starting location is not a place Trove stores coordinates for.
  // Its leg is dropped rather than letting it void the whole comparison.
  if (
    segments[0] &&
    segments[0].origin.kind !== 'itinerary_item' &&
    !input.locate(segments[0].origin)
  )
    segments = segments.slice(1);
  const lastSegment = segments.at(-1);
  if (
    lastSegment &&
    lastSegment.destination.kind !== 'itinerary_item' &&
    !input.locate(lastSegment.destination)
  )
    segments = segments.slice(0, -1);
  if (!segments.length) return undefined;

  for (const [index, segment] of segments.entries()) {
    if (segment.scope !== 'local' || segment.durationSeconds === null) return undefined;
    const next = segments[index + 1];
    if (next && next.origin.id !== segment.destination.id) return undefined;
  }

  const points = [segments[0]!.origin, ...segments.map((segment) => segment.destination)];
  const located = points.map((point) => input.locate(point));
  if (located.some((coordinates) => coordinates === null)) return undefined;
  const coordinates = located as Coordinates[];

  const plannedMinutes = segments.reduce((sum, segment) => sum + segment.durationSeconds! / 60, 0);
  let plannedKm = 0;
  for (let index = 1; index < coordinates.length; index++)
    plannedKm += haversineKm(coordinates[index - 1]!, coordinates[index]!);
  if (plannedKm < MINIMUM_PLANNED_KM || plannedMinutes <= 0) return undefined;
  const minutesPerKm = plannedMinutes / plannedKm;

  const items = new Map(input.items.map((item) => [item.id, item]));
  const movable = (point: ChainPoint) => {
    if (point.kind !== 'itinerary_item') return false;
    const item = items.get(point.id);
    // An estimated time moves with its stop; a booked or chosen one does not.
    return Boolean(
      item && !item.fixed && (item.start === null || item.start.source === 'ESTIMATED'),
    );
  };
  const last = points.length - 1;
  const stops = points.map((point, index) => ({
    id: `stop:${index}`,
    fixed: index === 0 || index === last || !movable(point),
  }));
  const legs: PlanScoreRouteLeg[] = [];
  for (let from = 0; from < points.length; from++)
    for (let to = 0; to < points.length; to++)
      if (from !== to)
        legs.push({
          fromId: `stop:${from}`,
          toId: `stop:${to}`,
          duration: {
            minutes: haversineKm(coordinates[from]!, coordinates[to]!) * minutesPerKm,
            source: 'ESTIMATED',
          },
        });

  return { legs, stops, isFeasibleOrder: () => true };
}
