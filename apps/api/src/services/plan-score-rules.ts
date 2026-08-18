import { createHash } from 'node:crypto';

/**
 * Deterministic Plan Score contract (PRD section 29).
 *
 * Factor evaluators supply evidence-backed factor results; this module owns the
 * weighted formula, applicability renormalization, completeness, confidence, and
 * the withholding rules. The base weights stay private to this module and must
 * never be surfaced through product APIs or UI.
 *
 * Results are derived and cacheable: `planScoreFingerprint` identifies the exact
 * evidence a stored result was produced from, and `PLAN_SCORE_INVALIDATION_TRIGGERS`
 * enumerates the changes that require re-evaluation.
 */

/** Bump when weights, rubric bands, or aggregation semantics change; invalidates cached results. */
export const PLAN_SCORE_CONTRACT_VERSION = 4;

/**
 * Fixed evaluation order (PRD section 29.4 explanation priority). Iterating this
 * list rather than object keys keeps repeated evaluation bit-identical.
 */
const DAY_FACTOR_IDS = [
  'FEASIBILITY',
  'TRAVEL_EFFORT',
  'PACE_BUFFER',
  'ROUTE_EFFICIENCY',
  'PLACE_QUALITY',
] as const;

/** Must Go priority fit is trip-scoped and is deliberately absent from this union. */
export type PlanScoreDayFactorId = (typeof DAY_FACTOR_IDS)[number];

/** Internal calibration. Not exported, not serialized, not exposed to users. */
const BASE_WEIGHTS: Record<PlanScoreDayFactorId | 'MUST_GO_PRIORITY_FIT', number> = {
  FEASIBILITY: 35,
  MUST_GO_PRIORITY_FIT: 10,
  PACE_BUFFER: 15,
  PLACE_QUALITY: 5,
  ROUTE_EFFICIENCY: 10,
  TRAVEL_EFFORT: 25,
};

/** A numeric day score additionally requires one of these to be applicable and evaluable. */
const CORE_DAY_FACTOR_IDS: readonly PlanScoreDayFactorId[] = ['FEASIBILITY', 'TRAVEL_EFFORT'];

const MINIMUM_SCORABLE_COMPLETENESS = 60;

export type PlanScoreEvidenceSource =
  'CACHED_PROVIDER' | 'ESTIMATED' | 'FRESH_PROVIDER' | 'STALE' | 'USER_OWNED';

/** Evidence reliability values from PRD section 29.2. */
const EVIDENCE_RELIABILITY: Record<PlanScoreEvidenceSource, number> = {
  CACHED_PROVIDER: 75,
  ESTIMATED: 50,
  FRESH_PROVIDER: 100,
  STALE: 25,
  USER_OWNED: 100,
};

export type PlanScoreEvidence = {
  /** Stable reference to the evaluated data point, reused later for explanations. */
  ref: string;
  source: PlanScoreEvidenceSource;
};

export type PlanScoreUnknownReason =
  'INSUFFICIENT_EVIDENCE' | 'MISSING_EVIDENCE' | 'UNUSABLE_EVIDENCE';

/**
 * What a factor evaluator returns. `UNKNOWN` and `NOT_APPLICABLE` are distinct:
 * unknown evidence lowers completeness, while a non-applicable factor is removed
 * from the applicable weight base. Neither is ever scored as zero.
 */
export type PlanScoreFactorResult =
  | { evidence: PlanScoreEvidence[]; score: number; state: 'EVALUATED' }
  | { reason: PlanScoreUnknownReason; state: 'UNKNOWN' }
  | { state: 'NOT_APPLICABLE' };

/** What callers receive: clamped and rounded, with weights kept internal. */
export type PlanScoreFactorOutcome =
  | { confidence: number; score: number; state: 'EVALUATED' }
  | { reason: PlanScoreUnknownReason; state: 'UNKNOWN' }
  | { state: 'NOT_APPLICABLE' };

/**
 * Travel-heavy days need no separate scoring system: evaluators mark the factors
 * that genuinely do not apply as `NOT_APPLICABLE` and the remaining applicable
 * weights are renormalized. Omitted factors default to unknown/missing evidence.
 */
export type PlanScoreDayInput = {
  dayId: string;
  factors: Partial<Record<PlanScoreDayFactorId, PlanScoreFactorResult>>;
};

export type PlanScoreDayWithheldReason =
  'ADMINISTRATIVELY_DISABLED' | 'INSUFFICIENT_COMPLETENESS' | 'NO_EVALUABLE_CORE_FACTOR';

export type PlanScoreDayResult = {
  completeness: number;
  confidence: number | null;
  dayId: string;
  /** Evidence each factor actually used, retained for explanations and debugging. */
  evidence: Record<PlanScoreDayFactorId, PlanScoreEvidence[]>;
  factors: Record<PlanScoreDayFactorId, PlanScoreFactorOutcome>;
  /** Withheld as `null` rather than reported as a poor score. */
  score: number | null;
  withheldReasons: PlanScoreDayWithheldReason[];
};

export type PlanScoreTripInput = {
  days: PlanScoreDayInput[];
  mustGoPriorityFit: PlanScoreFactorResult;
};

export type PlanScoreTripWithheldReason = 'ADMINISTRATIVELY_DISABLED' | 'NO_SCORABLE_DAY';

export type PlanScoreTripResult = {
  days: PlanScoreDayResult[];
  mustGoEvidence: PlanScoreEvidence[];
  mustGoPriorityFit: PlanScoreFactorOutcome;
  score: number | null;
  withheldReasons: PlanScoreTripWithheldReason[];
};

/**
 * User-facing shape. Score, confidence, completeness, and factor states only:
 * no base weights, no formula, and no evidence snapshots.
 */
export type PlanScoreDayPayload = Omit<PlanScoreDayResult, 'evidence'>;

export type PlanScoreTripPayload = Omit<PlanScoreTripResult, 'days' | 'mustGoEvidence'> & {
  days: PlanScoreDayPayload[];
};

export type PlanScoreInvalidationTrigger =
  | 'ITINERARY_ITEM_CHANGED'
  | 'ITINERARY_ORDER_CHANGED'
  | 'ITINERARY_TIMING_CHANGED'
  | 'PROVIDER_EVIDENCE_CHANGED'
  | 'RESERVATION_CHANGED'
  | 'ROUTE_EVIDENCE_CHANGED'
  | 'TRIP_PLACE_CHANGED';

/** Changes that invalidate an affected day and its trip result (PRD section 29.5). */
export const PLAN_SCORE_INVALIDATION_TRIGGERS: readonly PlanScoreInvalidationTrigger[] = [
  'ITINERARY_ITEM_CHANGED',
  'ITINERARY_ORDER_CHANGED',
  'ITINERARY_TIMING_CHANGED',
  'PROVIDER_EVIDENCE_CHANGED',
  'RESERVATION_CHANGED',
  'ROUTE_EVIDENCE_CHANGED',
  'TRIP_PLACE_CHANGED',
];

const MISSING_FACTOR: PlanScoreFactorResult = { reason: 'MISSING_EVIDENCE', state: 'UNKNOWN' };

function clampScore(value: number) {
  if (!Number.isFinite(value)) throw new Error('invalid_factor_score');
  return Math.min(100, Math.max(0, value));
}

/** Values are always 0–100, so `Math.round` is standard half-up rounding here. */
function roundHalfUp(value: number) {
  return Math.round(value);
}

function factorConfidence(evidence: PlanScoreEvidence[]) {
  if (evidence.length === 0) throw new Error('missing_factor_evidence');

  const total = evidence.reduce((sum, item) => sum + EVIDENCE_RELIABILITY[item.source], 0);
  return total / evidence.length;
}

function toOutcome(result: PlanScoreFactorResult): PlanScoreFactorOutcome {
  if (result.state === 'NOT_APPLICABLE') return { state: 'NOT_APPLICABLE' };
  if (result.state === 'UNKNOWN') return { reason: result.reason, state: 'UNKNOWN' };

  return {
    confidence: factorConfidence(result.evidence),
    score: clampScore(result.score),
    state: 'EVALUATED',
  };
}

function roundOutcome(outcome: PlanScoreFactorOutcome): PlanScoreFactorOutcome {
  if (outcome.state !== 'EVALUATED') return outcome;

  return {
    confidence: roundHalfUp(outcome.confidence),
    score: roundHalfUp(outcome.score),
    state: 'EVALUATED',
  };
}

type EvaluatedDay = {
  completeness: number;
  confidence: number | null;
  evidence: Record<PlanScoreDayFactorId, PlanScoreEvidence[]>;
  factors: Record<PlanScoreDayFactorId, PlanScoreFactorOutcome>;
  score: number | null;
  withheldReasons: PlanScoreDayWithheldReason[];
};

function snapshotEvidence(result: PlanScoreFactorResult) {
  return result.state === 'EVALUATED' ? result.evidence.map((entry) => ({ ...entry })) : [];
}

/** Unrounded evaluation so trip aggregation can use exact intermediate values. */
function evaluateDay(day: PlanScoreDayInput): EvaluatedDay {
  const factors = Object.fromEntries(
    DAY_FACTOR_IDS.map((id) => [id, toOutcome(day.factors[id] ?? MISSING_FACTOR)]),
  ) as Record<PlanScoreDayFactorId, PlanScoreFactorOutcome>;
  const evidence = Object.fromEntries(
    DAY_FACTOR_IDS.map((id) => [id, snapshotEvidence(day.factors[id] ?? MISSING_FACTOR)]),
  ) as Record<PlanScoreDayFactorId, PlanScoreEvidence[]>;

  let applicableWeight = 0;
  let evaluatedWeight = 0;
  let weightedScore = 0;
  let weightedConfidence = 0;

  for (const id of DAY_FACTOR_IDS) {
    const outcome = factors[id];
    if (outcome.state === 'NOT_APPLICABLE') continue;

    const weight = BASE_WEIGHTS[id];
    applicableWeight += weight;
    if (outcome.state !== 'EVALUATED') continue;

    evaluatedWeight += weight;
    weightedScore += weight * outcome.score;
    weightedConfidence += weight * outcome.confidence;
  }

  const completeness = applicableWeight === 0 ? 0 : (100 * evaluatedWeight) / applicableWeight;
  const withheldReasons: PlanScoreDayWithheldReason[] = [];

  if (completeness < MINIMUM_SCORABLE_COMPLETENESS) {
    withheldReasons.push('INSUFFICIENT_COMPLETENESS');
  }
  if (!CORE_DAY_FACTOR_IDS.some((id) => factors[id].state === 'EVALUATED')) {
    withheldReasons.push('NO_EVALUABLE_CORE_FACTOR');
  }

  return {
    completeness,
    confidence: evaluatedWeight === 0 ? null : weightedConfidence / evaluatedWeight,
    evidence,
    factors,
    score: withheldReasons.length > 0 ? null : weightedScore / evaluatedWeight,
    withheldReasons,
  };
}

function toDayResult(dayId: string, evaluated: EvaluatedDay): PlanScoreDayResult {
  return {
    completeness: roundHalfUp(evaluated.completeness),
    confidence: evaluated.confidence === null ? null : roundHalfUp(evaluated.confidence),
    dayId,
    evidence: evaluated.evidence,
    factors: Object.fromEntries(
      DAY_FACTOR_IDS.map((id) => [id, roundOutcome(evaluated.factors[id])]),
    ) as Record<PlanScoreDayFactorId, PlanScoreFactorOutcome>,
    score: evaluated.score === null ? null : roundHalfUp(evaluated.score),
    withheldReasons: evaluated.withheldReasons,
  };
}

export function scoreDay(day: PlanScoreDayInput): PlanScoreDayResult {
  return toDayResult(day.dayId, evaluateDay(day));
}

export function scoreTrip(input: PlanScoreTripInput): PlanScoreTripResult {
  const evaluatedDays = input.days.map((day) => ({ day, evaluated: evaluateDay(day) }));
  const scorableDays = evaluatedDays.flatMap(({ evaluated }) =>
    evaluated.score === null
      ? []
      : [{ completeness: evaluated.completeness, score: evaluated.score }],
  );
  const mustGoPriorityFit = toOutcome(input.mustGoPriorityFit);
  const withheldReasons: PlanScoreTripWithheldReason[] = [];
  let score: number | null = null;

  if (scorableDays.length === 0) {
    withheldReasons.push('NO_SCORABLE_DAY');
  } else {
    let totalWeight = 0;
    let weightedScore = 0;

    for (const day of scorableDays) {
      const weight = day.completeness / 100;
      totalWeight += weight;
      weightedScore += weight * day.score;
    }

    const dayMean = weightedScore / totalWeight;
    const mustGoWeight = BASE_WEIGHTS.MUST_GO_PRIORITY_FIT / 100;
    score =
      mustGoPriorityFit.state === 'EVALUATED'
        ? (1 - mustGoWeight) * dayMean + mustGoWeight * mustGoPriorityFit.score
        : dayMean;
  }

  return {
    days: evaluatedDays.map(({ day, evaluated }) => toDayResult(day.dayId, evaluated)),
    mustGoEvidence: snapshotEvidence(input.mustGoPriorityFit),
    mustGoPriorityFit: roundOutcome(mustGoPriorityFit),
    score: score === null ? null : roundHalfUp(score),
    withheldReasons,
  };
}

/** Drops the evidence snapshot so normal product responses carry no scoring internals. */
export function toPlanScoreDayPayload(result: PlanScoreDayResult): PlanScoreDayPayload {
  const { evidence: _evidence, ...payload } = result;
  return payload;
}

export function toPlanScoreTripPayload(result: PlanScoreTripResult): PlanScoreTripPayload {
  const { days, mustGoEvidence: _mustGoEvidence, ...payload } = result;
  return { ...payload, days: days.map(toPlanScoreDayPayload) };
}

function canonicalFactor(result: PlanScoreFactorResult | undefined) {
  const factor = result ?? MISSING_FACTOR;
  if (factor.state === 'NOT_APPLICABLE') return 'NOT_APPLICABLE';
  if (factor.state === 'UNKNOWN') return `UNKNOWN:${factor.reason}`;

  const evidence = factor.evidence
    .map((item) => `${item.source}:${item.ref}`)
    .toSorted((left, right) => left.localeCompare(right));

  return `EVALUATED:${clampScore(factor.score)}:${evidence.join(',')}`;
}

/**
 * Stable identity of the evidence a result was derived from. A cached Plan Score
 * stays valid while this value is unchanged, so recalculation triggered by
 * `PLAN_SCORE_INVALIDATION_TRIGGERS` can re-evaluate without rewriting results.
 */
export function planScoreFingerprint(input: PlanScoreTripInput) {
  const parts = [
    `v${PLAN_SCORE_CONTRACT_VERSION}`,
    `MUST_GO_PRIORITY_FIT=${canonicalFactor(input.mustGoPriorityFit)}`,
  ];

  for (const day of input.days) {
    const factors = DAY_FACTOR_IDS.map((id) => `${id}:${canonicalFactor(day.factors[id])}`);
    parts.push(`${day.dayId}=${factors.join('|')}`);
  }

  return createHash('sha256').update(parts.join('\n')).digest('hex');
}
