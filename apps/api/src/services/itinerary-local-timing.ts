import { floatingLocalTimeToInstant, formatLocalTime } from './itinerary-rules.js';
import { isValidIanaTimeZone } from './trip-rules.js';

/** Optional metadata for reminders/live travel. Never validate or schedule with it. */
export function derivedPlanInstant(date: string, time: string, zone: string | null | undefined) {
  if (!zone) return null;
  try {
    return floatingLocalTimeToInstant(date, time, zone);
  } catch {
    return null;
  }
}

type PlannedTiming = {
  localStartTime: Date | null;
  startInstant: Date | null;
  timeSemantics: string | null;
  timeZone: string | null;
  timeZoneSource?: string | null;
  customLocationTimeZone?: string | null;
  travelStatus?: string;
  reservationCount?: number;
  _count?: { reservations: number };
};

/** Resolve optional event metadata for a newly located plan, keeping its civil clock.
 * Scheduling, scoring and suggestions never read this derived instant.
 * Explicit clocks, bookings, authoritative instants and travel history are stable.
 */
export function resolvePlannedItemTiming<T extends PlannedTiming>(
  item: T,
  context: {
    date: string;
    dayTimeZone: string;
    placeTimeZone: string | null;
  },
): T {
  if (
    item.timeSemantics === 'AUTHORITATIVE_INSTANT' ||
    ['COMPLETED', 'SKIPPED'].includes(item.travelStatus ?? '') ||
    (item.reservationCount ?? item._count?.reservations ?? 0) > 0 ||
    item.timeZoneSource === 'EXPLICIT' ||
    (item.customLocationTimeZone && isValidIanaTimeZone(item.customLocationTimeZone))
  )
    return item;
  const zone = context.placeTimeZone ?? item.timeZone ?? context.dayTimeZone;
  const source = context.placeTimeZone ? 'PLACE' : (item.timeZoneSource ?? 'DAY_DEFAULT');
  let startInstant = item.startInstant;
  if (item.localStartTime) {
    try {
      startInstant = floatingLocalTimeToInstant(
        context.date,
        formatLocalTime(item.localStartTime)!,
        zone,
      );
    } catch {
      startInstant = null;
    } // DST gaps remain unresolved; never invent an instant.
  }
  if (
    zone === item.timeZone &&
    source === item.timeZoneSource &&
    startInstant?.getTime() === item.startInstant?.getTime()
  )
    return item;
  return {
    ...item,
    timeZone: zone,
    timeZoneSource: source,
    startInstant,
    ...(item.localStartTime ? { timeSemantics: 'FLOATING_LOCAL' } : {}),
  };
}
