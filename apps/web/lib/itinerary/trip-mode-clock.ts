import { localDateInTimeZone, localPreviewInstant, type TripModeContext } from './api';

/**
 * Minutes from local midnight where the day changes character. Mirrors
 * `DAY_PART_WINDOWS` in `apps/api/src/services/day-part-windows.ts`: Morning
 * gives way to Afternoon at noon, and to Evening at 17:00.
 */
const DAY_PART_BOUNDARY_MINUTES = [720, 1020];

function formatMinute(minute: number) {
  const hour = Math.floor(minute / 60);
  return `${String(hour).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function addDay(date: string) {
  const [year = 1970, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/**
 * The next instant at which the local wall clock in `timeZone` reads `minute`
 * minutes past midnight. Today's occurrence when it is still ahead, otherwise
 * tomorrow's — so midnight always resolves to the coming one.
 */
function nextLocalMinute(now: Date, timeZone: string, minute: number) {
  const today = localDateInTimeZone(timeZone, now);
  const time = formatMinute(minute);
  const candidate = localPreviewInstant(today, time, timeZone);

  return candidate > now ? candidate : localPreviewInstant(addDay(today), time, timeZone);
}

/**
 * The earliest moment at which Trip Mode's answer to "what now?" could differ
 * from what it says at `now`.
 *
 * The Now tab reads a server verdict rather than recomputing one, so instead of
 * polling it waits for the exact moments that verdict depends on: an item
 * starting, an item's duration running out, the leave-by alarm, the daypart
 * turning over, and local midnight rolling the day. Returns null when nothing
 * ahead can change the answer.
 */
export function nextTripModeBoundary(context: TripModeContext, now: Date): Date | null {
  const candidates: Date[] = [];
  // An item with no instant is phased against the local clock in its own zone,
  // falling back to the day's, so each zone in play has to be watched.
  const phaseZones = new Set([context.day?.defaultTimeZone ?? context.trip.referenceTimeZone]);
  const scheduledItems = (context.day?.items ?? []).filter(
    (item) => item.travelStatus === 'upcoming' && item.startInstant,
  );
  const latestScheduledStart = Math.max(
    ...scheduledItems.map((item) => new Date(item.startInstant!).getTime()),
  );

  for (const item of context.day?.items ?? []) {
    if (item.travelStatus !== 'upcoming') continue;
    if (item.timeZone) phaseZones.add(item.timeZone);
    if (!item.startInstant) continue;

    const start = new Date(item.startInstant);
    candidates.push(start);
    if (item.durationMinutes) {
      candidates.push(new Date(start.getTime() + item.durationMinutes * 60_000));
    } else if (start.getTime() === latestScheduledStart) {
      candidates.push(new Date(start.getTime() + 60 * 60_000));
    }
  }

  if (context.leaveBy) candidates.push(new Date(context.leaveBy.at));

  // A daypart turnover moves an item between morning, afternoon and evening;
  // midnight is what flips one to overdue.
  for (const zone of phaseZones) {
    for (const minute of [0, ...DAY_PART_BOUNDARY_MINUTES]) {
      candidates.push(nextLocalMinute(now, zone, minute));
    }
  }
  // Midnight in the trip's reference zone is separately what rolls `selectedDate`.
  candidates.push(nextLocalMinute(now, context.trip.referenceTimeZone, 0));

  const ahead = candidates
    .filter((candidate) => Number.isFinite(candidate.getTime()) && candidate > now)
    .sort((left, right) => left.getTime() - right.getTime());

  return ahead[0] ?? null;
}

/** Never sooner than this, so a skewed clock cannot spin the tab. */
export const MIN_REFRESH_DELAY_MS = 15_000;
/** Never later than this, so a quiet day still self-heals. */
export const MAX_REFRESH_DELAY_MS = 15 * 60_000;

/** How long to wait before re-asking the server, given the next boundary. */
export function refreshDelayMs(boundary: Date | null, now: Date) {
  if (!boundary) return MAX_REFRESH_DELAY_MS;
  const delay = boundary.getTime() - now.getTime();

  return Math.min(Math.max(delay, MIN_REFRESH_DELAY_MS), MAX_REFRESH_DELAY_MS);
}
