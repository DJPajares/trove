import type {
  PlanScoreExplanation,
  PlanScoreExplanationGroups,
  TripPlanScoreDay,
} from '@trove/types';

import { travelerInsightGroups } from './presentation';

/** The two severities Plan Score reserves for a verified problem with the plan. */
const VERIFIED_PROBLEM = new Set<PlanScoreExplanation['severity']>(['HARD', 'MATERIAL']);

/**
 * Whether a day has a problem worth a look - the dot on its tile in the trip
 * ribbon. It reads the same "worth improving" list the day's score card shows,
 * keeps only verified problems, and invents no measure of its own: a day the
 * score could not assess, or one with only advice to give, raises nothing.
 */
export function dayNeedsAttention(
  day: Pick<TripPlanScoreDay, 'explanations' | 'withheldReasons'> | null | undefined,
) {
  if (!day || day.withheldReasons.includes('ADMINISTRATIVELY_DISABLED')) return false;
  return travelerInsightGroups(day.explanations).issues.some((issue) =>
    VERIFIED_PROBLEM.has(issue.severity),
  );
}

/**
 * The day's problems placed where they happen: one that names a single stop on
 * this day goes with that stop, and the rest stay with the day - including one
 * about several stops at once ("2 stops have no time yet"), which is about the
 * day rather than any one of them. Same list, same order, as the day's score
 * card, so a note in the timeline is never something the card does not say.
 */
export function problemsByStop(
  groups: PlanScoreExplanationGroups | null | undefined,
  itemIds: readonly string[],
) {
  const byItem = new Map<string, PlanScoreExplanation[]>();
  const day: PlanScoreExplanation[] = [];
  if (!groups) return { byItem, day };

  const ids = new Set(itemIds);
  for (const issue of travelerInsightGroups(groups).issues) {
    const stops = [...new Set(issue.references.filter((reference) => ids.has(reference)))];
    const itemId = stops.length === 1 ? stops[0] : undefined;
    if (!itemId) {
      day.push(issue);
      continue;
    }
    byItem.set(itemId, [...(byItem.get(itemId) ?? []), issue]);
  }

  return { byItem, day };
}
