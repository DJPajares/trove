import { getPrismaClient } from '@trove/db';
import { z } from 'zod';

import { arePlanScoreProvidersDisabled } from '../environment.js';
import {
  sameDayJourneyCommitment,
  toDayEvidenceItems,
  toLocalDate,
  type ItineraryDayRecord,
  type PlaceHoursEvidence,
} from './itinerary-day-evidence.js';
import {
  createPlaceResolver,
  getItineraryDayRoutes,
  type ItineraryDayRoutes,
} from './itinerary-routes.js';
import { ItineraryNotFoundError } from './itineraries.js';
import { createPlacesService } from './places-runtime.js';
import type { PlacesService } from './places.js';
import { createRoutesService } from './routes-runtime.js';
import { mapWithConcurrency, PROVIDER_CONCURRENCY_LIMIT } from './concurrency.js';
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
  type PlanScoreDayItem,
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

export type PlanScoreDayEvaluation = {
  conflicts: ReturnType<typeof evaluateFeasibility>['conflicts'];
  input: PlanScoreDayInput;
  pace: ReturnType<typeof evaluatePaceBuffer>;
  travel: ReturnType<typeof evaluateTravelEffort>;
};

/**
 * The rubric over one day's evidence, with no opinion about where that evidence
 * came from. A stored trip reads it from Prisma rows; the AI planner builds the
 * same shapes from a draft it has just grounded. Keeping the mapping outside is
 * what lets both score identically without either owning the other's queries.
 */
export function evaluateScoredDay(input: {
  commitments: PlanScoreFixedCommitment[];
  dayId: string;
  items: PlanScoreDayItem[];
  places: PlanScorePlace[];
  segments: PlanScoreRouteSegment[];
}): PlanScoreDayEvaluation {
  const feasibility = evaluateFeasibility({
    commitments: input.commitments,
    items: input.items,
  });
  const travel = evaluateTravelEffort(input.segments);
  const pace = evaluatePaceBuffer({ items: input.items, segments: input.segments });
  const placeQuality = evaluatePlaceQuality(input.places);

  return {
    conflicts: feasibility.conflicts,
    input: {
      dayId: input.dayId,
      // Route efficiency is deliberately absent: an alternative-order comparison
      // needs a pairwise duration matrix no caller fetches.
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

function evaluateDayRecord(
  day: PlanScoreDayRecord,
  record: PlanScoreTripRecord,
): PlanScoreDayEvaluation {
  const routes = record.routes.get(day.id);
  return evaluateScoredDay({
    commitments: toCommitments(day),
    dayId: day.id,
    items: toDayEvidenceItems(day, routes, record.hours),
    places: toDayPlaces(day, record.ratings),
    segments: toRouteSegments(routes),
  });
}

const factorOutcomeSchema = z.union([
  z.object({ confidence: z.number(), score: z.number(), state: z.literal('EVALUATED') }).strict(),
  z
    .object({
      reason: z.enum(['INSUFFICIENT_EVIDENCE', 'MISSING_EVIDENCE', 'UNUSABLE_EVIDENCE']),
      state: z.literal('UNKNOWN'),
    })
    .strict(),
  z.object({ state: z.literal('NOT_APPLICABLE') }).strict(),
]);

const explanationGroupsSchema = z
  .object({
    uncertainty: z.array(explanationSchema()),
    whatWorks: z.array(explanationSchema()),
    worthImproving: z.array(explanationSchema()),
  })
  .strict();

function explanationSchema() {
  return z
    .object({
      action: z
        .enum([
          'ADD_BUFFER',
          'ADJUST_TIME',
          'RECONSIDER_DETOUR',
          'REORDER_MANUALLY',
          'REVIEW_ALTERNATIVE',
          'SCHEDULE_MUST_GO',
        ])
        .nullable(),
      factor: z.string(),
      messageKey: z.string(),
      references: z.array(z.string()),
      values: z.record(z.string(), z.union([z.number(), z.string()])),
    })
    .strict();
}

const tripPlanScoreSchema = z
  .object({
    days: z.array(
      z
        .object({
          completeness: z.number(),
          confidence: z.number().nullable(),
          date: z.string(),
          dayId: z.string(),
          explanations: explanationGroupsSchema,
          factors: z.record(z.string(), factorOutcomeSchema),
          score: z.number().nullable(),
          withheldReasons: z.array(z.string()),
        })
        .strict(),
    ),
    explanations: explanationGroupsSchema,
    fingerprint: z.string(),
    generatedAt: z.string(),
    mustGoPriorityFit: factorOutcomeSchema,
    score: z.number().nullable(),
    withheldReasons: z.array(z.string()),
  })
  .strict();

/**
 * A score is derived, so a row that predates the current shape is worth nothing
 * and is better dropped than surfaced. Returning null degrades the panel to its
 * unavailable state rather than failing the session that carries it.
 */
export function parseStoredPlanScore(value: unknown): TripPlanScore | null {
  if (value === null || value === undefined) return null;
  const parsed = tripPlanScoreSchema.safeParse(value);
  return parsed.success ? (parsed.data as TripPlanScore) : null;
}

/**
 * Aggregation and explanation over days that have already been evaluated, so a
 * caller that assembled its own evidence never reimplements the trip rubric.
 */
export function buildPlanScoreFromEvaluations(input: {
  days: Array<{ date: string; evaluation: PlanScoreDayEvaluation }>;
  mustGoIds: string[];
  scheduledIds: string[];
}): TripPlanScore {
  const evaluations = input.days;
  const mustGoPriorityFit: PlanScoreFactorResult = evaluateMustGoPriorityFit({
    mustGoTripPlaceIds: input.mustGoIds,
    scheduledTripPlaceIds: input.scheduledIds,
    source: 'USER_OWNED',
  });
  const tripInput = {
    days: evaluations.map(({ evaluation }) => evaluation.input),
    mustGoPriorityFit,
  };
  const result = scoreTrip(tripInput);
  const scheduled = new Set(input.scheduledIds);

  return {
    days: result.days.map((dayResult, index) => {
      const entry = evaluations[index];
      return {
        ...toPlanScoreDayPayload(dayResult),
        date: entry?.date ?? '',
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
      unscheduledMustGoTripPlaceIds: input.mustGoIds.filter(
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
 * Pure scoring over already-loaded evidence, so the aggregation and explanation
 * wiring can be exercised without a database or provider.
 */
export function buildTripPlanScore(record: PlanScoreTripRecord): TripPlanScore {
  return buildPlanScoreFromEvaluations({
    days: record.days.map((day) => ({
      date: day.date,
      evaluation: evaluateDayRecord(day, record),
    })),
    mustGoIds: record.mustGoTripPlaceIds,
    scheduledIds: record.days.flatMap((day) =>
      day.items.flatMap((item) => (item.tripPlaceId ? [item.tripPlaceId] : [])),
    ),
  });
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

  const results = await mapWithConcurrency(
    tripPlaces,
    PROVIDER_CONCURRENCY_LIMIT,
    async (tripPlace) => {
      if (!tripPlace.externalPlaceId) return null;
      const details = await placesService.getDetails({
        detail: 'evidence',
        externalPlaceId: tripPlace.externalPlaceId,
      });
      if (details.status !== 'ok') return null;
      return {
        id: tripPlace.id,
        openingPeriods: details.place.openingPeriods,
        rating: details.place.rating,
        utcOffsetMinutes: details.place.utcOffsetMinutes,
      };
    },
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
): Promise<TripPlanScore | null> {
  // Do this before opening Prisma: stale clients may still reach the endpoint,
  // but an administrative kill switch must make that request cost-free too.
  //
  // This is the switch's only reader, and deliberately so. It exists to stop the
  // fan-out this endpoint causes; the AI planner scores a draft from evidence its
  // own run already paid for and reaches no provider to score it, so there is
  // nothing here for the switch to save and it must not silence that score.
  if (arePlanScoreProvidersDisabled()) return null;

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
    services.placesService === undefined
      ? createPlacesService({ source: 'plan-score' })
      : services.placesService;
  const commitments = trip.reservations.flatMap((reservation) => {
    const commitment = sameDayJourneyCommitment(reservation);
    return commitment ? [commitment] : [];
  });

  const routesService = createRoutesService({ source: 'plan-score' });
  // One resolver for the whole trip. Days share places constantly - the same
  // hotel is the base every night - and a per-day resolver re-fetched each one.
  // Mirrors the guard inside getItineraryDayRoutes: with no routing there is
  // nothing to resolve coordinates for.
  const resolvePlace = createPlaceResolver(
    routesService ? placesService : null,
    undefined,
    'plan-score',
  );

  // Evidence (rating/hours) only ever feeds a day's factors, scoped to the trip
  // places that are actually scheduled on some day - toDayPlaces/
  // toDayEvidenceItems never look past that set. A trip place saved but never
  // placed on a day would otherwise be fetched and immediately discarded.
  const scheduledTripPlaceIds = new Set(
    trip.itineraryDays.flatMap((day) =>
      day.items.flatMap((item) => (item.tripPlaceId ? [item.tripPlaceId] : [])),
    ),
  );

  const [routeResults, placeEvidence] = await Promise.all([
    mapWithConcurrency(trip.itineraryDays, PROVIDER_CONCURRENCY_LIMIT, async (day) => ({
      id: day.id,
      routes: await getItineraryDayRoutes(
        userId,
        tripId,
        day.id,
        {},
        { placesService, resolvePlace, routesService, source: 'plan-score' },
      ),
    })),
    loadPlaceEvidence(
      trip.tripPlaces
        .filter((tripPlace) => scheduledTripPlaceIds.has(tripPlace.id))
        .map((tripPlace) => ({
          externalPlaceId:
            tripPlace.place.providerRefs.find((reference) => reference.provider === 'GOOGLE')
              ?.externalPlaceId ?? null,
          id: tripPlace.id,
        })),
      placesService,
    ),
  ]);

  const result = buildTripPlanScore({
    days: trip.itineraryDays.map((day) => {
      const date = toLocalDate(day.date);
      return {
        commitments: commitments.filter((commitment) => commitment.date === date),
        date,
        id: day.id,
        items: day.items.map((item) => ({
          dayPart: item.dayPart,
          durationMinutes: item.durationMinutes,
          durationProvenance: item.durationProvenance,
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

  return result;
}
