import { getPrismaClient } from '@trove/db';

import {
  sameDayJourneyCommitment,
  toDayEvidenceItems,
  toLocalDate,
  type ItineraryDayRecord,
  type PlaceHoursEvidence,
} from './itinerary-day-evidence.js';
import { getItineraryDayRoutes, type ItineraryDayRoutes } from './itinerary-routes.js';
import { ItineraryNotFoundError } from './itineraries.js';
import { createPlacesService } from './places-runtime.js';
import type { PlacesService } from './places.js';
import {
  explainDay,
  explainTrip,
  type PlanScoreExplanationGroups,
} from './plan-score-explanations.js';
import {
  evaluateFeasibility,
  evaluateMustGoPriorityFit,
  evaluatePaceBuffer,
  evaluatePlaceQuality,
  evaluateTravelEffort,
  type PlanScoreFixedCommitment,
  type PlanScorePlace,
  type PlanScoreRouteSegment,
} from './plan-score-factors.js';
import {
  planScoreFingerprint,
  scoreTrip,
  toPlanScoreDayPayload,
  type PlanScoreDayInput,
  type PlanScoreDayPayload,
  type PlanScoreFactorOutcome,
  type PlanScoreFactorResult,
  type PlanScoreTripWithheldReason,
} from './plan-score-rules.js';

/**
 * Plan Score for a trip, derived on demand from stored itinerary data and live
 * route/provider evidence (PRD section 29).
 *
 * One factor stays unknown in this integration rather than being guessed: route
 * efficiency, because comparing alternative orders needs a full pairwise duration
 * matrix per day. It lowers completeness honestly instead of inventing evidence.
 */

export type TripPlanScoreDay = PlanScoreDayPayload & {
  date: string;
  explanations: PlanScoreExplanationGroups;
};

export type TripPlanScore = {
  days: TripPlanScoreDay[];
  explanations: PlanScoreExplanationGroups;
  /** Identity of the evidence this result came from, for cache validation. */
  fingerprint: string;
  generatedAt: string;
  mustGoPriorityFit: PlanScoreFactorOutcome;
  score: number | null;
  withheldReasons: PlanScoreTripWithheldReason[];
};

/** The day shape is shared with the time suggester; see itinerary-day-evidence. */
export type PlanScoreDayRecord = ItineraryDayRecord;

export type PlanScoreTripRecord = {
  days: PlanScoreDayRecord[];
  /** Provider opening evidence keyed by Trip Place id; absent means no usable hours. */
  hours: PlaceHoursEvidence;
  mustGoTripPlaceIds: string[];
  /** Known public ratings keyed by Trip Place id; absent means no usable rating. */
  ratings: Map<string, number>;
  routes: Map<string, ItineraryDayRoutes>;
};

function toRouteSegments(routes: ItineraryDayRoutes | undefined): PlanScoreRouteSegment[] {
  return (routes?.segments ?? []).map((segment) => {
    // A long-distance leg carries no estimate by design. Travel effort and pace both
    // filter on scope, so passing it through keeps flights out of local travel
    // without pretending its duration is merely unknown.
    const scope = segment.scope === 'long_distance' ? 'LONG_DISTANCE' : 'LOCAL';

    return segment.durationSeconds === null
      ? { id: segment.id, scope, status: 'UNKNOWN' }
      : {
          duration: { minutes: segment.durationSeconds / 60, source: 'FRESH_PROVIDER' },
          id: segment.id,
          scope,
          status: 'KNOWN',
        };
  });
}

function toCommitments(day: PlanScoreDayRecord): PlanScoreFixedCommitment[] {
  return day.commitments.map((commitment) => ({
    endMinute: commitment.endMinute,
    id: commitment.id,
    source: 'USER_OWNED',
    startMinute: commitment.startMinute,
  }));
}

function toDayPlaces(day: PlanScoreDayRecord, ratings: Map<string, number>): PlanScorePlace[] {
  const tripPlaceIds = [
    ...new Set(day.items.flatMap((item) => (item.tripPlaceId ? [item.tripPlaceId] : []))),
  ];

  return tripPlaceIds.map((tripPlaceId) => {
    const rating = ratings.get(tripPlaceId);
    return {
      rating:
        rating === undefined
          ? { status: 'UNKNOWN' }
          : { rating, source: 'FRESH_PROVIDER', status: 'KNOWN' },
      tripPlaceId,
    };
  });
}

type DayEvaluation = {
  conflicts: ReturnType<typeof evaluateFeasibility>['conflicts'];
  input: PlanScoreDayInput;
  pace: ReturnType<typeof evaluatePaceBuffer>;
  travel: ReturnType<typeof evaluateTravelEffort>;
};

function evaluateDayRecord(day: PlanScoreDayRecord, record: PlanScoreTripRecord): DayEvaluation {
  const routes = record.routes.get(day.id);
  const items = toDayEvidenceItems(day, routes, record.hours);
  const segments = toRouteSegments(routes);
  const feasibility = evaluateFeasibility({ commitments: toCommitments(day), items });
  const travel = evaluateTravelEffort(segments);
  const pace = evaluatePaceBuffer({ items, segments });
  const placeQuality = evaluatePlaceQuality(toDayPlaces(day, record.ratings));

  return {
    conflicts: feasibility.conflicts,
    input: {
      dayId: day.id,
      // Route efficiency is deliberately absent: an alternative-order comparison
      // needs a pairwise duration matrix this endpoint does not fetch.
      factors: {
        FEASIBILITY: feasibility.factor,
        PACE_BUFFER: pace.factor,
        PLACE_QUALITY: placeQuality,
        TRAVEL_EFFORT: travel.factor,
      },
    },
    pace,
    travel,
  };
}

/**
 * Pure scoring over already-loaded evidence, so the aggregation and explanation
 * wiring can be exercised without a database or provider.
 */
export function buildTripPlanScore(record: PlanScoreTripRecord): TripPlanScore {
  const evaluations = record.days.map((day) => ({
    day,
    evaluation: evaluateDayRecord(day, record),
  }));
  const scheduledTripPlaceIds = record.days.flatMap((day) =>
    day.items.flatMap((item) => (item.tripPlaceId ? [item.tripPlaceId] : [])),
  );
  const mustGoPriorityFit: PlanScoreFactorResult = evaluateMustGoPriorityFit({
    mustGoTripPlaceIds: record.mustGoTripPlaceIds,
    scheduledTripPlaceIds,
    source: 'USER_OWNED',
  });
  const tripInput = {
    days: evaluations.map(({ evaluation }) => evaluation.input),
    mustGoPriorityFit,
  };
  const result = scoreTrip(tripInput);
  const scheduled = new Set(scheduledTripPlaceIds);

  return {
    days: result.days.map((dayResult, index) => {
      const entry = evaluations[index];
      return {
        ...toPlanScoreDayPayload(dayResult),
        date: entry?.day.date ?? '',
        explanations: explainDay({
          alternatives: [],
          conflicts: entry?.evaluation.conflicts ?? [],
          day: dayResult,
          pace: {
            activeMinutes: entry?.evaluation.pace.activeMinutes ?? null,
            smallestBufferMinutes: entry?.evaluation.pace.smallestBufferMinutes ?? null,
          },
          route: { bestMinutes: null, plannedMinutes: null },
          travel: { totalMinutes: entry?.evaluation.travel.totalMinutes ?? null },
        }),
      };
    }),
    explanations: explainTrip({
      mustGoPriorityFit: result.mustGoPriorityFit,
      unscheduledMustGoTripPlaceIds: record.mustGoTripPlaceIds.filter(
        (tripPlaceId) => !scheduled.has(tripPlaceId),
      ),
    }),
    fingerprint: planScoreFingerprint(tripInput),
    generatedAt: new Date().toISOString(),
    mustGoPriorityFit: result.mustGoPriorityFit,
    score: result.score,
    withheldReasons: result.withheldReasons,
  };
}

/**
 * One `getDetails` per Trip Place, yielding both factors that read provider data.
 * Callers scoped to a single day should narrow `tripPlaces` first, since this
 * fans out one request per entry.
 */
export async function loadPlaceEvidence(
  tripPlaces: Array<{ externalPlaceId: string | null; id: string }>,
  placesService: PlacesService | null,
) {
  const hours: PlaceHoursEvidence = new Map();
  const ratings = new Map<string, number>();
  if (!placesService) return { hours, ratings };

  const results = await Promise.all(
    tripPlaces.map(async (tripPlace) => {
      if (!tripPlace.externalPlaceId) return null;
      const details = await placesService.getDetails({
        externalPlaceId: tripPlace.externalPlaceId,
      });
      if (details.status !== 'ok') return null;
      return {
        id: tripPlace.id,
        openingPeriods: details.place.openingPeriods,
        rating: details.place.rating,
        utcOffsetMinutes: details.place.utcOffsetMinutes,
      };
    }),
  );

  for (const result of results) {
    if (!result) continue;
    if (result.rating !== null) ratings.set(result.id, result.rating);
    hours.set(result.id, {
      periods: result.openingPeriods,
      utcOffsetMinutes: result.utcOffsetMinutes,
    });
  }

  return { hours, ratings };
}

export async function getTripPlanScore(
  userId: string,
  tripId: string,
  services: { placesService?: PlacesService | null } = {},
): Promise<TripPlanScore> {
  const prisma = getPrismaClient();
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    include: {
      itineraryDays: {
        orderBy: { date: 'asc' },
        include: {
          items: {
            orderBy: { position: 'asc' },
            include: { _count: { select: { reservations: true } } },
          },
        },
      },
      reservations: {
        select: {
          flightArrivalLocalDate: true,
          flightArrivalLocalTime: true,
          flightDepartureLocalDate: true,
          flightDepartureLocalTime: true,
          id: true,
        },
      },
      tripPlaces: {
        select: { id: true, place: { select: { providerRefs: true } }, priority: true },
      },
    },
  });
  if (!trip) throw new ItineraryNotFoundError('trip_not_found');

  const placesService =
    services.placesService === undefined ? createPlacesService() : services.placesService;
  const commitments = trip.reservations.flatMap((reservation) => {
    const commitment = sameDayJourneyCommitment(reservation);
    return commitment ? [commitment] : [];
  });

  const [routeResults, placeEvidence] = await Promise.all([
    Promise.all(
      trip.itineraryDays.map(async (day) => ({
        id: day.id,
        routes: await getItineraryDayRoutes(userId, tripId, day.id),
      })),
    ),
    loadPlaceEvidence(
      trip.tripPlaces.map((tripPlace) => ({
        externalPlaceId:
          tripPlace.place.providerRefs.find((reference) => reference.provider === 'GOOGLE')
            ?.externalPlaceId ?? null,
        id: tripPlace.id,
      })),
      placesService,
    ),
  ]);

  return buildTripPlanScore({
    days: trip.itineraryDays.map((day) => {
      const date = toLocalDate(day.date);
      return {
        commitments: commitments.filter((commitment) => commitment.date === date),
        date,
        id: day.id,
        items: day.items.map((item) => ({
          dayPart: item.dayPart,
          durationMinutes: item.durationMinutes,
          id: item.id,
          localStartTime: item.localStartTime,
          reservationCount: item._count.reservations,
          startInstant: item.startInstant,
          timeSemantics: item.timeSemantics,
          timeZone: item.timeZone,
          tripPlaceId: item.tripPlaceId,
        })),
        timeZone: day.defaultTimeZone,
      };
    }),
    hours: placeEvidence.hours,
    mustGoTripPlaceIds: trip.tripPlaces
      .filter((tripPlace) => tripPlace.priority === 'MUST_GO')
      .map((tripPlace) => tripPlace.id),
    ratings: placeEvidence.ratings,
    routes: new Map(routeResults.map(({ id, routes }) => [id, routes])),
  });
}
