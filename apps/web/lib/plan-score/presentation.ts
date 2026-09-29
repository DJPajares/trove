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
  if (!score || score.schemaVersion !== 7 || score.rubricVersion !== 7) return false;
  if (score.evidenceAsOf === null) return false;
  const generated = Date.parse(score.generatedAt);
  const evidence = score.evidenceAsOf ? Date.parse(score.evidenceAsOf) : null;
  return (
    Number.isFinite(generated) &&
    generated <= now &&
    (evidence === null ||
      (Number.isFinite(evidence) && evidence <= generated && now - evidence < 30 * 86_400_000)) &&
    Date.parse(score.recomputeAfter) <= generated + 86_400_000 &&
    Number.isFinite(assessmentDeadline(score)) &&
    now < assessmentDeadline(score) &&
    !score.withheldReasons.includes('EVIDENCE_NOT_CURRENT')
  );
}
export function assessmentDeadline(score: TripPlanScore) {
  return Math.min(
    Date.parse(score.generatedAt) + 86_400_000,
    Date.parse(score.recomputeAfter),
    score.evidenceExpiresAt ? Date.parse(score.evidenceExpiresAt) : Infinity,
  );
}
/** Only useful traveler-facing insights, deduplicated by their underlying issue. */
export function travelerInsights(groups: import('@trove/types').PlanScoreExplanationGroups) {
  const seen = new Set<string>();
  return [
    ...prioritizedProblems([
      ...groups.worthImproving,
      ...groups.uncertainty.filter((reason) => reason.action),
    ]),
    ...groups.whatWorks,
  ].filter((reason) => {
    if (
      reason.code.endsWith('_UNKNOWN') ||
      reason.code.endsWith('_PARTIAL') ||
      ['SEASONAL_PATTERN', 'PUBLIC_HOLIDAY', 'PARTIAL_ACCESS'].includes(reason.code)
    )
      return false;
    const key = `${reason.code}:${[...reason.references].sort().join('|')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
/** Problems worth a look, apart from what is already working. */
export function travelerInsightGroups(groups: import('@trove/types').PlanScoreExplanationGroups) {
  const positive = new Set(groups.whatWorks);
  const insights = travelerInsights(groups);
  return {
    issues: insights.filter((reason) => !positive.has(reason)),
    highlights: insights.filter((reason) => positive.has(reason)),
  };
}
export type ScoreBand = 'excellent' | 'strong' | 'good' | 'refine' | 'attention';
/** Presentation-only verdict band; the number stays canonical (PRD 29.2). */
export function scoreBand(score: number): ScoreBand {
  return score >= 90
    ? 'excellent'
    : score >= 80
      ? 'strong'
      : score >= 70
        ? 'good'
        : score >= 60
          ? 'refine'
          : 'attention';
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
  const day = assessment.days.find((day) => explanation.references.includes(day.dayId));
  if (day) return { href: `/trips/${tripId}/itinerary?day=${encodeURIComponent(day.dayId)}` };
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

/** One short basis statement, without raw diagnostics or speculative quality claims. */
export function assessmentBasisKey(
  assessment: Pick<TripPlanScore, 'assessmentBasis' | 'limitations'>,
) {
  if (assessment.limitations.includes('TRAVEL_TIME_UNKNOWN'))
    return assessment.assessmentBasis.some(
      (basis) => basis === 'TIMING' || basis === 'ACTIVITY_LOAD',
    )
      ? 'basis.travelUnknown'
      : 'basis.verifiedProblemTravelUnknown';
  if (assessment.assessmentBasis.includes('REST') && assessment.assessmentBasis.length === 1)
    return 'basis.rest';
  if (assessment.assessmentBasis.includes('TIMING')) return 'basis.timing';
  if (assessment.assessmentBasis.includes('ACTIVITY_LOAD')) return 'basis.activityLoad';
  return 'basis.verifiedProblem';
}
