import type { SchedulingOutcome } from '@trove/types';
export const TIMING_REVIEW_EVENT = 'trove:timing-review';
const key = (userId: string, tripId: string) => `trove:timing-review:${userId}:${tripId}`;
export function publishTimingReview(userId: string, tripId: string, outcome?: SchedulingOutcome) {
  if (typeof window === 'undefined' || !outcome) return;
  try {
    window.sessionStorage.removeItem(`${key(userId, tripId)}:pending`);
    window.sessionStorage.setItem(key(userId, tripId), JSON.stringify(outcome));
  } catch {
    /* The live event still carries the review. */
  }
  window.dispatchEvent(new CustomEvent(TIMING_REVIEW_EVENT, { detail: { tripId, outcome } }));
}
export function storedTimingReview(userId: string, tripId: string): SchedulingOutcome | null {
  try {
    const value = window.sessionStorage.getItem(key(userId, tripId));
    return value ? (JSON.parse(value) as SchedulingOutcome) : null;
  } catch {
    return null;
  }
}

export function publishPendingTimingReview(userId: string, tripId: string) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(`${key(userId, tripId)}:pending`, '1');
  } catch {
    /* Still notify the active planner. */
  }
  window.dispatchEvent(new CustomEvent(TIMING_REVIEW_EVENT, { detail: { tripId, pending: true } }));
}
export function storedTimingPending(userId: string, tripId: string) {
  try {
    return window.sessionStorage.getItem(`${key(userId, tripId)}:pending`) === '1';
  } catch {
    return false;
  }
}
