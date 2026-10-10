import { planScoreReferenceTargets } from './plan-score-reference-targets.js';
import { getPrismaClient, Prisma } from '@trove/db';
import {
  weatherDailyTtl,
  WEATHER_CACHE_POLICY,
  type PlanScoreExplanation,
  type TripContext,
  type TripPlanScore,
} from '@trove/types';
import { z } from 'zod';

import { contextPlaceFromOwnedData, type OwnedContextPlace } from './owned-place-location.js';
import { estimatedRouteComparison } from './plan-score-route-comparison.js';
import {
  legCalibration,
  routedLegSamples,
  withEstimatedLegs,
  type LegCalibration,
  type ScoringClimate,
} from './plan-score-estimates.js';
import { tripPlanScoreRevision } from './plan-score-revision.js';
import { oldestPlanScoreEvidenceAt, originalPlanScoreTime } from './plan-score-freshness.js';
export { PLAN_SCORE_CACHE_TTL_MS } from './plan-score-freshness.js';

import { arePlanScoreProvidersDisabled } from '../environment.js';
import {
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
import {
  evaluateScoredDay,
  type ScoringPlace,
  type ScoringRouteSegment,
  type ScoringForecast,
} from './plan-score-evaluation.js';
export { evaluateScoredDay } from './plan-score-evaluation.js';
import {
  scoringCommitments,
  normalizeScoringItems,
  dayOrigin,
  elapsedLocalMinute,
  type ScoringReservation,
} from './plan-score-normalization.js';
import { timeZoneAtCoordinates } from './coordinate-time-zone.js';
import { readCachedForecast, weatherPointKey } from './weather-evidence-cache.js';
import { resolveForecastWindow } from './weather-window.js';
import { mapWithConcurrency, PROVIDER_CONCURRENCY_LIMIT } from './concurrency.js';
import { explainDay, explainTrip } from './plan-score-explanations.js';
import { readTripContext } from './trip-context.js';
import { evaluateMustGoPriorityFit, type PlanScoreFixedCommitment } from './plan-score-factors.js';
import {
  planScoreFingerprint,
  scoringInputRevision,
  scoreTrip,
  combineSignals,
  DAY_FACTOR_IDS,
  PLAN_SCORE_CONTRACT_VERSION,
  PLAN_SCORE_RUBRIC_VERSION,
  toPlanScoreDayPayload,
  UNKNOWN,
  type PlanScoreFactorResult,
} from './plan-score-rules.js';

/**
 * Plan Score for a trip, derived on demand from stored itinerary data and
 * unexpired cached route/place evidence (PRD section 29). Never acquires evidence.
 *
 * Local burden uses the day's existing route legs. Avoidable movement remains
 * unknown without evidenced feasible alternatives; no route matrix is acquired.
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
  preferences?: unknown;
  places?: Map<string, ScoringPlace>;
  forecasts?: ScoringForecast[];
  /** Public holidays by day id, from the bundled dataset. */
  holidays?: ReadonlyMap<string, { certainty: 'official' | 'expected' }>;
  /** Cached typical monthly conditions by day id; never fetched for scoring. */
  climate?: ReadonlyMap<string, ScoringClimate>;
};

function toRouteSegments(routes: ItineraryDayRoutes | undefined): ScoringRouteSegment[] {
  return (routes?.segments ?? []).map((segment) => {
    // A long-distance leg carries no estimate by design. Travel effort and pace both
    // filter on scope, so passing it through keeps flights out of local travel
    // without pretending its duration is merely unknown.
    const scope = segment.scope === 'long_distance' ? 'LONG_DISTANCE' : 'LOCAL';

    // A leg the rubric estimated from distance is an estimate, never provider evidence.
    const source = segment.estimated
      ? 'ESTIMATED'
      : segment.evidenceAsOf
        ? 'CACHED_PROVIDER'
        : 'USER_OWNED';
    return segment.durationSeconds === null
      ? {
          id: segment.id,
          scope,
          status: 'UNKNOWN',
          mode: segment.mode,
          distanceMeters: segment.distanceMeters,
          itemIds: [segment.origin.id, segment.destination.id],
        }
      : {
          duration: { minutes: segment.durationSeconds / 60, source },
          id: segment.id,
          mode: segment.mode,
          distanceMeters: segment.distanceMeters,
          itemIds: [segment.origin.id, segment.destination.id],
          scope,
          status: 'KNOWN',
        };
  });
}

function toCommitments(day: PlanScoreDayRecord): PlanScoreFixedCommitment[] {
  return day.commitments.map((commitment) => ({
    ...commitment,
    endMinute: commitment.endMinute,
    id: commitment.id,
    source: 'USER_OWNED',
    startMinute: commitment.startMinute,
  }));
}

function toDayPlaces(day: PlanScoreDayRecord, record: PlanScoreTripRecord): ScoringPlace[] {
  const ids = [
    ...new Set(day.items.flatMap((item) => (item.tripPlaceId ? [item.tripPlaceId] : []))),
  ];
  return ids.map(
    (tripPlaceId) =>
      record.places?.get(tripPlaceId) ?? {
        tripPlaceId,
        rating: record.ratings.has(tripPlaceId)
          ? { status: 'KNOWN', rating: record.ratings.get(tripPlaceId)!, source: 'CACHED_PROVIDER' }
          : { status: 'UNKNOWN' },
      },
  );
}
export type PlanScoreDayEvaluation = ReturnType<typeof evaluateScoredDay>;
type ChainPoint = ItineraryDayRoutes['segments'][number]['origin'];
/** Where a route point is, from the same owned or cached place evidence scoring reads. */
function chainLocator(day: PlanScoreDayRecord, record: PlanScoreTripRecord) {
  return (point: ChainPoint) => {
    const tripPlaceId =
      point.kind === 'itinerary_item'
        ? day.items.find((item) => item.id === point.id)?.tripPlaceId
        : point.kind === 'daily_base'
          ? point.id
          : null;
    return (tripPlaceId && record.places?.get(tripPlaceId)?.coordinates) || null;
  };
}
/** The trip's own routed legs scale every estimate, so each city estimates at its own pace. */
export function tripLegCalibration(record: PlanScoreTripRecord): LegCalibration {
  return legCalibration(
    record.days.flatMap((day) =>
      routedLegSamples([record.routes.get(day.id)], chainLocator(day, record)),
    ),
  );
}
/**
 * One day's normalized evidence, read from stored itinerary data and caches only:
 * items with stored or estimated travel, date-aware opening hours, every
 * reservation as a commitment, and the day's availability window. Plan Score and
 * the time suggester read a day through this one assembly, so they agree.
 */
export function buildScoringDay(
  day: PlanScoreDayRecord,
  record: PlanScoreTripRecord,
  calibration: LegCalibration,
) {
  const locate = chainLocator(day, record);
  const routes = withEstimatedLegs(record.routes.get(day.id), locate, calibration);
  const commitments = toCommitments(day);
  const holiday = record.holidays?.get(day.id) ?? null;
  const raw = toDayEvidenceItems(day, routes, new Map()).map((item, index) => ({
    ...item,
    placeId: day.items[index]?.tripPlaceId ?? undefined,
    inboundRequired:
      !!routes?.segments.some((s) => s.destination.id === item.id && s.scope === 'local') ||
      (index > 0 &&
        !routes?.segments.some((s) => s.destination.id === item.id && s.scope === 'long_distance')),
  }));
  const zones = new Map(
    day.items.flatMap((item) => (item.timeZone ? [[item.id, item.timeZone] as const] : [])),
  );
  const instants = new Map(
    day.items.flatMap((item) => (item.startInstant ? [[item.id, item.startInstant] as const] : [])),
  );
  const items = normalizeScoringItems(day.date, day.timeZone, raw, {
    zones,
    instants,
    hours: record.hours,
    commitments,
    holiday: holiday !== null,
  });
  const config = readDayPlanningContext(day.planningContext);
  const origin = dayOrigin(day.date, day.timeZone);
  const localMinute = (time: string) =>
    elapsedLocalMinute(
      day.date,
      day.timeZone,
      Number(time.slice(0, 2)) * 60 + Number(time.slice(3)),
      origin,
    );
  const availability = config.availability
    ? {
        startMinute: localMinute(config.availability.start),
        endMinute: localMinute(config.availability.end),
      }
    : null;
  return { availability, commitments, holiday, items, locate, origin, routes };
}

export function evaluateDayRecord(
  day: PlanScoreDayRecord,
  record: PlanScoreTripRecord,
  calibration: LegCalibration,
): PlanScoreDayEvaluation {
  const { availability, commitments, holiday, items, locate, origin, routes } = buildScoringDay(
    day,
    record,
    calibration,
  );
  return evaluateScoredDay({
    commitments,
    dayId: day.id,
    date: day.date,
    timeZone: day.timeZone,
    originInstant: origin,
    availability,
    items,
    places: toDayPlaces(day, record),
    segments: toRouteSegments(routes),
    preferences: record.preferences,
    planningContext: day.planningContext,
    forecasts: record.forecasts?.filter((f) => f.date === day.date),
    holiday,
    climate: record.climate?.get(day.id) ?? null,
    // The planned chain already runs from the day's stay and back, so the
    // comparison holds the stay fixed at both ends.
    routeComparison: estimatedRouteComparison({ segments: routes?.segments ?? [], items, locate }),
  });
}

const factorOutcomeSchema = z.union([
  z
    .object({
      state: z.literal('LIMITED'),
      coverage: z.number().min(0).max(100),
      confidence: z.number().min(0).max(100),
    })
    .strict(),
  z
    .object({
      confidence: z.number().min(0).max(100),
      coverage: z.number().min(0).max(100),
      score: z.number().min(0).max(100),
      state: z.literal('EVALUATED'),
    })
    .strict(),
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
          'REDUCE_LOAD',
          'REVIEW_TIMING',
          'LINK_PLACE',
          'EDIT_TRANSFER',
          'ADD_TIMING',
        ])
        .nullable(),
      factor: z.enum([
        'FEASIBILITY',
        'ROUTE_EFFICIENCY',
        'PACE_COMFORT',
        'EXPERIENCE_QUALITY',
        'PLAN_COMPOSITION',
        'DAILY_QUALITY',
        'DESTINATION_UTILIZATION',
        'VARIETY_COVERAGE',
        'SEASONAL_FIT',
      ]),
      code: z.string(),
      severity: z.enum(['INFO', 'RISK', 'MATERIAL', 'HARD']),
      messageKey: z.string(),
      references: z.array(z.string()),
      values: z.record(z.string(), z.union([z.number(), z.string()])),
    })
    .strict();
}

const capSchema = z
  .object({
    limit: z.number().min(0).max(100),
    reason: z.enum([
      'HARD_CONFLICT',
      'MULTIPLE_HARD_CONFLICTS',
      'MATERIAL_CONFLICT',
      'TRIP_HARD_CONFLICT',
      'TRIP_CONNECTION_CONFLICT',
    ]),
    references: z.array(z.string()),
  })
  .strict();
const referenceTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('item'), dayId: z.string().nullable() }).strict(),
  z.object({ kind: z.literal('reservation') }).strict(),
  z.object({ kind: z.literal('trip_place') }).strict(),
]);
const presentationSchema = z
  .object({
    adjustments: z.object({ fatigue: z.number().min(0), weakDays: z.number().min(0) }).strict(),
    referenceTargets: z.record(z.string(), referenceTargetSchema).optional(),
    revisions: z
      .object({ planning: z.string(), evidence: z.string(), destinationContext: z.string() })
      .strict(),
  })
  .strict();
const assessmentBasisSchema = z.array(
  z.enum(['TIMING', 'ACTIVITY_LOAD', 'VERIFIED_PROBLEM', 'REST']),
);
const limitationsSchema = z.array(
  z.enum([
    'TRAVEL_TIME_UNKNOWN',
    'TRAVEL_TIME_ESTIMATED',
    'DURATION_ESTIMATED',
    'LOAD_INCOMPLETE',
    'TIMING_UNKNOWN',
    'VENUE_EVIDENCE_INCOMPLETE',
    'UNASSESSED_DAYS',
    'DETAIL_MISSING',
  ]),
);
const tripPlanScoreSchema = z
  .object({
    days: z.array(
      z
        .object({
          assessmentStatus: z.enum(['available', 'provisional', 'unavailable']),
          assessmentBasis: assessmentBasisSchema,
          limitations: limitationsSchema,
          completeness: z.number(),
          confidence: z.number().nullable(),
          date: z.string(),
          dayId: z.string(),
          explanations: explanationGroupsSchema,
          factors: z
            .object(Object.fromEntries(DAY_FACTOR_IDS.map((id) => [id, factorOutcomeSchema])))
            .strict(),
          caps: z.array(capSchema),
          score: z.number().nullable(),
          withheldReasons: z.array(z.string()),
        })
        .strict(),
    ),
    schemaVersion: z.literal(PLAN_SCORE_CONTRACT_VERSION),
    rubricVersion: z.literal(PLAN_SCORE_RUBRIC_VERSION),
    assessmentStatus: z.enum(['available', 'provisional', 'unavailable']),
    assessmentBasis: assessmentBasisSchema,
    limitations: limitationsSchema,
    assessedDayCount: z.number().int().nonnegative(),
    applicableDayCount: z.number().int().nonnegative(),
    evidenceCoverage: z.number().min(0).max(100),
    explanations: explanationGroupsSchema,
    completeness: z.number(),
    confidence: z.number().nullable(),
    caps: z.array(capSchema),
    components: z
      .object({
        DAILY_QUALITY: factorOutcomeSchema,
        DESTINATION_UTILIZATION: factorOutcomeSchema,
        VARIETY_COVERAGE: factorOutcomeSchema,
        SEASONAL_FIT: factorOutcomeSchema,
      })
      .strict(),
    fingerprint: z.string(),
    generatedAt: z.string(),
    evidenceAsOf: z.string().nullable().optional(),
    sourceInputRevision: z.string().optional(),
    presentation: presentationSchema.optional(),
    recomputeAfter: z.string().datetime(),
    evidenceExpiresAt: z.string().datetime().nullable(),
    evidenceRevision: z.string().optional(),
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
    assessmentStatus: 'unavailable',
    withheldReasons: [...new Set([...score.withheldReasons, 'EVIDENCE_NOT_CURRENT' as const])],
    days: score.days.map((day) => ({
      ...day,
      score: null,
      assessmentStatus: 'unavailable',
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
  evidenceDeadlines?: readonly string[];
}): TripPlanScore {
  const generatedAt = (input.evaluatedAt ?? new Date()).toISOString();
  const evaluatedMs = Date.parse(generatedAt);
  // Invalid, future, or expired optional revisions cannot shorten an otherwise
  // useful assessment. The readers themselves omit their associated fields.
  const evidenceTimes = [...new Set(input.evidenceTimes ?? [])].filter((at) => {
    const acquired = Date.parse(at);
    return (
      Number.isFinite(acquired) &&
      acquired <= evaluatedMs &&
      acquired + PLACE_EVIDENCE_TTL_MS > evaluatedMs
    );
  });
  const evidenceDeadlines = [...new Set(input.evidenceDeadlines ?? [])].filter((at) => {
    const deadline = Date.parse(at);
    return Number.isFinite(deadline) && deadline > evaluatedMs;
  });
  const evaluations = input.days.toSorted((a, b) => a.date.localeCompare(b.date));
  const mustGo = evaluateMustGoPriorityFit({
    mustGoTripPlaceIds: input.mustGoIds,
    scheduledTripPlaceIds: input.scheduledIds,
    source: 'USER_OWNED',
  });
  const mean = (key: 'utilization' | 'variety' | 'seasonalFit') =>
    combineSignals(evaluations.map((e) => ({ weight: 1, result: e.evaluation[key] })));
  const requested = [...new Set(evaluations.flatMap((e) => e.evaluation.requestedInterests))];
  const interests = [
    ...new Map(
      evaluations.flatMap((e) => e.evaluation.interestEvidence).map((e) => [e.ref, e]),
    ).values(),
  ];
  const covered = new Set(interests.map((e) => e.interest));
  // Complementary days can cover explicit interests collectively. Unmatched
  // interests are unknown, never a claim that the traveller skipped a landmark.
  const tripVariety: PlanScoreFactorResult =
    requested.length >= 2 && covered.size
      ? {
          state: 'EVALUATED',
          score: 100,
          coverage: (100 * covered.size) / requested.length,
          evidence: interests,
        }
      : mean('variety');
  const tripInput = {
    days: evaluations.map(({ date, evaluation }) => ({ ...evaluation.input, date })),
    components: {
      // Without Must Go places there is nothing yet to check the plan against:
      // that is missing detail the traveller can add, not an inapplicable row.
      DESTINATION_UTILIZATION: combineSignals([
        { weight: 1, result: mustGo.state === 'NOT_APPLICABLE' ? UNKNOWN : mustGo },
        { weight: 1, result: mean('utilization') },
      ]),
      VARIETY_COVERAGE: tripVariety,
      SEASONAL_FIT: mean('seasonalFit'),
    },
  };
  const result = scoreTrip(tripInput);
  const scheduled = new Set(input.scheduledIds);
  const intrinsic = result.days
    .flatMap((day) => (day.intrinsicScore === null ? [] : [day.intrinsicScore]))
    .sort((a, b) => a - b);
  const weakestBoundary = intrinsic[Math.max(0, Math.ceil(intrinsic.length * 0.2) - 1)];
  const tripExplanations = explainTrip({
    components: result.components,
    caps: result.caps,
    unscheduledMustGoTripPlaceIds: input.mustGoIds.filter((id) => !scheduled.has(id)),
    fatigueAdjustment: result.fatigueAdjustment,
    weakDayAdjustment: result.weakDayAdjustment,
    fatigueDayIds: result.days.filter((day) => day.incomingDebt > 0).map((day) => day.dayId),
    weakDayIds: result.days
      .filter(
        (day) =>
          day.intrinsicScore !== null &&
          weakestBoundary !== undefined &&
          day.intrinsicScore <= weakestBoundary,
      )
      .map((day) => day.dayId),
    seasonalDayIds: {
      wet: evaluations.flatMap((e) =>
        e.evaluation.seasonal.wet ? [e.evaluation.input.dayId] : [],
      ),
      heat: evaluations.flatMap((e) =>
        e.evaluation.seasonal.heat ? [e.evaluation.input.dayId] : [],
      ),
    },
  });
  return {
    schemaVersion: PLAN_SCORE_CONTRACT_VERSION,
    rubricVersion: PLAN_SCORE_RUBRIC_VERSION,
    assessmentStatus: result.assessmentStatus,
    assessmentBasis: result.assessmentBasis,
    limitations: result.limitations,
    assessedDayCount: result.assessedDayCount,
    applicableDayCount: result.applicableDayCount,
    evidenceCoverage: result.evidenceCoverage,
    completeness: result.completeness,
    confidence: result.confidence,
    caps: result.caps,
    components: result.components,
    days: result.days.map((dayResult, index) => {
      const entry = evaluations[index];
      const explained = explainDay({
        alternatives: [],
        conflicts: entry?.evaluation.conflicts ?? [],
        day: dayResult,
        pace: entry?.evaluation.pace ?? { activeMinutes: null, smallestBufferMinutes: null },
        route: entry?.evaluation.route ?? { bestMinutes: null, plannedMinutes: null },
        travel: entry?.evaluation.travel ?? { totalMinutes: null },
        advisories: entry?.evaluation.advisories,
        experience: entry?.evaluation.experience,
      });
      return {
        ...toPlanScoreDayPayload(dayResult),
        date: entry?.date ?? '',
        explanations: {
          ...explained,
          // Shown on scored and withheld days alike: adding the detail is how
          // a day gets a fuller, higher score.
          worthImproving: [
            ...explained.worthImproving,
            ...(entry?.evaluation.detailNudges ?? []).map((reason) => ({
              ...reason,
              values: { ...reason.values, day: index + 1 },
            })),
          ],
          uncertainty: [
            ...(entry?.evaluation.missingInformation ?? []),
            ...dayResult.filledFactors.map(rowNeedsDetail),
          ].map((reason) => ({
            ...reason,
            values: { ...reason.values, day: index + 1 },
          })),
        },
      };
    }),
    explanations: {
      ...tripExplanations,
      worthImproving: [
        ...tripExplanations.worthImproving,
        ...tripDetailNudges(evaluations.map((entry) => entry.evaluation.detailNudges)),
      ],
      uncertainty: [
        ...evaluations.flatMap((entry, index) =>
          entry.evaluation.missingInformation.map((reason) => ({
            ...reason,
            values: { ...reason.values, day: index + 1 },
          })),
        ),
        ...result.filledComponents.map(rowNeedsDetail),
      ],
    },
    presentation: {
      adjustments: {
        fatigue: Math.round(result.fatigueAdjustment),
        weakDays: Math.round(result.weakDayAdjustment),
      },
      revisions: {
        planning: '',
        evidence: '',
        // Callers that read destination context set its revision.
        destinationContext: '',
      },
    },
    fingerprint: scoringInputRevision({
      evaluation: planScoreFingerprint(tripInput),
      evidenceTimes: evidenceTimes.toSorted(),
      evidenceDeadlines: evidenceDeadlines.toSorted(),
    }),
    generatedAt,
    recomputeAfter: new Date(
      Math.min(
        Date.parse(generatedAt) + 24 * 60 * 60 * 1000,
        ...evidenceTimes.map((at) => Date.parse(at) + PLACE_EVIDENCE_TTL_MS),
        ...evidenceDeadlines.map(Date.parse),
      ),
    ).toISOString(),
    evidenceExpiresAt: evidenceDeadline([
      ...evidenceTimes.map((at) => Date.parse(at) + PLACE_EVIDENCE_TTL_MS),
      ...evidenceDeadlines.map(Date.parse),
    ]),
    evidenceAsOf: oldestPlanScoreEvidenceAt(generatedAt, evidenceTimes),
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
  options: {
    evaluatedAt?: Date;
    evidenceTimes?: readonly string[];
    evidenceDeadlines?: readonly string[];
  } = {},
): TripPlanScore {
  const calibration = tripLegCalibration(record);
  return buildPlanScoreFromEvaluations({
    ...options,
    days: record.days.map((day) => ({
      date: day.date,
      evaluation: evaluateDayRecord(day, record, calibration),
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
  readEvidence: typeof readScoringPlace = readScoringPlace,
) {
  const hours: PlaceHoursEvidence = new Map();
  const ratings = new Map<string, number>();

  const places = new Map<string, ScoringPlace>();
  const requests = [
    ...new Set(tripPlaces.flatMap((p) => (p.externalPlaceId ? [p.externalPlaceId] : []))),
  ];
  const fetched = new Map(
    await mapWithConcurrency(
      requests,
      PROVIDER_CONCURRENCY_LIMIT,
      async (externalPlaceId) =>
        [externalPlaceId, await readEvidence({ externalPlaceId }, now)] as const,
    ),
  );
  const times: string[] = [];
  for (const entry of tripPlaces) {
    const details = entry.externalPlaceId ? fetched.get(entry.externalPlaceId) : null;
    if (!details || details.status !== 'ok') continue;
    const place = details.place;
    times.push(details.freshness.fetchedAt);
    if (place.rating !== null) ratings.set(entry.id, place.rating);
    places.set(entry.id, {
      tripPlaceId: entry.id,
      name: place.name,
      types: place.rawTypes,
      coordinates: place.location,
      source: 'CACHED_PROVIDER',
      fieldEvidence: {
        identity: {
          acquiredAt: details.freshness.fetchedAt,
          expiresAt: new Date(
            Date.parse(details.freshness.fetchedAt) + PLACE_EVIDENCE_TTL_MS,
          ).toISOString(),
        },
        ...Object.fromEntries(
          ['coordinates', 'types', 'name', 'rating', 'hours'].map((field) => [
            field,
            {
              acquiredAt: details.freshness.fetchedAt,
              expiresAt: new Date(
                Date.parse(details.freshness.fetchedAt) + PLACE_EVIDENCE_TTL_MS,
              ).toISOString(),
            },
          ]),
        ),
      },
      rating:
        place.rating === null
          ? { status: 'UNKNOWN' }
          : {
              status: 'KNOWN',
              rating: place.rating,
              reviewCount: place.userRatingCount,
              source: 'CACHED_PROVIDER',
            },
    });
    hours.set(entry.id, {
      source: 'CACHED_PROVIDER',
      periods: place.openingPeriods,
      utcOffsetMinutes: place.utcOffsetMinutes,
      timeZone: place.location ? timeZoneAtCoordinates(place.location) : null,
      fetchedAt: details.freshness.fetchedAt,
      currentPeriods: place.currentOpeningPeriods,
      validFrom: place.currentHoursValidFrom,
      validThrough: place.currentHoursValidThrough,
    });
  }

  discardExpiredCurrentHours(hours, now);
  return {
    hours,
    ratings,
    places,
    evidenceTimes: [...new Set(times)],
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
    planningContext?: unknown;
    items: Array<{
      _count: { reservations: number };
      blockType?: string | null;
      dayPart: string | null;
      durationMinutes: number | null;
      durationProvenance: string;
      id: string;
      localStartTime: Date | null;
      startInstant: Date | null;
      timeSemantics: string | null;
      timeProvenance: string | null;
      timingFlexibility?: string | null;
      travelStatus?: string;
      timeZone: string | null;
      tripPlaceId: string | null;
    }>;
  },
  commitments: PlanScoreFixedCommitment[],
): PlanScoreDayRecord {
  const date = toLocalDate(day.date);
  return {
    commitments,
    planningContext: day.planningContext,
    date,
    id: day.id,
    items: day.items.map((item) => ({
      blockType: item.blockType ?? null,
      dayPart: item.dayPart,
      durationMinutes: item.durationMinutes,
      durationProvenance: item.durationProvenance,
      id: item.id,
      localStartTime: item.localStartTime,
      reservationCount: item._count.reservations,
      startInstant: item.startInstant,
      timeSemantics: item.timeSemantics,
      timeProvenance: item.timeProvenance,
      timingFlexibility: item.timingFlexibility,
      travelStatus: item.travelStatus,
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
      itineraryItemId: true,
      type: true,
      // A booked stay moves where the day's legs start and end, so it belongs
      // in the planning revision the scorer is cached against.
      tripPlaceId: true,
      checkInDate: true,
      checkOutDate: true,
      accommodationDays: { select: { itineraryDayId: true } },
      transportPickupLocation: true,
      transportDropoffLocation: true,
      localDate: true,
      localTime: true,
      timeZone: true,
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
      blockType?: string | null;
      dayPart: string | null;
      durationMinutes: number | null;
      durationProvenance: string;
      id: string;
      localStartTime: Date | null;
      position: number;
      startInstant: Date | null;
      timeSemantics: string | null;
      timeProvenance: string | null;
      timingFlexibility?: string | null;
      travelStatus?: string;
      timeZone: string | null;
      travelModeToNext: string | null;
      tripPlaceId: string | null;
    }>;
    routeStartTravelMode: string;
    planningContext?: unknown;
  }>;
  reservations: ScoringReservation[];
  tripPlaces: Array<{
    id: string;
    placeId?: string;
    priority: string | null;
    place?: OwnedContextPlace;
  }>;
};

/**
 * A destination or booking endpoint as a comparable name: the part before the
 * first comma, so "Kyoto, Japan" and "Kyoto" are the same place. Only the
 * trip's own destinations are compared, never a list authored in Trove.
 */
function destinationName(value: string | null | undefined) {
  return value?.split(',')[0]?.normalize('NFKC').toLowerCase().trim() || null;
}

/** The single reading of a trip that both the digest and the scorer are built on. */
export function readPlanScoreInputs(trip: PlanScoreTripRows, now = new Date()) {
  const destinations: Array<{ timeZone?: string | null; place?: OwnedContextPlace }> =
    Array.isArray(trip.destinations) ? trip.destinations : [];
  const zones = destinations.flatMap((d) => (d.timeZone ? [d.timeZone] : []));
  const identities = destinations.flatMap((d) => {
    const name = d.place ? destinationName(contextPlaceFromOwnedData(d.place, now).name) : null;
    return name ? [name] : [];
  });
  const reservations = trip.reservations.map((r) => {
    const fromZone = r.flightDepartureTimeZone ?? r.transportDepartureTimeZone;
    const toZone = r.flightArrivalTimeZone ?? r.transportArrivalTimeZone;
    const from = destinationName(r.transportPickupLocation),
      to = destinationName(r.transportDropoffLocation);
    // An owned booking between two unambiguously identified trip destinations is
    // an indispensable connection. Ambiguous endpoints remain unknown.
    const zoned =
      fromZone &&
      toZone &&
      fromZone !== toZone &&
      zones.filter((z) => z === fromZone).length === 1 &&
      zones.filter((z) => z === toZone).length === 1;
    const named = from && to && from !== to && identities.includes(from) && identities.includes(to);
    return { ...r, indispensable: Boolean(zoned || named) };
  });

  const mustGoTripPlaceIds = trip.tripPlaces
    .filter((tripPlace) => tripPlace.priority === 'MUST_GO')
    .map((tripPlace) => tripPlace.id);
  const days = trip.itineraryDays.map((day) =>
    toPlanScoreDayRecord(
      day,
      scoringCommitments(reservations, toLocalDate(day.date), day.defaultTimeZone),
    ),
  );
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

  const planningRevision = tripPlanScoreRevision({
    context: {
      preferences: readTripPlanningPreferences(trip.planningPreferences),
      days: trip.itineraryDays.map((day) => readDayPlanningContext(day.planningContext)),
      endDate: trip.endDate,
      destinations: destinations.map((d) => {
        const owned = d as {
          id?: string;
          placeId?: string;
          position?: number;
          timeZone?: string | null;
        };
        return {
          id: owned.id,
          placeId: owned.placeId,
          position: owned.position,
          timeZone: owned.timeZone,
          place: d.place
            ? {
                customName: d.place.customName,
                providerLabel: d.place.providerLabel,
                latitude: d.place.customLatitude == null ? null : String(d.place.customLatitude),
                longitude: d.place.customLongitude == null ? null : String(d.place.customLongitude),
              }
            : null,
        };
      }),
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
      .map(({ id, placeId, place }) => ({
        id,
        placeId: placeId ?? null,
        customName: place?.customName,
        providerLabel: place?.providerLabel,
        latitude: place?.customLatitude == null ? null : String(place.customLatitude),
        longitude: place?.customLongitude == null ? null : String(place.customLongitude),
      })),
  });
  return {
    days,
    mustGoTripPlaceIds,
    planningRevision,
    revision: scoringInputRevision({ planningRevision }),
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
  remainingSnapshotRetry = 1,
): Promise<TripPlanScore | null> {
  const now = services.now?.() ?? new Date();
  // Preserve the administrative visibility switch. Scoring now makes zero
  // provider requests whether enabled or disabled; AI review uses the same visibility switch.
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
    planningRevision,
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

  for (const row of trip.tripPlaces) {
    const merged = mergeScoringPlaceIdentity(
      row.id,
      row.place,
      placeEvidence.places.get(row.id),
      now,
    );
    placeEvidence.places.set(row.id, merged.place);
    const hours = placeEvidence.hours.get(row.id);
    if (hours && !hours.timeZone && merged.place.coordinates)
      hours.timeZone = timeZoneAtCoordinates(merged.place.coordinates);
    if (scheduledTripPlaceIds.has(row.id)) placeEvidence.evidenceTimes.push(...merged.times);
  }
  discardExpiredCurrentHours(placeEvidence.hours, now);
  const [forecastEvidence, destination] = await Promise.all([
    loadScoringForecasts(dayRecords, placeEvidence.places, now),
    readScoringDestinationContext(userId, tripId, now),
  ]);
  const destinationRevision = scoringInputRevision({
    holidays: [...destination.holidays],
    climate: [...destination.climate],
    climateTimes: destination.climateTimes,
  });
  const evidenceRevision = tripPlanScoreRevision({
    days: [],
    mustGoTripPlaceIds: [],
    context: {
      hours: [...placeEvidence.hours],
      ratings: [...placeEvidence.ratings],
      places: [...placeEvidence.places],
      forecasts: forecastEvidence.forecasts,
      destination: destinationRevision,
      evidenceTimes: [
        ...placeEvidence.evidenceTimes,
        ...forecastEvidence.times,
        ...destination.climateTimes,
      ],
      routes: routeResults.map(({ id, routes }) => ({
        id,
        segments: routes.segments,
        summary: routes.summary,
      })),
    },
  });
  const stillCurrent = async () => {
    const latest = await prisma.trip.findFirst({
      where: { id: tripId, ownerId: userId },
      include: PLAN_SCORE_TRIP_INCLUDE,
    });
    if (!latest) throw new ItineraryNotFoundError('trip_not_found');
    return readPlanScoreInputs(latest, services.now?.() ?? new Date()).revision === revision;
  };
  const superseded = async (): Promise<TripPlanScore | null> => {
    if (remainingSnapshotRetry > 0)
      return getTripPlanScore(userId, tripId, services, remainingSnapshotRetry - 1);
    throw new Error('plan_score_inputs_changed_during_read');
  };
  const cached = readCachedPlanScore(trip, revision, now, evidenceRevision);
  if (cached) return (await stillCurrent()) ? cached : superseded();
  const evaluatedAt = services.now?.() ?? new Date();
  const rawEvidenceDeadlines = [
    ...trip.tripPlaces.flatMap((row) => {
      const own = contextPlaceFromOwnedData(row.place, now);
      return scheduledTripPlaceIds.has(row.id) && own.expiresAt ? [Date.parse(own.expiresAt)] : [];
    }),
    ...forecastEvidence.deadlines,
    ...destination.climateTimes.map((at) => Date.parse(at) + WEATHER_CACHE_POLICY.seasonalMs),
    ...placeEvidence.evidenceTimes.map((at) => Date.parse(at) + PLACE_EVIDENCE_TTL_MS),
    ...placeHoursDeadlines(placeEvidence.hours, dayRecords).map(Date.parse),
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
  ];
  if (
    remainingSnapshotRetry > 0 &&
    rawEvidenceDeadlines.some(
      (deadline) =>
        Number.isFinite(deadline) && deadline > now.getTime() && deadline <= evaluatedAt.getTime(),
    )
  )
    return getTripPlanScore(userId, tripId, services, remainingSnapshotRetry - 1);
  const result = buildTripPlanScore(
    {
      days: dayRecords,
      preferences: trip.planningPreferences,
      places: placeEvidence.places,
      forecasts: forecastEvidence.forecasts,
      holidays: destination.holidays,
      climate: destination.climate,
      hours: placeEvidence.hours,
      mustGoTripPlaceIds,
      ratings: placeEvidence.ratings,
      routes: new Map(routeResults.map(({ id, routes }) => [id, routes])),
    },
    {
      evaluatedAt,
      evidenceTimes: [
        ...(placeEvidence.evidenceTimes ?? []),
        ...forecastEvidence.times,
        ...destination.climateTimes,
        ...routeResults.flatMap(({ routes }) =>
          routes.segments.flatMap((segment) =>
            segment.evidenceAsOf ? [segment.evidenceAsOf] : [],
          ),
        ),
      ],
    },
  );

  result.evidenceRevision = evidenceRevision;
  if (result.presentation)
    result.presentation.referenceTargets = planScoreReferenceTargets(result, {
      items: trip.itineraryDays.flatMap((day) =>
        day.items.map((item) => ({ id: item.id, dayId: day.id })),
      ),
      reservationIds: trip.reservations.map((reservation) => reservation.id),
      tripPlaceIds: trip.tripPlaces.map((place) => place.id),
    });
  if (result.presentation)
    result.presentation.revisions = {
      planning: planningRevision,
      evidence: evidenceRevision,
      destinationContext: destinationRevision,
    };
  result.fingerprint = scoringInputRevision({
    assessment: result.fingerprint,
    inputRevision: revision,
    evidenceRevision,
  });
  result.evidenceExpiresAt = evidenceDeadline(
    rawEvidenceDeadlines.filter(
      (deadline) => Number.isFinite(deadline) && deadline > evaluatedAt.getTime(),
    ),
  );
  result.recomputeAfter = new Date(
    Math.min(
      evaluatedAt.getTime() + 24 * 60 * 60 * 1000,
      result.evidenceExpiresAt ? Date.parse(result.evidenceExpiresAt) : Infinity,
    ),
  ).toISOString();
  if (
    result.evidenceExpiresAt &&
    Date.parse(result.evidenceExpiresAt) <= evaluatedAt.getTime() &&
    remainingSnapshotRetry > 0
  )
    return getTripPlanScore(userId, tripId, services, remainingSnapshotRetry - 1);
  const current = withholdNonCurrentPlanScore(result, evaluatedAt);
  if (!(await stillCurrent())) return superseded();
  await writeCachedPlanScore(prisma, trip.id, current, revision);
  return current;
}

/** Holidays and typical conditions by day id, as scoring inputs. */
export function destinationContextByDay(context: Pick<TripContext, 'holidays' | 'climate'>) {
  const holidays = new Map<string, { certainty: 'official' | 'expected' }>();
  for (const holiday of context.holidays)
    for (const dayId of holiday.dayIds)
      if (holidays.get(dayId)?.certainty !== 'official')
        holidays.set(dayId, { certainty: holiday.certainty });
  const climate = new Map<string, ScoringClimate>();
  for (const norm of context.climate)
    for (const dayId of norm.dayIds)
      climate.set(dayId, {
        temperatureMaxC: norm.temperatureMaxC,
        temperatureMinC: norm.temperatureMinC,
        wetDayShare: norm.wetDayShare,
      });
  return {
    holidays,
    climate,
    climateTimes: context.climate.flatMap((norm) => (norm.fetchedAt ? [norm.fetchedAt] : [])),
  };
}

/**
 * The trip's holidays and typical conditions, placed on its days exactly as
 * Insights places them. Climate is read from the cache only, so scoring never
 * reaches the archive; a cold cache leaves seasonal fit unknown until Insights
 * fills it. Context never fails a score: unreadable context is simply absent.
 */
async function readScoringDestinationContext(userId: string, tripId: string, now: Date) {
  try {
    return destinationContextByDay(
      await readTripContext(userId, tripId, { now, allowFetch: false, source: 'plan-score' }),
    );
  } catch {
    return destinationContextByDay({ holidays: [], climate: [] });
  }
}

/** Reads each already-cached weather point once, only within its current horizon. */
export async function loadScoringForecasts(
  days: readonly {
    date: string;
    timeZone: string;
    items: readonly { tripPlaceId: string | null }[];
  }[],
  places: ReadonlyMap<string, ScoringPlace>,
  now: Date,
) {
  const grouped = new Map<
    string,
    {
      point: { latitude: number; longitude: number; timeZone?: string };
      ids: string[];
      dates: string[];
      zone: string;
    }
  >();
  for (const day of days) {
    const horizon = resolveForecastWindow([day.timeZone], now);
    if (day.date < horizon.startDate || day.date > horizon.endDate) continue;
    for (const item of day.items) {
      const place = item.tripPlaceId ? places.get(item.tripPlaceId) : null;
      if (!place?.coordinates) continue;
      const point = { ...place.coordinates, timeZone: day.timeZone };
      const key = weatherPointKey(point);
      const group = grouped.get(key) ?? {
        point,
        ids: [],
        dates: [],
        zone: day.timeZone,
      };
      if (!group.ids.includes(place.tripPlaceId)) group.ids.push(place.tripPlaceId);
      if (!group.dates.includes(day.date)) group.dates.push(day.date);
      grouped.set(key, group);
    }
  }
  const forecasts: ScoringForecast[] = [],
    times: string[] = [],
    deadlines: number[] = [];
  await mapWithConcurrency([...grouped.values()], PROVIDER_CONCURRENCY_LIMIT, async (group) => {
    const dates = group.dates.toSorted();
    const result = await readCachedForecast(
      group.point,
      { startDate: dates[0]!, endDate: dates.at(-1)! },
      now,
    );
    if (result.kind !== 'hit') return;
    times.push(result.forecast.fetchedAt.toISOString());
    deadlines.push(
      ...dates.map(
        (date) =>
          result.forecast.fetchedAt.getTime() +
          weatherDailyTtl(date, result.forecast.location.timeZone, now),
      ),
    );
    for (const day of result.forecast.days)
      if (dates.includes(day.date))
        forecasts.push({
          date: day.date,
          precipitationProbability: day.precipitationProbability,
          source: 'CACHED_PROVIDER',
          placeIds: group.ids,
        });
  });
  return {
    forecasts: forecasts.toSorted(
      (a, b) => a.date.localeCompare(b.date) || a.placeIds.join().localeCompare(b.placeIds.join()),
    ),
    times: [...new Set(times)].sort(),
    deadlines,
  };
}

/**
 * Why a category or component shows a low, filled number: what the traveller
 * could add for it to be judged on the plan itself. It belongs to its row, so
 * it carries no action and never repeats in the list of problems.
 */
function rowNeedsDetail(factor: PlanScoreExplanation['factor']): PlanScoreExplanation {
  return {
    action: null,
    code: 'ROW_NEEDS_DETAIL',
    factor,
    messageKey: `rowReasons.${factor}`,
    references: [],
    severity: 'INFO',
    values: {},
  };
}

/**
 * One trip-wide nudge per kind of missing detail, naming every stop, rather
 * than one per day crowding out the problems that matter more.
 */
function tripDetailNudges(days: readonly PlanScoreExplanation[][]): PlanScoreExplanation[] {
  const codes = [...new Set(days.flat().map((reason) => reason.code))];
  return codes.map((code) => {
    const entries = days.flat().filter((reason) => reason.code === code);
    const references = entries.flatMap((reason) => reason.references);
    return {
      ...entries[0]!,
      messageKey: `${entries[0]!.messageKey}Trip`,
      references,
      values: { count: references.length },
    };
  });
}

function evidenceDeadline(deadlines: number[]): string | null {
  const finite = deadlines.filter(Number.isFinite);
  return finite.length ? new Date(Math.min(...finite)).toISOString() : null;
}

/** Merge independently acquired fields without changing either snapshot's age. */
export function mergeScoringPlaceIdentity(
  id: string,
  owned: OwnedContextPlace,
  rich: ScoringPlace | undefined,
  now: Date,
) {
  const own = contextPlaceFromOwnedData(owned, now);
  const reference = owned.providerRefs?.find(
    (r) =>
      r.cachedAt &&
      now.getTime() >= r.cachedAt.getTime() &&
      now.getTime() - r.cachedAt.getTime() < PLACE_EVIDENCE_TTL_MS,
  );
  const identityAt = reference?.cachedAt?.toISOString() ?? null;
  const ownStamp = { acquiredAt: identityAt, expiresAt: own.expiresAt ?? null };
  const fields = { ...rich?.fieldEvidence };
  const choose = <T>(
    field: 'coordinates' | 'types' | 'name',
    existing: T | null | undefined,
    fallback: T | null | undefined,
  ) => {
    const stamp = rich?.fieldEvidence?.[field] ?? rich?.fieldEvidence?.identity;
    const hasExisting =
      existing != null && (!Array.isArray(existing) || existing.length > 0) && existing !== '';
    const hasFallback =
      fallback != null && (!Array.isArray(fallback) || fallback.length > 0) && fallback !== '';
    const newer = identityAt && (!stamp?.acquiredAt || identityAt > stamp.acquiredAt);
    if (hasFallback && (!hasExisting || newer)) {
      fields[field] = ownStamp;
      return fallback;
    }
    if (hasExisting) {
      fields[field] = stamp;
      return existing;
    }
    return fallback ?? existing;
  };
  const customCoordinates = owned.customLatitude != null && owned.customLongitude != null;
  const coordinates = customCoordinates
    ? own.coordinates
    : choose('coordinates', rich?.coordinates, own.coordinates);
  if (customCoordinates) fields.coordinates = { acquiredAt: null, expiresAt: null };
  const name = owned.customName ?? choose('name', rich?.name, own.name);
  if (owned.customName) fields.name = { acquiredAt: null, expiresAt: null };
  const types = choose('types', rich?.types, reference?.cachedTypes);
  fields.identity =
    identityAt &&
    (!rich?.fieldEvidence?.identity?.acquiredAt ||
      identityAt > rich.fieldEvidence.identity.acquiredAt)
      ? ownStamp
      : (rich?.fieldEvidence?.identity ?? ownStamp);
  return {
    place: {
      ...rich,
      tripPlaceId: id,
      name,
      coordinates,
      linked: Boolean(owned.providerRefs?.length),
      types: types ?? [],
      source: rich?.source ?? (reference ? 'CACHED_PROVIDER' : 'USER_OWNED'),
      rating: rich?.rating ?? { status: 'UNKNOWN' as const },
      fieldEvidence: fields,
    } satisfies ScoringPlace,
    times: identityAt ? [identityAt] : [],
  };
}

/** Qualify date-specific hours after coordinates from either owned snapshot establish the zone. */
export function discardExpiredCurrentHours(hours: PlaceHoursEvidence, now: Date) {
  for (const entry of hours.values()) {
    if (!entry.currentPeriods || !entry.validThrough || !entry.timeZone) continue;
    const after = new Date(Date.parse(`${entry.validThrough}T00:00:00Z`) + 86400000)
      .toISOString()
      .slice(0, 10);
    if (dayOrigin(after, entry.timeZone) <= now.getTime()) entry.currentPeriods = undefined;
  }
}

/** Only date-specific hours actually used by these days contribute a deadline. */
export function placeHoursDeadlines(
  hours: PlaceHoursEvidence,
  days: readonly {
    date: string;
    items: readonly { tripPlaceId: string | null; blockType?: string | null }[];
  }[],
) {
  return [
    ...new Set(
      days.flatMap((day) =>
        day.items.flatMap((item) => {
          if (item.blockType && item.blockType !== 'activity') return [];
          const entry = item.tripPlaceId ? hours.get(item.tripPlaceId) : null;
          if (
            !entry?.currentPeriods ||
            !entry.validFrom ||
            !entry.validThrough ||
            day.date < entry.validFrom ||
            day.date > entry.validThrough
          )
            return [];
          const zone = entry.timeZone;
          if (!zone) return [];
          const after = new Date(Date.parse(`${entry.validThrough}T00:00:00Z`) + 86400000)
            .toISOString()
            .slice(0, 10);
          return [new Date(dayOrigin(after, zone)).toISOString()];
        }),
      ),
    ),
  ];
}
