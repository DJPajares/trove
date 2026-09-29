import { createHash } from 'node:crypto';
import type {
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
export const PLAN_SCORE_CONTRACT_VERSION = 5;
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
  coreEvaluated?: boolean;
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
export function toOutcome(result: PlanScoreFactorResult): PlanScoreFactorOutcome {
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
    s.result.state === 'EVALUATED'
      ? [{ ...s, result: s.result, outcome: toOutcome(s.result) }]
      : [],
  );
  if (!evaluated.length) return UNKNOWN;
  const denominator = applicable.reduce((n, s) => n + s.weight, 0);
  const evaluatedWeight = evaluated.reduce((n, s) => n + s.weight, 0);
  const coveredWeight = evaluated.reduce(
    (n, s) => n + (s.weight * (s.result.coverage ?? 100)) / 100,
    0,
  );
  return {
    state: 'EVALUATED',
    score: evaluated.reduce((n, s) => n + s.weight * s.result.score, 0) / evaluatedWeight,
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
function rounded(outcome: PlanScoreFactorOutcome): PlanScoreFactorOutcome {
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
  const core =
    day.coreEvaluated ??
    ['FEASIBILITY', 'ROUTE_EFFICIENCY'].some(
      (id) => inputs[id as PlanScoreDayFactorId]?.state === 'EVALUATED',
    );
  const restCore =
    day.rest &&
    (inputs.PACE_COMFORT?.state === 'EVALUATED' || inputs.PLAN_COMPOSITION?.state === 'EVALUATED');
  const withheldReasons: PlanScoreDayWithheldReason[] = [];
  if (completeness < 60) withheldReasons.push('INSUFFICIENT_COMPLETENESS');
  if (!core && !restCore) withheldReasons.push('NO_EVALUABLE_CORE_FACTOR');
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
    dayId: day.dayId,
    completeness,
    confidence: outcome.state === 'EVALUATED' ? outcome.confidence : null,
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
    const ratio = day.loadRatio;
    if (ratio != null && Number.isFinite(ratio)) {
      knownFatigue++;
      debt = Math.max(
        0,
        Math.min(1, 0.5 * debt + Math.max(0, ratio - 0.9) - 0.5 * Math.max(0, 0.7 - ratio)),
      );
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
  const dailyMean = scorable.length
    ? scorable.reduce((n, e) => n + weight(e.input) * e.result.intrinsicScore!, 0) / assessedWeight
    : null;
  const daily: PlanScoreFactorResult =
    dailyMean === null
      ? UNKNOWN
      : {
          state: 'EVALUATED',
          score: dailyMean,
          coverage: completeness,
          confidence:
            scorable.reduce((n, e) => n + weight(e.input) * (e.result.confidence ?? 0), 0) /
            assessedWeight,
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
    (e) => e.result.confidence !== null || (e.input.hardConflictIds?.length ?? 0) > 0,
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
  else if (completeness < 60) withheldReasons.push('INSUFFICIENT_COMPLETENESS');
  return {
    days: evaluated.map((e) => displayDay(e.result)),
    components: Object.fromEntries(
      Object.entries(components).map(([id, value]) => [id, rounded(toOutcome(value))]),
    ) as PlanScoreTripResult['components'],
    // Unknown load never claims recovery. The unresolved share also qualifies confidence.
    completeness: Math.round(completeness),
    confidence:
      outcome.state === 'EVALUATED'
        ? Math.round(
            outcome.confidence *
              (ordered.length ? 0.75 + (0.25 * knownFatigue) / ordered.length : 1),
          )
        : null,
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
