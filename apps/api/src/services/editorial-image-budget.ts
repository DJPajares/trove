/**
 * The ceiling on outbound editorial image requests.
 *
 * Pexels allows 200 requests an hour and 20,000 a month, and answers 429 past
 * either. Trove stays under the hourly figure with a rolling window here, and
 * under the monthly one by construction rather than by counting: a subject is
 * resolved once and then cached for 90 days, so steady-state traffic is close
 * to zero and a month cannot approach 20,000 without first breaking the hourly
 * ceiling many times over. Counting months in process would be wrong anyway -
 * the count would reset on every deploy.
 *
 * The breaker exists because the rolling window is only Trove's own estimate.
 * The provider's own remaining-request header is the authority, so a low one -
 * or a 429 - stops outbound requests until the provider says the window reset.
 */
const DEFAULT_HOURLY_BUDGET = 150;
const HOUR_MS = 3_600_000;
/** Below this many remaining provider requests, stop and wait for the reset. */
const REMAINING_HEADROOM = 5;
/** Used when the provider throttles without saying when the window reopens. */
const FALLBACK_BREAKER_MS = 5 * 60_000;

function toNumber(header: string | null) {
  const value = header?.trim();

  if (!value) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

let callTimestamps: number[] = [];
let breakerOpenUntil = 0;

/** Test seam, in the spirit of `resetCachedPlacesMemo`. */
export function resetEditorialImageBudget() {
  callTimestamps = [];
  breakerOpenUntil = 0;
}

export function getEditorialImageHourlyBudget(configured: number | null) {
  return configured ?? DEFAULT_HOURLY_BUDGET;
}

/**
 * Answers whether one more request may leave the process. Callers treat `false`
 * as "no photograph this time", never as an error worth showing anybody.
 */
export function canSpendEditorialImageCall(options: { hourlyBudget: number; now: number }) {
  const { hourlyBudget, now } = options;

  if (now < breakerOpenUntil) {
    return false;
  }

  callTimestamps = callTimestamps.filter((timestamp) => now - timestamp < HOUR_MS);

  return callTimestamps.length < hourlyBudget;
}

export function recordEditorialImageCall(now: number) {
  callTimestamps.push(now);
}

/**
 * Feeds the provider's own accounting back into the breaker. `resetAt` is the
 * `X-Ratelimit-Reset` epoch-seconds value; anything unparseable falls back to a
 * short cool-off rather than trusting the window is fine.
 */
export function noteEditorialImageRateLimitHeaders(options: {
  now: number;
  remaining: string | null;
  resetAt: string | null;
  throttled: boolean;
}) {
  const { now, remaining, resetAt, throttled } = options;
  // An absent header means the provider said nothing about the window, which is
  // not the same as saying nothing is left. `Number(null)` is 0, so this has to
  // be checked before the parse rather than after it.
  const remainingCount = toNumber(remaining);
  const isExhausted =
    throttled || (remainingCount !== null && remainingCount <= REMAINING_HEADROOM);

  if (!isExhausted) {
    return;
  }

  const resetSeconds = toNumber(resetAt);
  const resetMs =
    resetSeconds !== null && resetSeconds * 1_000 > now
      ? resetSeconds * 1_000
      : now + FALLBACK_BREAKER_MS;

  breakerOpenUntil = Math.max(breakerOpenUntil, resetMs);
}
