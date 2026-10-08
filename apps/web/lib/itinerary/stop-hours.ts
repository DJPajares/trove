import type { PlaceHoursStatus } from './api';

/**
 * Whether a stop is open when the traveller plans to be there.
 *
 * - `closed_day`: the place is closed all day on this date.
 * - `closed_at`: closed at the planned time; `opens` is its next opening that
 *   day, if it has one.
 * - `closes_during`: open on arrival, closing before the visit ends.
 * - `open_until`: open on arrival and for the whole visit as far as is known.
 * - `open_all_day`: open around the clock.
 *
 * Null when there are no stored hours to go on, or no planned time to hold
 * them against - a stop's hours for the day still say something then, and the
 * caller shows those instead.
 */
export type StopHoursAt =
  | { kind: 'closed_day' }
  | { kind: 'closed_at'; opens: string | null }
  | { close: string; kind: 'closes_during' }
  | { close: string; kind: 'open_until' }
  | { kind: 'open_all_day' };

const DAY_MINUTES = 24 * 60;

function minutesOf(time: string) {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return hour * 60 + minute;
}

/**
 * Reads stored, day-local hours against a stop's planned start and end. Spans
 * that run past midnight arrive closing at `24:00`, and an end earlier than the
 * start is a visit running past midnight, so it counts as later, not earlier.
 */
export function stopHoursAt(
  status: PlaceHoursStatus | undefined,
  start: string | null,
  end: string | null,
): StopHoursAt | null {
  if (!status) return null;
  if (status.status === 'closed') return { kind: 'closed_day' };

  const spans = status.spans
    .map((span) => ({ close: span.close, closeAt: minutesOf(span.close), open: span.open }))
    .map((span) => ({ ...span, openAt: minutesOf(span.open) }))
    .toSorted((left, right) => left.openAt - right.openAt);
  if (spans.length === 1 && spans[0]?.openAt === 0 && spans[0].closeAt >= DAY_MINUTES) {
    return { kind: 'open_all_day' };
  }
  if (!start) return null;

  const startAt = minutesOf(start);
  const span = spans.find(
    (candidate) => candidate.openAt <= startAt && startAt < candidate.closeAt,
  );
  if (!span) {
    const next = spans.find((candidate) => candidate.openAt > startAt);
    return { kind: 'closed_at', opens: next?.open ?? null };
  }

  if (end) {
    const endAt = minutesOf(end);
    const visitEnd = endAt <= startAt ? endAt + DAY_MINUTES : endAt;
    if (visitEnd > span.closeAt) return { close: span.close, kind: 'closes_during' };
  }

  return { close: span.close, kind: 'open_until' };
}
