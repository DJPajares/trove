/**
 * Every outbound Google request passes through here.
 *
 * Two jobs, both learned from the incident this module exists because of: the
 * log line makes spend attributable to a caller after the fact, and the counters
 * let a test assert how many provider calls a code path costs. Without the
 * second, a regression that reintroduces a fan-out is invisible until the bill
 * arrives.
 */
export type ProviderCall = {
  /** The provider endpoint, without query parameters or ids. */
  endpoint: string;
  operation: string;
  provider: 'google';
};

export type ProviderUsageSink = (call: ProviderCall) => void;

const counts = new Map<string, number>();
let sink: ProviderUsageSink | null = null;

function countKey(call: ProviderCall) {
  return `${call.provider}:${call.operation}`;
}

export function setProviderUsageSink(next: ProviderUsageSink | null) {
  sink = next;
}

export function recordProviderCall(call: ProviderCall) {
  counts.set(countKey(call), (counts.get(countKey(call)) ?? 0) + 1);
  sink?.(call);
}

export function getProviderCallCounts(): Record<string, number> {
  return Object.fromEntries(counts);
}

export function getProviderCallTotal() {
  return [...counts.values()].reduce((total, count) => total + count, 0);
}

export function resetProviderCallCounts() {
  counts.clear();
}
