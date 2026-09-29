import { createHash } from 'node:crypto';
import type {
  PlanScoreAssessmentBasis,
  PlanScoreLimitation,
  PlanScoreCap,
  PlanScoreDayFactorId,
  PlanScoreDayPayload,
  PlanScoreDayWithheldReason,
  PlanScoreFactorOutcome,
  PlanScoreTripComponentId,
  PlanScoreTripPayload,
  PlanScoreTripWithheldReason,
  PlanScoreUnknownReason,
} from '@trove/types';
export type {
  PlanScoreDayFactorId,
  PlanScoreDayPayload,
  PlanScoreDayWithheldReason,
  PlanScoreFactorOutcome,
  PlanScoreTripPayload,
  PlanScoreTripWithheldReason,
  PlanScoreUnknownReason,
} from '@trove/types';
export const PLAN_SCORE_CONTRACT_VERSION = 7;
export const DAY_FACTOR_IDS = [
  'FEASIBILITY',
  'ROUTE_EFFICIENCY',
  'PACE_COMFORT',
  'EXPERIENCE_QUALITY',
  'PLAN_COMPOSITION',
] as const;
const BASE_WEIGHTS: Record<PlanScoreDayFactorId, number> = {
  FEASIBILITY: 35,
  ROUTE_EFFICIENCY: 20,
  PACE_COMFORT: 20,
  EXPERIENCE_QUALITY: 15,
  PLAN_COMPOSITION: 10,
};
const TRIP_WEIGHTS = {
  DAILY_QUALITY: 65,
  DESTINATION_UTILIZATION: 15,
  VARIETY_COVERAGE: 10,
  SEASONAL_FIT: 10,
};
export type PlanScoreEvidenceSource =
  'CACHED_PROVIDER' | 'ESTIMATED' | 'FRESH_PROVIDER' | 'STALE' | 'USER_OWNED';
const RELIABILITY = {
  CACHED_PROVIDER: 75,
  ESTIMATED: 50,
  FRESH_PROVIDER: 100,
  STALE: 25,
  USER_OWNED: 100,
};
export type PlanScoreEvidence = { ref: string; source: PlanScoreEvidenceSource; strength?: number };
export type PlanScoreFactorResult =
  | {
      evidence: PlanScoreEvidence[];
      score: number;
      state: 'EVALUATED';
      coverage?: number;
      confidence?: number;
    }
  | { reason: PlanScoreUnknownReason; state: 'UNKNOWN' }
  | { state: 'NOT_APPLICABLE' };
export const UNKNOWN: PlanScoreFactorResult = { reason: 'MISSING_EVIDENCE', state: 'UNKNOWN' };
export const NOT_APPLICABLE: PlanScoreFactorResult = { state: 'NOT_APPLICABLE' };
export type PlanScoreDayInput = {
  dayId: string;
  factors: Partial<Record<PlanScoreDayFactorId, PlanScoreFactorResult>>;
  date?: string;
  availableMinutes?: number | null;
  loadRatio?: number | null;
  rest?: boolean;
  /** Established by the shared normalized evaluator, never by category coverage. */
  assessmentBasis?: PlanScoreAssessmentBasis[];
  limitations?: PlanScoreLimitation[];
  /** Known subtotal, used only to prove increased fatigue, never recovery. */
  partialLoadRatio?: number | null;
  hardConflictIds?: string[];
  materialConflictIds?: string[];
  indispensableConnectionConflict?: boolean;
  normalizedRevision?: string;
  conflictReferences?: Record<string, string[]>;
};
export type PlanScoreDayResult = PlanScoreDayPayload & {
  evidence: Record<PlanScoreDayFactorId, PlanScoreEvidence[]>;
  /** Internal values never sent as product payloads. */
  intrinsicScore: number | null;
  reliability: number | null;
  incomingDebt: number;
};
export type PlanScoreTripInput = {
  days: PlanScoreDayInput[];
  components?: Partial<
    Record<Exclude<PlanScoreTripComponentId, 'DAILY_QUALITY'>, PlanScoreFactorResult>
  >;
};
export type PlanScoreTripResult = Omit<PlanScoreTripPayload, 'days'> & {
  days: PlanScoreDayResult[];
  fatigueAdjustment: number;
  weakDayAdjustment: number;
};
export const PLAN_SCORE_INVALIDATION_TRIGGERS = [
  'ITINERARY_ITEM_CHANGED',
  'ITINERARY_ORDER_CHANGED',
  'ITINERARY_TIMING_CHANGED',
  'PROVIDER_EVIDENCE_CHANGED',
  'RESERVATION_CHANGED',
  'ROUTE_EVIDENCE_CHANGED',
  'TRIP_PLACE_CHANGED',
  'PREFERENCES_CHANGED',
  'DAY_CONTEXT_CHANGED',
  'DESTINATION_CONTEXT_CHANGED',
  'RUBRIC_CHANGED',
] as const;
export type PlanScoreInvalidationTrigger = (typeof PLAN_SCORE_INVALIDATION_TRIGGERS)[number];
export function clampScore(value: number) {
  if (!Number.isFinite(value)) throw new Error('invalid_factor_score');
  return Math.max(0, Math.min(100, value));
}
export function evidenceConfidence(evidence: readonly PlanScoreEvidence[]) {
  const distinct = new Map<string, PlanScoreEvidence>();
  for (const entry of evidence) if (!distinct.has(entry.ref)) distinct.set(entry.ref, entry);
  if (!distinct.size) throw new Error('missing_factor_evidence');
  return (
    [...distinct.values()].reduce(
      (total, entry) => total + RELIABILITY[entry.source] * (entry.strength ?? 1),
      0,
    ) / distinct.size
  );
}
export function toOutcome(
  result: PlanScoreFactorResult,
): Exclude<PlanScoreFactorOutcome, { state: 'LIMITED' }> {
  if (result.state !== 'EVALUATED') return { ...result };
  return {
    state: 'EVALUATED',
    score: clampScore(result.score),
    coverage: clampScore(result.coverage ?? 100),
    confidence: clampScore(result.confidence ?? evidenceConfidence(result.evidence)),
  };
}
/** Applicable unknown signals stay in the coverage denominator, never the quality mean. */
export function combineSignals(
  signals: readonly { weight: number; result: PlanScoreFactorResult }[],
): PlanScoreFactorResult {
  const applicable = signals.filter((s) => s.result.state !== 'NOT_APPLICABLE');
  if (!applicable.length) return NOT_APPLICABLE;
  const evaluated = applicable.flatMap((s) =>
    s.result.state === 'EVALUATED' && (s.result.coverage ?? 100) > 0
      ? [{ ...s, result: s.result, outcome: toOutcome(s.result) }]
      : [],
  );
  if (!evaluated.length) return UNKNOWN;
  const denominator = applicable.reduce((n, s) => n + s.weight, 0);
  const coveredWeight = evaluated.reduce(
    (n, s) => n + (s.weight * (s.result.coverage ?? 100)) / 100,
    0,
  );
  return {
    state: 'EVALUATED',
    score: coveredWeight
      ? evaluated.reduce(
          (n, s) => n + ((s.weight * (s.result.coverage ?? 100)) / 100) * s.result.score,
          0,
        ) / coveredWeight
      : 0,
    coverage: (100 * coveredWeight) / denominator,
    confidence: coveredWeight
      ? evaluated.reduce(
          (n, s) =>
            n +
            ((s.weight * (s.result.coverage ?? 100)) / 100) *
              (s.outcome.state === 'EVALUATED' ? s.outcome.confidence : 0),
          0,
        ) / coveredWeight
      : 0,
    evidence: [
      ...new Map(evaluated.flatMap((s) => s.result.evidence).map((e) => [e.ref, e])).values(),
    ],
  };
}
function rounded(internal: PlanScoreFactorOutcome): PlanScoreFactorOutcome {
  // Internal confidence is reliability. Apply coverage once at this published scope.
  const outcome =
    internal.state === 'EVALUATED'
      ? { ...internal, confidence: (internal.confidence * internal.coverage) / 100 }
      : internal;
  if (outcome.state === 'EVALUATED' && (outcome.coverage < 60 || outcome.confidence < 50))
    return {
      state: 'LIMITED',
      coverage: Math.round(outcome.coverage),
      confidence: Math.round(outcome.confidence),
    };
  return outcome.state === 'EVALUATED'
    ? {
        ...outcome,
        score: Math.round(outcome.score),
        coverage: Math.round(outcome.coverage),
        confidence: Math.round(outcome.confidence),
      }
    : outcome;
}
function evaluateDay(day: PlanScoreDayInput, incomingDebt = 0): PlanScoreDayResult {
  const inputs = { ...day.factors };
  const comfort = inputs.PACE_COMFORT;
  if (comfort?.state === 'EVALUATED')
    inputs.PACE_COMFORT = { ...comfort, score: clampScore(comfort.score - 20 * incomingDebt) };
  const aggregate = combineSignals(
    DAY_FACTOR_IDS.map((id) => ({ weight: BASE_WEIGHTS[id], result: inputs[id] ?? UNKNOWN })),
  );
  const intrinsic = combineSignals(
    DAY_FACTOR_IDS.map((id) => ({ weight: BASE_WEIGHTS[id], result: day.factors[id] ?? UNKNOWN })),
  );
  const outcome = toOutcome(aggregate);
  const completeness = outcome.state === 'EVALUATED' ? outcome.coverage : 0;
  const assessmentBasis = day.assessmentBasis ?? [];
  const limitations = day.limitations ?? [];
  const withheldReasons: PlanScoreDayWithheldReason[] = [];
  if (!assessmentBasis.length || outcome.state !== 'EVALUATED' || completeness <= 0)
    withheldReasons.push('NO_MEANINGFUL_EVIDENCE');
  const reliability = outcome.state === 'EVALUATED' ? outcome.confidence : null;
  const confidence = reliability === null ? null : (reliability * completeness) / 100;
  const hard = [...new Set(day.hardConflictIds ?? [])];
  const material = [...new Set(day.materialConflictIds ?? [])];
  const references = (ids: string[]) => [
    ...new Set(ids.flatMap((id) => day.conflictReferences?.[id] ?? [id])),
  ];
  const caps: PlanScoreCap[] = hard.length
    ? [
        {
          limit: hard.length > 1 ? 39 : 59,
          reason: hard.length > 1 ? 'MULTIPLE_HARD_CONFLICTS' : 'HARD_CONFLICT',
          references: references(hard),
        },
      ]
    : material.length
      ? [{ limit: 74, reason: 'MATERIAL_CONFLICT', references: references(material) }]
      : [];
  const bound = (score: number) => Math.min(score, ...caps.map((c) => c.limit));
  return {
    assessmentStatus: withheldReasons.length
      ? 'unavailable'
      : completeness < 80 || (confidence ?? 0) < 60 || limitations.includes('TRAVEL_TIME_UNKNOWN')
        ? 'provisional'
        : 'available',
    assessmentBasis,
    limitations,
    dayId: day.dayId,
    completeness,
    reliability,
    confidence,
    factors: Object.fromEntries(
      DAY_FACTOR_IDS.map((id) => [id, toOutcome(inputs[id] ?? UNKNOWN)]),
    ) as PlanScoreDayResult['factors'],
    evidence: Object.fromEntries(
      DAY_FACTOR_IDS.map((id) => [
        id,
        inputs[id]?.state === 'EVALUATED'
          ? [...new Map(inputs[id].evidence.map((e) => [e.ref, { ...e }])).values()]
          : [],
      ]),
    ) as PlanScoreDayResult['evidence'],
    score: withheldReasons.length || outcome.state !== 'EVALUATED' ? null : bound(outcome.score),
    intrinsicScore:
      withheldReasons.length || intrinsic.state !== 'EVALUATED' ? null : bound(intrinsic.score),
    incomingDebt,
    caps,
    withheldReasons,
  };
}
function displayDay(day: PlanScoreDayResult): PlanScoreDayResult {
  return {
    ...day,
    completeness: Math.round(day.completeness),
    confidence: day.confidence === null ? null : Math.round(day.confidence),
    score: day.score === null ? null : Math.round(day.score),
    factors: Object.fromEntries(
      DAY_FACTOR_IDS.map((id) => [id, rounded(day.factors[id])]),
    ) as PlanScoreDayResult['factors'],
  };
}
export const scoreDay = (day: PlanScoreDayInput) => displayDay(evaluateDay(day));
export function scoreTrip(input: PlanScoreTripInput): PlanScoreTripResult {
  const ordered = input.days.toSorted((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  let debt = 0;
  let knownFatigue = 0;
  const evaluated = ordered.map((day) => {
    const result = evaluateDay(day, debt);
    const ratio = day.loadRatio ?? day.partialLoadRatio;
    if (ratio != null && Number.isFinite(ratio)) {
      if (day.loadRatio != null) knownFatigue++;
      const next = Math.max(
        0,
        Math.min(1, 0.5 * debt + Math.max(0, ratio - 0.9) - 0.5 * Math.max(0, 0.7 - ratio)),
      );
      debt = day.loadRatio != null ? next : Math.max(debt, next);
    }
    return { input: day, result };
  });
  const scorable = evaluated.filter((e) => e.result.intrinsicScore !== null);
  const allAvailability =
    ordered.length > 0 &&
    ordered.every((d) => d.availableMinutes != null && d.availableMinutes > 0);
  const weight = (d: PlanScoreDayInput) => (allAvailability ? d.availableMinutes! : 1);
  const total = ordered.reduce((n, d) => n + weight(d), 0);
  const assessedWeight = scorable.reduce((n, e) => n + weight(e.input), 0);
  const completeness = total ? (100 * assessedWeight) / total : 0;
  const supportedDailyWeight = scorable.reduce(
    (n, e) => n + (weight(e.input) * e.result.completeness) / 100,
    0,
  );
  const dailyMean = scorable.length
    ? scorable.reduce(
        (n, e) => n + ((weight(e.input) * e.result.completeness) / 100) * e.result.intrinsicScore!,
        0,
      ) / supportedDailyWeight
    : null;
  const daily: PlanScoreFactorResult =
    dailyMean === null
      ? UNKNOWN
      : {
          state: 'EVALUATED',
          score: dailyMean,
          coverage: total ? (100 * supportedDailyWeight) / total : 0,
          confidence:
            scorable.reduce(
              (n, e) =>
                n + ((weight(e.input) * e.result.completeness) / 100) * (e.result.reliability ?? 0),
              0,
            ) / supportedDailyWeight,
          evidence: scorable.map((e) => ({ ref: `day:${e.input.dayId}`, source: 'USER_OWNED' })),
        };
  const components = {
    DAILY_QUALITY: daily,
    DESTINATION_UTILIZATION: input.components?.DESTINATION_UTILIZATION ?? UNKNOWN,
    VARIETY_COVERAGE: input.components?.VARIETY_COVERAGE ?? UNKNOWN,
    SEASONAL_FIT: input.components?.SEASONAL_FIT ?? UNKNOWN,
  };
  const combined = combineSignals(
    (Object.keys(TRIP_WEIGHTS) as PlanScoreTripComponentId[]).map((id) => ({
      weight: TRIP_WEIGHTS[id],
      result: components[id],
    })),
  );
  const outcome = toOutcome(combined);
  const lower = scorable.map((e) => e.result.intrinsicScore!).toSorted((a, b) => a - b)[
    Math.max(0, Math.ceil(0.2 * scorable.length) - 1)
  ];
  const weakDayAdjustment =
    dailyMean === null || lower === undefined
      ? 0
      : Math.min(10, 0.2 * Math.max(0, dailyMean - lower));
  const fatigueAdjustment = scorable.length
    ? (15 * scorable.reduce((n, e) => n + e.result.incomingDebt, 0)) / scorable.length
    : 0;
  const conflicts = evaluated.filter((e) => (e.input.hardConflictIds?.length ?? 0) > 0);
  const assessed = evaluated.filter(
    (e) => e.result.intrinsicScore !== null || (e.input.hardConflictIds?.length ?? 0) > 0,
  );
  const indispensable = conflicts.some((e) => e.input.indispensableConnectionConflict);
  const severe =
    indispensable || (assessed.length > 0 && conflicts.length / assessed.length >= 0.2);
  const caps: PlanScoreCap[] = conflicts.length
    ? [
        {
          limit: severe ? 69 : 84,
          reason: indispensable ? 'TRIP_CONNECTION_CONFLICT' : 'TRIP_HARD_CONFLICT',
          references: conflicts.map((e) => e.input.dayId),
        },
      ]
    : [];
  const withheldReasons: PlanScoreTripWithheldReason[] = [];
  if (!scorable.length) withheldReasons.push('NO_SCORABLE_DAY');
  const confidence =
    outcome.state === 'EVALUATED'
      ? ((outcome.confidence * outcome.coverage) / 100) *
        (ordered.length ? 0.75 + (0.25 * knownFatigue) / ordered.length : 1)
      : null;
  const assessmentBasis = [...new Set(scorable.flatMap((e) => e.result.assessmentBasis))];
  const limitations = [...new Set(evaluated.flatMap((e) => e.result.limitations))];
  if (scorable.length < ordered.length) limitations.push('UNASSESSED_DAYS');
  return {
    assessmentBasis,
    limitations,
    assessmentStatus: withheldReasons.length
      ? 'unavailable'
      : (outcome.state === 'EVALUATED' && outcome.coverage < 80) ||
          (confidence ?? 0) < 60 ||
          scorable.length < ordered.length ||
          limitations.includes('TRAVEL_TIME_UNKNOWN')
        ? 'provisional'
        : 'available',
    assessedDayCount: scorable.length,
    applicableDayCount: ordered.length,
    evidenceCoverage: Math.round(outcome.state === 'EVALUATED' ? outcome.coverage : 0),
    days: evaluated.map((e) => displayDay(e.result)),
    components: Object.fromEntries(
      Object.entries(components).map(([id, value]) => [id, rounded(toOutcome(value))]),
    ) as PlanScoreTripResult['components'],
    // Unknown load never claims recovery. The unresolved share also qualifies confidence.
    completeness: Math.round(completeness),
    confidence: confidence === null ? null : Math.round(confidence),
    caps,
    score:
      withheldReasons.length || outcome.state !== 'EVALUATED'
        ? null
        : Math.round(
            Math.min(
              clampScore(outcome.score - fatigueAdjustment - weakDayAdjustment),
              ...caps.map((c) => c.limit),
            ),
          ),
    withheldReasons,
    fatigueAdjustment,
    weakDayAdjustment,
  };
}
export function toPlanScoreDayPayload(result: PlanScoreDayResult): PlanScoreDayPayload {
  const {
    evidence: _evidence,
    intrinsicScore: _intrinsic,
    reliability: _reliability,
    incomingDebt: _debt,
    ...payload
  } = result;
  return payload;
}
export function toPlanScoreTripPayload(result: PlanScoreTripResult): PlanScoreTripPayload {
  const { days, fatigueAdjustment: _fatigue, weakDayAdjustment: _weak, ...payload } = result;
  return { ...payload, days: days.map(toPlanScoreDayPayload) };
}
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}
export function scoringInputRevision(input: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(canonical({ version: PLAN_SCORE_CONTRACT_VERSION, input })))
    .digest('hex');
}
export function planScoreFingerprint(input: PlanScoreTripInput) {
  const signal = (result: PlanScoreFactorResult) =>
    result.state === 'EVALUATED'
      ? {
          ...result,
          evidence: [...new Map(result.evidence.map((e) => [e.ref, e])).values()].toSorted((a, b) =>
            a.ref.localeCompare(b.ref),
          ),
        }
      : result;
  return scoringInputRevision({
    ...input,
    days: input.days
      .toSorted(
        (a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.dayId.localeCompare(b.dayId),
      )
      .map((d) => ({
        ...d,
        hardConflictIds: d.hardConflictIds?.toSorted(),
        materialConflictIds: d.materialConflictIds?.toSorted(),
        factors: Object.fromEntries(
          Object.entries(d.factors).map(([id, value]) => [id, signal(value)]),
        ),
      })),
    components: input.components
      ? Object.fromEntries(
          Object.entries(input.components).map(([id, value]) => [id, signal(value)]),
        )
      : undefined,
  });
}
