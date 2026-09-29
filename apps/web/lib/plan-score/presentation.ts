import type { PlanScoreExplanation, TripPlanScore } from '@trove/types';

export const DAILY_CATEGORIES = [
  'FEASIBILITY',
  'ROUTE_EFFICIENCY',
  'PACE_COMFORT',
  'EXPERIENCE_QUALITY',
  'PLAN_COMPOSITION',
] as const;
export const TRIP_COMPONENTS = [
  'DAILY_QUALITY',
  'DESTINATION_UTILIZATION',
  'VARIETY_COVERAGE',
  'SEASONAL_FIT',
] as const;

export function currentAssessment(
  score: TripPlanScore | null | undefined,
  now = Date.now(),
): boolean {
  if (!score || score.schemaVersion !== 5 || score.rubricVersion !== 5) return false;
  const generated = Date.parse(score.generatedAt);
  const deadline = assessmentDeadline(score);
  if (score.evidenceAsOf !== undefined) {
    if (score.evidenceAsOf === null) return false;
    const evidence = Date.parse(score.evidenceAsOf);
    if (
      !Number.isFinite(evidence) ||
      evidence > generated ||
      now - evidence >= (score.expiresAt ? 30 : 1) * 86_400_000
    )
      return false;
  }
  if (score.expiresAt && Date.parse(score.expiresAt) > generated + 86_400_000) return false;
  return (
    Number.isFinite(generated) &&
    generated <= now &&
    Number.isFinite(deadline) &&
    now < deadline &&
    !score.withheldReasons.includes('EVIDENCE_NOT_CURRENT')
  );
}
export function assessmentDeadline(score: TripPlanScore) {
  return Math.min(
    Date.parse(score.generatedAt) + 86_400_000,
    score.expiresAt
      ? Date.parse(score.expiresAt)
      : score.evidenceAsOf
        ? Date.parse(score.evidenceAsOf) + 86_400_000
        : Infinity,
  );
}
export function prioritizedProblems(reasons: readonly PlanScoreExplanation[]) {
  const severity = { HARD: 0, MATERIAL: 1, RISK: 2, INFO: 3 };
  const category = [
    'FEASIBILITY',
    'DAILY_QUALITY',
    'ROUTE_EFFICIENCY',
    'PACE_COMFORT',
    'EXPERIENCE_QUALITY',
    'PLAN_COMPOSITION',
    'DESTINATION_UTILIZATION',
    'VARIETY_COVERAGE',
    'SEASONAL_FIT',
  ];
  return reasons.toSorted(
    (a, b) =>
      severity[a.severity] - severity[b.severity] ||
      category.indexOf(a.factor) - category.indexOf(b.factor) ||
      a.code.localeCompare(b.code),
  );
}

/** Session-only history deliberately excludes reasons, parameters and source data. */
export type ScoreSnapshot = {
  version: string;
  fingerprint: string;
  deadline: number;
  current: boolean;
  revisions: { planning: string; evidence: string; destinationContext: string } | undefined;
  scopes: Record<
    string,
    {
      score: number | null;
      coverage: number;
      confidence: number | null;
      outcomes: string;
      limits: string;
      adjustments?: string;
    }
  >;
};
export type ScoreChange = {
  source: 'planning' | 'evidence' | 'destinationContext' | 'assessment' | 'rubric';
  delta: number | null;
  state: 'score' | 'coverage' | 'unavailable' | 'available' | 'rubric';
};
export function scoreSnapshot(score: TripPlanScore, now = Date.now()): ScoreSnapshot {
  const summary = (entry: TripPlanScore | TripPlanScore['days'][number]) => ({
    score: entry.score,
    coverage: entry.completeness,
    confidence: entry.confidence,
    outcomes: JSON.stringify('factors' in entry ? entry.factors : entry.components),
    limits: JSON.stringify(entry.caps.map(({ limit, reason }) => ({ limit, reason }))),
    adjustments:
      'presentation' in entry ? JSON.stringify(entry.presentation?.adjustments) : undefined,
  });
  return {
    version: `${score.schemaVersion}:${score.rubricVersion}`,
    fingerprint: score.fingerprint,
    deadline: assessmentDeadline(score),
    current: currentAssessment(score, now),
    revisions: score.presentation?.revisions ? { ...score.presentation.revisions } : undefined,
    scopes: {
      trip: summary(score),
      ...Object.fromEntries(score.days.map((day) => [day.dayId, summary(day)])),
    },
  };
}
export function compareScores(
  previous: ScoreSnapshot,
  next: ScoreSnapshot,
  scope: string,
  now = Date.now(),
): ScoreChange | null {
  const before = previous.scopes[scope],
    after = next.scopes[scope];
  if (!before || !after || previous.fingerprint === next.fingerprint) return null;
  if (previous.version !== next.version) return { source: 'rubric', delta: null, state: 'rubric' };
  if (JSON.stringify(before) === JSON.stringify(after)) return null;
  const source =
    previous.revisions && next.revisions
      ? previous.revisions.planning !== next.revisions.planning
        ? 'planning'
        : previous.revisions.evidence !== next.revisions.evidence
          ? 'evidence'
          : previous.revisions.destinationContext !== next.revisions.destinationContext
            ? 'destinationContext'
            : 'assessment'
      : 'assessment';
  if (!previous.current || !next.current || previous.deadline <= now || next.deadline <= now)
    return { source, delta: null, state: 'unavailable' };
  if (before.score === null || after.score === null)
    return { source, delta: null, state: after.score === null ? 'unavailable' : 'available' };
  const delta = after.score - before.score;
  return { source, delta: delta === 0 ? null : delta, state: delta === 0 ? 'coverage' : 'score' };
}

export type ScoreAction = { href: string } | { onSelect: () => void };
export function dayActionLink(
  tripId: string,
  assessment: TripPlanScore | null,
  explanation: PlanScoreExplanation,
): ScoreAction | null {
  if (!explanation.action || !assessment) return null;
  const day = assessment.days.find((day) => explanation.references.includes(day.dayId));
  if (day) return { href: `/trips/${tripId}/itinerary?day=${encodeURIComponent(day.dayId)}` };
  for (const reference of explanation.references) {
    const target = assessment.presentation?.referenceTargets?.[reference];
    if (target?.kind === 'item') {
      const query = new URLSearchParams({ item: reference });
      if (target.dayId) query.set('day', target.dayId);
      return { href: `/trips/${tripId}/itinerary?${query}` };
    }
    if (target?.kind === 'reservation')
      return { href: `/trips/${tripId}/reservations?reservation=${encodeURIComponent(reference)}` };
    if (target?.kind === 'trip_place' && explanation.action === 'SCHEDULE_MUST_GO')
      return { href: `/trips/${tripId}/itinerary?place=${encodeURIComponent(reference)}` };
  }
  // Older compatible assessments already identify Must Go refs explicitly.
  if (explanation.action === 'SCHEDULE_MUST_GO' && explanation.references[0])
    return {
      href: `/trips/${tripId}/itinerary?place=${encodeURIComponent(explanation.references[0])}`,
    };

  return null;
}

const SCORING_EDIT_KINDS = new Set([
  'itinerary_day_move',
  'itinerary_item_create',
  'itinerary_item_update',
  'itinerary_item_delete',
  'itinerary_item_organize',
]);
export function hasUnsyncedScoringEdits(operations: readonly { kind: string }[]) {
  return operations.some((operation) => SCORING_EDIT_KINDS.has(operation.kind));
}
