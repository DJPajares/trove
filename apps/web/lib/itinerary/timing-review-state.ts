import type { SchedulingOutcome, TimingIssue } from '@trove/types';
import type { ItineraryDay } from '@/lib/itinerary/api';

type ReviewDay = Pick<ItineraryDay, 'id' | 'items' | 'planningContext'>;

/** Shared with the planner's existing assessment so observing a review reuses
 * that read instead of making a second request for the selected day. */
export function timingAssessmentRevision(day: ReviewDay | null) {
  return JSON.stringify([
    day?.planningContext,
    day?.items.map((item) => [item.id, item.updatedAt, item.position]),
  ]);
}

export function timingReviewDays(outcome: SchedulingOutcome | null, days: ReviewDay[]) {
  const itemIds = new Set(outcome?.issues.map((issue) => issue.itemId));
  return days.filter((day) => day.items.some((item) => itemIds.has(item.id)));
}

/** Only successful, fresh assessments replace warnings. Other days and pending
 * suggestions remain intact, and viewing a review never applies its times. */
export function reconcileTimingReviewIssues(
  outcome: SchedulingOutcome,
  days: ReviewDay[],
  assessments: Array<{ itineraryDayId: string; issues: TimingIssue[] }>,
): SchedulingOutcome {
  const allItemIds = new Set(days.flatMap((day) => day.items.map((item) => item.id)));
  let issues = outcome.issues.filter((issue) => allItemIds.has(issue.itemId));
  for (const assessment of assessments) {
    const day = days.find((candidate) => candidate.id === assessment.itineraryDayId);
    if (!day) continue;
    const itemIds = new Set(day.items.map((item) => item.id));
    // Do not resurrect an acknowledged review on an unrelated assessment.
    if (!issues.some((issue) => itemIds.has(issue.itemId))) continue;
    issues = [
      ...issues.filter((issue) => !itemIds.has(issue.itemId)),
      ...assessment.issues.filter((issue) => itemIds.has(issue.itemId)),
    ];
  }
  // Assessment results can arrive in a different order without changing truth.
  const signature = (rows: TimingIssue[]) =>
    rows
      .map((issue) => JSON.stringify(issue))
      .sort()
      .join('\n');
  if (signature(issues) === signature(outcome.issues)) return outcome;
  return { ...outcome, issues };
}

/** Acknowledge saved changes, keeping genuinely unresolved issues visible. */
export function acknowledgeTimingReview(outcome: SchedulingOutcome): SchedulingOutcome {
  return outcome.issues.length
    ? { changes: [], issues: outcome.issues }
    : { changes: [], issues: [] };
}
