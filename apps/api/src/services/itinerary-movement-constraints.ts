import type { TimingIssue } from '@trove/types';
import type { SchedulingItem } from './itinerary-scheduling-rules.js';

/** Validate the actual proposal, including timed anchors separated by loose stops.
 * Unknown legs never make a suggestion valid; known durations still give a lower
 * bound that manual input must respect, even with incomplete route evidence.
 */
export function movementConnectionConflicts(
  items: readonly SchedulingItem[],
  availability: { startMinute: number; endMinute: number } | null,
  returnTravel: { required: boolean; minutes: number | null },
): TimingIssue[] {
  const issues: TimingIssue[] = [];
  let earliest: number | null = availability?.startMinute ?? null;
  let previousId: string | null = null;
  for (const item of items) {
    if (earliest !== null) earliest += item.inboundTravel?.minutes ?? 0;
    if (item.start) {
      if (earliest !== null && item.start.minutes < earliest)
        issues.push({
          code: 'FIXED_CONFLICT',
          itemId: item.id,
          references: previousId ? [previousId] : [],
          severity: 'conflict',
        });
      earliest =
        Math.max(earliest ?? -Infinity, item.start.minutes) + (item.duration?.minutes ?? 0);
      previousId = item.id;
    } else if (earliest !== null) {
      earliest += item.duration?.minutes ?? 0;
    }
  }
  const last = items.at(-1);
  if (
    last &&
    earliest !== null &&
    availability &&
    earliest + (returnTravel.required ? (returnTravel.minutes ?? 0) : 0) > availability.endMinute
  ) {
    issues.push({
      code: 'FIXED_CONFLICT',
      itemId: last.id,
      references: items.filter((i) => i.id !== last.id).map((i) => i.id),
      severity: 'conflict',
    });
  }
  return issues;
}
