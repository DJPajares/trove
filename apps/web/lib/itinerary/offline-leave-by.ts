import type { OfflineLeg, RouteTravelMode } from '@/lib/itinerary/api';

/** The same slack the server adds, so "leave by" reads the same offline and on. */
export const OFFLINE_LEAVE_BY_BUFFER_SECONDS = 5 * 60;

/**
 * "Leave by", from a leg Trove measured before the connection went.
 *
 * The same rule the server applies: both stops are places, the next one has a
 * start still ahead, and the leg between them was measured. With no measured
 * leg there is no leave-by - offline Trip Mode never guesses a travel time.
 */
export function offlineLeaveBy(input: {
  at: number;
  currentItem: { id: string; tripPlace: unknown } | null;
  legs: readonly OfflineLeg[];
  nextItem: { id: string; tripPlace: unknown } | null;
  targetStart: number | null;
}) {
  const { currentItem, nextItem, targetStart } = input;
  if (!currentItem?.tripPlace || !nextItem?.tripPlace || targetStart === null) return null;
  if (targetStart <= input.at) return null;

  const leg = input.legs.find(
    (candidate) =>
      candidate.originItemId === currentItem.id && candidate.destinationItemId === nextItem.id,
  );
  if (!leg) return null;

  return {
    at: new Date(
      targetStart - (leg.durationSeconds + OFFLINE_LEAVE_BY_BUFFER_SECONDS) * 1_000,
    ).toISOString(),
    bufferSeconds: OFFLINE_LEAVE_BY_BUFFER_SECONDS,
    destinationItemId: nextItem.id,
    distanceMeters: leg.distanceMeters,
    /** When the travel time was measured; offline, the screen says how old it is. */
    measuredAt: leg.fetchedAt,
    mode: leg.mode as RouteTravelMode,
    originItemId: currentItem.id,
    provider: 'google' as const,
    routeDurationSeconds: leg.durationSeconds,
    targetStartAt: new Date(targetStart).toISOString(),
  };
}
