import type { PlanScoreReferenceTarget, TripPlanScore } from '@trove/types';

/** Resolve only explanations' existing references against owned rows. No lookups or acquisition. */
export function planScoreReferenceTargets(
  score: TripPlanScore,
  owned: {
    items: readonly { id: string; dayId: string | null }[];
    reservationIds: readonly string[];
    tripPlaceIds: readonly string[];
  },
): Record<string, PlanScoreReferenceTarget> {
  const referenced = new Set(
    [score.explanations, ...score.days.map((day) => day.explanations)]
      .flatMap((groups) => [...groups.worthImproving, ...groups.uncertainty, ...groups.whatWorks])
      .flatMap((reason) => reason.references),
  );
  const targets = new Map<string, PlanScoreReferenceTarget>();
  for (const item of owned.items)
    if (referenced.has(item.id)) targets.set(item.id, { kind: 'item', dayId: item.dayId });
  for (const id of owned.reservationIds)
    if (referenced.has(id) && !targets.has(id)) targets.set(id, { kind: 'reservation' });
  for (const id of owned.tripPlaceIds)
    if (referenced.has(id) && !targets.has(id)) targets.set(id, { kind: 'trip_place' });
  return Object.fromEntries(targets);
}
