import { getPrismaClient } from '@trove/db';

import { timeZoneAtCoordinates } from './coordinate-time-zone.js';
import type { ItineraryRouteSegment } from './itinerary-route-reader.js';
import { ItineraryNotFoundError } from './itineraries.js';
import { estimatedRouteComparison } from './plan-score-route-comparison.js';
import {
  buildScoringDay,
  discardExpiredCurrentHours,
  evaluateDayRecord,
  loadPlaceEvidence,
  mergeScoringPlaceIdentity,
  PLAN_SCORE_TRIP_INCLUDE,
  readPlanScoreInputs,
  tripLegCalibration,
  type PlanScoreDayRecord,
  type PlanScoreTripRecord,
} from './plan-score.js';
import { cachedPlaceResolver, readScoringRoutes } from './scoring-evidence.js';

/**
 * The order Plan Score compared a day against, as something the traveller can
 * preview and apply (PRD 29.4: shown, never applied silently).
 *
 * It is read exactly as Plan Score reads the day - stored rows, stored or
 * estimated legs, stored opening hours - so nothing here reaches a provider,
 * and the order offered is the one that produced the "avoidable movement"
 * problem in the first place.
 */

/** Plan Score only raises the problem past these, so the preview uses the same bar. */
const MINIMUM_SAVING_RATIO = 1.1;
const MINIMUM_SAVING_MINUTES = 10;

export type DayBetterOrder =
  | { status: 'no_better_order' }
  | {
      bestMinutes: number;
      /** Opening-hours clashes on the day as planned, and in the proposed order. */
      conflictsAfter: number;
      conflictsBefore: number;
      /** The day's item ids in the proposed order. */
      order: string[];
      plannedMinutes: number;
      status: 'ok';
    };

const HOURS_CONFLICTS = new Set(['OUTSIDE_OPENING_HOURS']);

function hoursConflicts(evaluation: ReturnType<typeof evaluateDayRecord>) {
  return evaluation.conflicts.filter(
    (conflict) => HOURS_CONFLICTS.has(conflict.kind) && conflict.severity !== 'SOFT',
  ).length;
}

/**
 * The same day with its items in `order`. Legs between stops that are now
 * neighbours were never routed, so they are left unmeasured and Plan Score's
 * own estimate fills them, exactly as it does for any unrouted leg.
 */
export function reorderedRecord(
  day: PlanScoreDayRecord,
  record: PlanScoreTripRecord,
  order: readonly string[],
): { day: PlanScoreDayRecord; record: PlanScoreTripRecord } {
  const byId = new Map(day.items.map((item) => [item.id, item]));
  const items = order.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
  const reordered = { ...day, items };

  const routes = record.routes.get(day.id);
  if (!routes?.segments.length) return { day: reordered, record };

  const template = routes.segments[0]!;
  const first = routes.segments[0]!.origin.kind === 'itinerary_item' ? null : routes.segments[0]!;
  const last = routes.segments.at(-1)!;
  const endsAtBase = last.destination.kind !== 'itinerary_item' ? last : null;
  const itemPoint = (id: string) => ({ id, kind: 'itinerary_item' as const, label: null });
  const chain = [
    ...(first ? [first.origin] : []),
    ...items.map((item) => itemPoint(item.id)),
    ...(endsAtBase ? [endsAtBase.destination] : []),
  ];

  const stored = new Map(
    routes.segments.map((segment) => [`${segment.origin.id}>${segment.destination.id}`, segment]),
  );
  const segments: ItineraryRouteSegment[] = chain.slice(1).map((destination, index) => {
    const origin = chain[index]!;
    const existing = stored.get(`${origin.id}>${destination.id}`);
    return (
      existing ?? {
        ...template,
        destination,
        distanceMeters: null,
        durationSeconds: null,
        encodedPolyline: null,
        id: `${origin.kind}:${origin.id}:${destination.kind}:${destination.id}`,
        origin,
        provider: null,
        reason: null,
        scope: 'local',
        status: 'unavailable',
      }
    );
  });

  return {
    day: reordered,
    record: { ...record, routes: new Map([[day.id, { ...routes, segments }]]) },
  };
}

export async function getDayBetterOrder(
  userId: string,
  tripId: string,
  itineraryDayId: string,
  services: { now?: Date } = {},
): Promise<DayBetterOrder> {
  const now = services.now ?? new Date();
  const trip = await getPrismaClient().trip.findFirst({
    where: { id: tripId, ownerId: userId },
    include: PLAN_SCORE_TRIP_INCLUDE,
  });
  if (!trip) throw new ItineraryNotFoundError('trip_not_found');

  const day = readPlanScoreInputs(trip, now).days.find((entry) => entry.id === itineraryDayId);
  if (!day) throw new ItineraryNotFoundError('itinerary_day_not_found');

  const placeIds = new Set(
    day.items.flatMap((item) => (item.tripPlaceId ? [item.tripPlaceId] : [])),
  );
  const [routes, evidence] = await Promise.all([
    readScoringRoutes(userId, tripId, itineraryDayId, now, cachedPlaceResolver(now)),
    loadPlaceEvidence(
      trip.tripPlaces
        .filter((row) => placeIds.has(row.id))
        .map((row) => ({
          externalPlaceId:
            row.place.providerRefs.find((reference) => reference.provider === 'GOOGLE')
              ?.externalPlaceId ?? null,
          id: row.id,
        })),
      now,
    ),
  ]);
  for (const row of trip.tripPlaces) {
    const merged = mergeScoringPlaceIdentity(row.id, row.place, evidence.places.get(row.id), now);
    evidence.places.set(row.id, merged.place);
    const hours = evidence.hours.get(row.id);
    if (hours && !hours.timeZone && merged.place.coordinates)
      hours.timeZone = timeZoneAtCoordinates(merged.place.coordinates);
  }
  discardExpiredCurrentHours(evidence.hours, now);

  const record: PlanScoreTripRecord = {
    days: [day],
    hours: evidence.hours,
    mustGoTripPlaceIds: [],
    places: evidence.places,
    preferences: trip.planningPreferences,
    ratings: evidence.ratings,
    routes: new Map([[day.id, routes]]),
  };
  const calibration = tripLegCalibration(record);
  const planned = evaluateDayRecord(day, record, calibration);
  const route = planned.route;
  // Built exactly as `evaluateDayRecord` builds it, so its stop ids are the ones
  // the best order above is written in.
  const scoring = buildScoringDay(day, record, calibration);
  const points = estimatedRouteComparison({
    items: scoring.items,
    locate: scoring.locate,
    segments: scoring.routes?.segments ?? [],
  });

  if (
    !route.bestOrder ||
    route.bestMinutes === null ||
    route.plannedMinutes === null ||
    route.plannedMinutes <= MINIMUM_SAVING_RATIO * route.bestMinutes ||
    route.plannedMinutes - route.bestMinutes < MINIMUM_SAVING_MINUTES ||
    !points ||
    points === 'NOT_APPLICABLE' ||
    !points.points
  )
    return { status: 'no_better_order' };

  // Stop ids are positions in the planned chain; map them back to its items.
  const pointAt = new Map(
    points.stops.map((stop, index) => [stop.id, points.points![index]] as const),
  );
  const proposedItems = route.bestOrder.flatMap((stopId) => {
    const point = pointAt.get(stopId);
    return point?.kind === 'itinerary_item' ? [point.id] : [];
  });
  // Items the chain did not include (no location) keep their place at the end.
  const order = [
    ...proposedItems,
    ...day.items.map((item) => item.id).filter((id) => !proposedItems.includes(id)),
  ];

  const next = reorderedRecord(day, record, order);
  const proposed = evaluateDayRecord(next.day, next.record, calibration);

  return {
    bestMinutes: Math.round(route.bestMinutes),
    conflictsAfter: hoursConflicts(proposed),
    conflictsBefore: hoursConflicts(planned),
    order,
    plannedMinutes: Math.round(route.plannedMinutes),
    status: 'ok',
  };
}
