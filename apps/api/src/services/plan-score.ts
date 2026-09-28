import { getPrismaClient, Prisma } from '@trove/db';
import type { TripPlanScore } from '@trove/types';
import { z } from 'zod';

import {
  readOwnedTripDestinationContext,
  destinationContextRevision,
  type OwnedContextPlace,
} from './destination-context.js';
import { tripPlanScoreRevision } from './plan-score-revision.js';
import { oldestPlanScoreEvidenceAt, originalPlanScoreTime } from './plan-score-freshness.js';
export { PLAN_SCORE_CACHE_TTL_MS } from './plan-score-freshness.js';

import { arePlanScoreProvidersDisabled } from '../environment.js';
import {
  sameDayJourneyCommitment,
  toDayEvidenceItems,
  toLocalDate,
  type ItineraryDayRecord,
  type PlaceHoursEvidence,
} from './itinerary-day-evidence.js';
import type { ItineraryDayRoutes } from './itinerary-route-reader.js';
import { cachedPlaceResolver, readScoringRoutes, readScoringPlace } from './scoring-evidence.js';
import { PLACE_EVIDENCE_TTL_MS } from './place-evidence-cache.js';
import { TRAVEL_LEG_CACHE_TTL_MS } from './route-evidence-cache.js';
import { ItineraryNotFoundError } from './itineraries.js';
import { readDayPlanningContext, readTripPlanningPreferences } from '@trove/types';
import { mapWithConcurrency, PROVIDER_CONCURRENCY_LIMIT } from './concurrency.js';
import { explainDay, explainTrip } from './plan-score-explanations.js';
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
  type PlanScoreFactorResult,
} from './plan-score-rules.js';

/**
 * Plan Score for a trip, derived on demand from stored itinerary data and
 * unexpired cached route/place evidence (PRD section 29). Never acquires evidence.
 *
 * One factor stays unknown in this integration rather than being guessed: route
 * efficiency, because comparing alternative orders needs a full pairwise duration
 * matrix per day. It lowers completeness honestly instead of inventing evidence.
 */

export type { TripPlanScore, TripPlanScoreDay } from '@trove/types';

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
  destinationContext?: import('@trove/types').TripDestinationContext;
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
          duration: {
            minutes: segment.durationSeconds / 60,
            source: segment.evidenceAsOf ? 'CACHED_PROVIDER' : 'USER_OWNED',
          },
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
          : { rating, source: 'CACHED_PROVIDER', status: 'KNOWN' },
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
    evidenceAsOf: z.string().nullable().optional(),
    sourceInputRevision: z.string().optional(),
    expiresAt: z.string().datetime().optional(),
    evidenceRevision: z.string().optional(),
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

/** A failed freshness check must not return an apparently current number. */
export function withholdNonCurrentPlanScore(score: TripPlanScore, now: Date): TripPlanScore {
  if (score.score === null && score.days.every((day) => day.score === null)) return score;
  if (originalPlanScoreTime(score, now)) return score;
  return {
    ...score,
    score: null,
    withheldReasons: [...new Set([...score.withheldReasons, 'EVIDENCE_NOT_CURRENT' as const])],
    days: score.days.map((day) => ({
      ...day,
      score: null,
      withheldReasons: [...new Set([...day.withheldReasons, 'EVIDENCE_NOT_CURRENT' as const])],
    })),
  };
}

/**
 * Aggregation and explanation over days that have already been evaluated, so a
 * caller that assembled its own evidence never reimplements the trip rubric.
 */
export function buildPlanScoreFromEvaluations(input: {
  days: Array<{ date: string; evaluation: PlanScoreDayEvaluation }>;
  mustGoIds: string[];
  scheduledIds: string[];
  evaluatedAt?: Date;
  evidenceTimes?: readonly string[];
  destinationContext?: import('@trove/types').TripDestinationContext;
}): TripPlanScore {
  const generatedAt = (input.evaluatedAt ?? new Date()).toISOString();
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
    generatedAt,
    expiresAt: new Date(
      Math.min(
        Date.parse(generatedAt) + 24 * 60 * 60 * 1000,
        ...(input.destinationContext?.expiresAt
          ? [Date.parse(input.destinationContext.expiresAt)]
          : []),
        ...(input.evidenceTimes ?? []).map((at) => Date.parse(at) + PLACE_EVIDENCE_TTL_MS),
      ),
    ).toISOString(),
    evidenceAsOf: oldestPlanScoreEvidenceAt(generatedAt, input.evidenceTimes ?? []),
    mustGoPriorityFit: result.mustGoPriorityFit,
    score: result.score,
    withheldReasons: result.withheldReasons,
  };
}

/**
 * Pure scoring over already-loaded evidence, so the aggregation and explanation
 * wiring can be exercised without a database or provider.
 */
export function buildTripPlanScore(
  record: PlanScoreTripRecord,
  options: { evaluatedAt?: Date; evidenceTimes?: readonly string[] } = {},
): TripPlanScore {
  return buildPlanScoreFromEvaluations({
    ...options,
    destinationContext: record.destinationContext,
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
 * Read the shared evidence repository for scheduled Trip Places. Missing or
 * expired evidence stays unknown; this function cannot acquire or refresh it.
 */
export async function loadPlaceEvidence(
  tripPlaces: Array<{ externalPlaceId: string | null; id: string }>,
  now: Date,
) {
  const hours: PlaceHoursEvidence = new Map();
  const ratings = new Map<string, number>();

  const results = await mapWithConcurrency(
    tripPlaces,
    PROVIDER_CONCURRENCY_LIMIT,
    async (tripPlace) => {
      if (!tripPlace.externalPlaceId) return null;
      const details = await readScoringPlace(
        {
          externalPlaceId: tripPlace.externalPlaceId,
        },
        now,
      );
      if (!details || details.status !== 'ok') return null;
      return {
        fetchedAt: details.freshness.fetchedAt,
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
      source: 'CACHED_PROVIDER',
      periods: result.openingPeriods,
      utcOffsetMinutes: result.utcOffsetMinutes,
    });
  }

  return {
    hours,
    ratings,
    evidenceTimes: results.flatMap((result) => (result ? [result.fetchedAt] : [])),
  };
}

/**
 * Stored assessments expire after one day or when any underlying evidence expires.
 * Separate input and evidence revisions invalidate edits and refreshed snapshots.
 */
type TripPlanScoreRow = {
  planScore: Prisma.JsonValue | null;
  planScoreComputedAt: Date | null;
  planScoreRevision: string | null;
};

/** The one shape both the digest and the scorer read, so they cannot disagree. */
function toPlanScoreDayRecord(
  day: {
    date: Date;
    defaultTimeZone: string;
    id: string;
    items: Array<{
      _count: { reservations: number };
      dayPart: string | null;
      durationMinutes: number | null;
      durationProvenance: string;
      id: string;
      localStartTime: Date | null;
      startInstant: Date | null;
      timeSemantics: string | null;
      timeProvenance: string | null;
      timeZone: string | null;
      tripPlaceId: string | null;
    }>;
  },
  commitments: ReturnType<typeof sameDayJourneyCommitment>[],
): PlanScoreDayRecord {
  const date = toLocalDate(day.date);
  return {
    commitments: commitments.flatMap((commitment) =>
      commitment && commitment.date === date ? [commitment] : [],
    ),
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
      timeProvenance: item.timeProvenance,
      timeZone: item.timeZone,
      tripPlaceId: item.tripPlaceId,
    })),
    timeZone: day.defaultTimeZone,
  };
}

/**
 * What a Plan Score reads, as a Prisma selection. Exported so Apply reads the
 * rows it just created through the same shape rather than reconstructing them:
 * a second mapper is a second thing to keep in step with the rubric, and a
 * revision computed from a drifted one silently serves a stale score.
 */
export const PLAN_SCORE_TRIP_INCLUDE = {
  itineraryDays: {
    orderBy: { date: 'asc' },
    include: {
      items: {
        orderBy: { position: 'asc' },
        include: { _count: { select: { reservations: true } } },
      },
    },
  },
  destinations: { include: { place: { include: { providerRefs: true } } } },
  reservations: {
    select: {
      transportDepartureLocalDate: true,
      transportDepartureLocalTime: true,
      transportDepartureTimeZone: true,
      transportDepartureInstant: true,
      transportArrivalLocalDate: true,
      transportArrivalLocalTime: true,
      transportArrivalTimeZone: true,
      transportArrivalInstant: true,
      flightDepartureTimeZone: true,
      flightDepartureInstant: true,
      flightArrivalTimeZone: true,
      flightArrivalInstant: true,
      flightArrivalLocalDate: true,
      flightArrivalLocalTime: true,
      flightDepartureLocalDate: true,
      flightDepartureLocalTime: true,
      id: true,
    },
  },
  tripPlaces: {
    select: { id: true, placeId: true, place: { include: { providerRefs: true } }, priority: true },
  },
} as const;

export type PlanScoreTripRows = {
  startDate?: Date;
  planningPreferences?: unknown;
  endDate?: Date;
  destinations?: unknown;
  startingPlaceId?: string | null;
  itineraryDays: Array<{
    dailyBaseDepartureTripPlaceId: string | null;
    dailyBaseTripPlaceId: string | null;
    date: Date;
    defaultTimeZone: string;
    id: string;
    items: Array<{
      _count: { reservations: number };
      dayPart: string | null;
      durationMinutes: number | null;
      durationProvenance: string;
      id: string;
      localStartTime: Date | null;
      position: number;
      startInstant: Date | null;
      timeSemantics: string | null;
      timeProvenance: string | null;
      timeZone: string | null;
      travelModeToNext: string | null;
      tripPlaceId: string | null;
    }>;
    routeStartTravelMode: string;
    planningContext?: unknown;
  }>;
  reservations: Parameters<typeof sameDayJourneyCommitment>[0][];
  tripPlaces: Array<{
    id: string;
    placeId?: string;
    priority: string | null;
    place?: OwnedContextPlace;
  }>;
};

/** The single reading of a trip that both the digest and the scorer are built on. */
export function readPlanScoreInputs(trip: PlanScoreTripRows, now = new Date()) {
  const destinationContext = readOwnedTripDestinationContext(trip, now);
  const commitments = trip.reservations.flatMap((reservation) => {
    const commitment = sameDayJourneyCommitment(reservation);
    return commitment ? [commitment] : [];
  });
  const mustGoTripPlaceIds = trip.tripPlaces
    .filter((tripPlace) => tripPlace.priority === 'MUST_GO')
    .map((tripPlace) => tripPlace.id);
  const days = trip.itineraryDays.map((day) => toPlanScoreDayRecord(day, commitments));
  const scoredPlaceIds = new Set([
    ...mustGoTripPlaceIds,
    ...trip.itineraryDays.flatMap((day) =>
      [day.dailyBaseTripPlaceId, day.dailyBaseDepartureTripPlaceId].filter((id): id is string =>
        Boolean(id),
      ),
    ),
    ...days.flatMap((day) =>
      day.items.flatMap((item) => (item.tripPlaceId ? [item.tripPlaceId] : [])),
    ),
  ]);

  return {
    days,
    mustGoTripPlaceIds,
    destinationContext,
    revision: tripPlanScoreRevision({
      context: {
        destinationContext: destinationContextRevision(destinationContext),
        preferences: readTripPlanningPreferences(trip.planningPreferences),
        days: trip.itineraryDays.map((day) => readDayPlanningContext(day.planningContext)),
        endDate: trip.endDate,
        destinations: trip.destinations,
        reservations: trip.reservations,
      },
      startDate: trip.startDate ?? null,
      startingPlaceId: trip.startingPlaceId ?? null,
      days: trip.itineraryDays.map((day, index) => ({
        record: days[index]!,
        routing: {
          dailyBaseDepartureTripPlaceId: day.dailyBaseDepartureTripPlaceId,
          dailyBaseTripPlaceId: day.dailyBaseTripPlaceId,
          items: day.items.map((item) => ({
            id: item.id,
            position: item.position,
            travelModeToNext: item.travelModeToNext,
          })),
          routeStartTravelMode: day.routeStartTravelMode,
        },
      })),
      mustGoTripPlaceIds,
      placeIdentities: trip.tripPlaces
        .filter(({ id }) => scoredPlaceIds.has(id))
        .map(({ id, placeId }) => ({ id, placeId: placeId ?? null })),
    }),
  };
}

function readCachedPlanScore(
  trip: TripPlanScoreRow,
  revision: string,
  now: Date,
  evidenceRevision: string,
) {
  if (trip.planScoreRevision !== revision || !trip.planScoreComputedAt) return null;

  // A row written before the current payload shape is a miss, not something to
  // hand to a client.
  const score = parseStoredPlanScore(trip.planScore);
  return score?.evidenceRevision === evidenceRevision &&
    originalPlanScoreTime(score, now, trip.planScoreComputedAt)
    ? score
    : null;
}

/**
 * Writing on every compute is what makes this worth having: the saving reaches
 * a hand-built trip too, not only one an AI run already paid for.
 */
async function writeCachedPlanScore(
  prisma: ReturnType<typeof getPrismaClient>,
  tripId: string,
  planScore: TripPlanScore,
  revision: string,
) {
  await prisma.trip.update({
    where: { id: tripId },
    data: {
      planScore: planScore as unknown as Prisma.InputJsonValue,
      planScoreComputedAt: new Date(planScore.generatedAt),
      planScoreRevision: revision,
    },
  });
}

export async function getTripPlanScore(
  userId: string,
  tripId: string,
  services: { now?: () => Date } = {},
): Promise<TripPlanScore | null> {
  const now = services.now?.() ?? new Date();
  // Preserve the administrative visibility switch. Scoring now makes zero
  // provider requests whether enabled or disabled; AI draft assessment is separate.
  if (arePlanScoreProvidersDisabled()) return null;

  const prisma = getPrismaClient();
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    include: PLAN_SCORE_TRIP_INCLUDE,
  });
  if (!trip) throw new ItineraryNotFoundError('trip_not_found');

  // Input and evidence revisions cover itinerary edits and ordinary refreshes.
  const {
    days: dayRecords,
    mustGoTripPlaceIds,
    revision,
    destinationContext,
  } = readPlanScoreInputs(trip, now);

  const resolvePlace = cachedPlaceResolver(now);
  // Evidence (rating/hours) only ever feeds a day's factors, scoped to the trip
  // places that are actually scheduled on some day - toDayPlaces/
  // toDayEvidenceItems never look past that set. A trip place saved but never
  // placed on a day would otherwise be read and immediately discarded.
  const scheduledTripPlaceIds = new Set(
    trip.itineraryDays.flatMap((day) =>
      day.items.flatMap((item) => (item.tripPlaceId ? [item.tripPlaceId] : [])),
    ),
  );

  const [routeResults, placeEvidence] = await Promise.all([
    mapWithConcurrency(trip.itineraryDays, PROVIDER_CONCURRENCY_LIMIT, async (day) => ({
      id: day.id,
      routes: await readScoringRoutes(userId, tripId, day.id, now, resolvePlace),
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
      now,
    ),
  ]);

  const evidenceRevision = tripPlanScoreRevision({
    days: [],
    mustGoTripPlaceIds: [],
    context: {
      revision,
      hours: [...placeEvidence.hours],
      ratings: [...placeEvidence.ratings],
      evidenceTimes: placeEvidence.evidenceTimes,
      routes: routeResults.map(({ id, routes }) => ({
        id,
        segments: routes.segments,
        summary: routes.summary,
      })),
    },
  });
  const cached = readCachedPlanScore(trip, revision, now, evidenceRevision);
  if (cached) return cached;
  const evaluatedAt = services.now?.() ?? new Date();
  const result = buildTripPlanScore(
    {
      days: dayRecords,
      destinationContext,
      hours: placeEvidence.hours,
      mustGoTripPlaceIds,
      ratings: placeEvidence.ratings,
      routes: new Map(routeResults.map(({ id, routes }) => [id, routes])),
    },
    {
      evaluatedAt,
      evidenceTimes: [
        ...(placeEvidence.evidenceTimes ?? []),
        ...routeResults.flatMap(({ routes }) =>
          routes.segments.flatMap((segment) =>
            segment.evidenceAsOf ? [segment.evidenceAsOf] : [],
          ),
        ),
      ],
    },
  );

  result.evidenceRevision = evidenceRevision;
  result.expiresAt = new Date(
    Math.min(
      evaluatedAt.getTime() + 24 * 60 * 60 * 1000,
      ...(destinationContext.expiresAt ? [Date.parse(destinationContext.expiresAt)] : []),
      ...placeEvidence.evidenceTimes.map((at) => Date.parse(at) + PLACE_EVIDENCE_TTL_MS),
      ...routeResults.flatMap(({ routes }) =>
        routes.segments.flatMap((segment) =>
          segment.evidenceExpiresAt ? [Date.parse(segment.evidenceExpiresAt)] : [],
        ),
      ),
      ...routeResults.flatMap(({ routes }) =>
        routes.segments.flatMap((segment) =>
          segment.evidenceAsOf ? [Date.parse(segment.evidenceAsOf) + TRAVEL_LEG_CACHE_TTL_MS] : [],
        ),
      ),
    ),
  ).toISOString();
  const current = withholdNonCurrentPlanScore(result, evaluatedAt);
  await writeCachedPlanScore(prisma, trip.id, current, revision);
  return current;
}
