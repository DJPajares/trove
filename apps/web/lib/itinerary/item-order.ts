import type { ItineraryDayPart } from './api';

/**
 * Minutes from local midnight each daypart begins. Mirrors `DAY_PART_WINDOWS` in
 * `apps/api/src/services/day-part-windows.ts`; the two must move together, the
 * same way the offline Trip Mode context mirrors the server's phase rules.
 */
const DAY_PART_START_MINUTE: Record<string, number> = {
  afternoon: 720,
  evening: 1020,
  morning: 0,
};

export type ItemSchedulePosition = {
  dayPart: ItineraryDayPart | null;
  localStartTime: string | null;
};

/**
 * Minutes from local midnight the schedule implies, or null when it implies none.
 * `anytime` constrains nothing, so it is untimed.
 */
export function itemSortMinute(item: ItemSchedulePosition): number | null {
  if (item.localStartTime) {
    const [hour = 0, minute = 0] = item.localStartTime.split(':').map(Number);
    return hour * 60 + minute;
  }

  return item.dayPart ? (DAY_PART_START_MINUTE[item.dayPart] ?? null) : null;
}

/**
 * Where a timed item belongs among siblings already in position order. Untimed
 * siblings are transparent — they keep whichever side of the new item they
 * already sat on — so only timed siblings decide the boundary.
 */
export function timedInsertIndex(siblings: ItemSchedulePosition[], key: number) {
  const index = siblings.findIndex((sibling) => {
    const minute = itemSortMinute(sibling);
    return minute !== null && minute > key;
  });

  return index === -1 ? siblings.length : index;
}

/**
 * Moves an item to where its own clock says it belongs within `items`, in place.
 * A no-op for an untimed item, so callers can apply it after any edit.
 */
export function reslotItemByTime<T extends ItemSchedulePosition & { id: string }>(
  items: T[],
  itemId: string,
) {
  const from = items.findIndex((candidate) => candidate.id === itemId);
  if (from === -1) return;
  const item = items[from]!;
  const key = itemSortMinute(item);
  if (key === null) return;

  const siblings = items.filter((_, index) => index !== from);
  siblings.splice(timedInsertIndex(siblings, key), 0, item);
  items.splice(0, items.length, ...siblings);
}
