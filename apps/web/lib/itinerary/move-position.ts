/**
 * Where a timed stop belongs on a day it is moved to: before the first stop
 * there that starts later, otherwise at the end. Untimed stops keep their
 * order and neither attract nor block it, and a stop with no time of its own
 * goes to the end, as before.
 *
 * Placing by time is what keeps a 2:15 PM brunch from landing after a 7:35 PM
 * flight, an order no schedule can meet.
 */
export function chronologicalPosition(
  items: ReadonlyArray<{ localStartTime: string | null }>,
  localStartTime: string | null,
): number {
  const clock = (value: string) => value.slice(0, 5);
  if (!localStartTime) return items.length;
  const moving = clock(localStartTime);
  const later = items.findIndex(
    (item) => item.localStartTime !== null && clock(item.localStartTime) > moving,
  );
  return later === -1 ? items.length : later;
}
