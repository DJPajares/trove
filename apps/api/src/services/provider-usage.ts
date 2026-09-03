import { createHash } from 'node:crypto';

/**
 * Every outbound request to a metered provider passes through here.
 *
 * Two jobs, both learned from the incident this module exists because of: the
 * log line makes spend attributable to a caller after the fact, and the counters
 * let a test assert how many provider calls a code path costs. Without the
 * second, a regression that reintroduces a fan-out is invisible until the bill
 * arrives.
 */
export const PROVIDER_CALL_SOURCES = [
  'ai-planner',
  'ai-planner-review',
  'currency',
  'editorial-image-reconciliation',
  'editorial-images',
  'global-search',
  'itinerary',
  'itinerary-routes',
  'itinerary-time-suggestions',
  'place-resolution',
  'places-autocomplete',
  'plan-score',
  'public-share',
  'screen-hydration',
  'trip-mode-context',
  'trip-places',
  'weather',
  'test',
] as const;

export type ProviderCallSource = (typeof PROVIDER_CALL_SOURCES)[number];

export type ProviderCacheMissReason =
  | 'cache_read_failed'
  | 'evidence_memo_expired'
  | 'evidence_not_memoized'
  | 'grounding_reference_changed'
  | 'grounding_match_changed'
  | 'invalid_grounding_mapping'
  | 'incomplete_snapshot'
  | 'language_mismatch'
  | 'missing_editorial_image'
  | 'missing_grounding_mapping'
  | 'missing_leg'
  | 'missing_snapshot'
  | 'negative_cache_expired'
  | 'polyline_missing'
  | 'stale_editorial_image'
  | 'stale_grounding_mapping'
  | 'incomplete_forecast'
  | 'stale_forecast'
  | 'stale_leg'
  | 'stale_snapshot';

export type ProviderExpectedSku =
  /**
   * Pexels bills nothing; it caps requests per hour and per month instead. It is
   * counted here anyway so an editorial fan-out is caught by the same tests that
   * catch a Places one, rather than only surfacing as a throttled provider.
   */
  | 'currency-rates-free'
  | 'editorial-images-free'
  | 'places-autocomplete-requests'
  | 'places-text-search-pro'
  | 'places-text-search-enterprise'
  | 'place-details-pro'
  | 'place-details-enterprise'
  | 'routes-compute-routes-essentials'
  | 'weather-forecast-free';

type ProviderEventBase = {
  operation: 'computeRoute' | 'getDetails' | 'getForecast' | 'getRates' | 'search' | 'textSearch';
  provider: 'frankfurter' | 'google' | 'open_meteo' | 'pexels';
  source: ProviderCallSource;
};

export type ProviderCall = ProviderEventBase & {
  cacheMissReason?: ProviderCacheMissReason;
  detailLevel?: 'evidence' | 'location';
  /** The provider endpoint, normalised so it contains no provider ids. */
  endpoint:
    | '/directions/v2:computeRoutes'
    | '/v2/rates'
    | '/v1/places/:placeId'
    | '/v1/places:autocomplete'
    | '/v1/places:searchText'
    | '/v1/search'
    | '/v1/forecast';
  expectedSku: ProviderExpectedSku;
  includePolyline?: boolean;
  kind: 'outbound';
  placeFingerprint?: string;
  routeMode?: 'drive' | 'transit' | 'walk';
};

export type ProviderCacheEvent = ProviderEventBase & {
  cache:
    | 'currency'
    | 'editorial-image'
    | 'place-details'
    | 'place-evidence'
    | 'place-grounding'
    | 'route'
    | 'weather-forecast';
  failureCode?: 'NOT_FOUND' | 'UNUSABLE_LOCATION';
  includePolyline?: boolean;
  kind: 'cache_hit' | 'negative_cache_hit';
  placeFingerprint?: string;
  routeMode?: 'drive' | 'transit' | 'walk';
};

export type ProviderUsageEvent = ProviderCall | ProviderCacheEvent;
export type ProviderUsageSink = (event: ProviderUsageEvent) => void;

const counts = new Map<string, number>();
let sink: ProviderUsageSink | null = null;

export const AI_PLANNER_PROVIDER_CALL_LIMIT = 50;

/** A request-scoped guard shared by every billable Google provider client. */
export class ProviderCallBudget {
  private usedCalls = 0;

  constructor(readonly limit = AI_PLANNER_PROVIDER_CALL_LIMIT) {
    if (!Number.isInteger(limit) || limit < 0) {
      throw new RangeError('provider_call_budget_limit_invalid');
    }
  }

  claim() {
    if (this.usedCalls >= this.limit) return false;
    this.usedCalls += 1;
    return true;
  }

  snapshot() {
    return {
      limit: this.limit,
      remaining: Math.max(0, this.limit - this.usedCalls),
      used: this.usedCalls,
    };
  }
}

function countKey(call: Pick<ProviderCall, 'operation' | 'provider'>) {
  return `${call.provider}:${call.operation}`;
}

export function setProviderUsageSink(next: ProviderUsageSink | null) {
  sink = next;
}

export function providerTargetFingerprint(providerId: string) {
  return createHash('sha256').update(providerId).digest('hex').slice(0, 12);
}

export function recordProviderCall(call: Omit<ProviderCall, 'kind'>) {
  counts.set(countKey(call), (counts.get(countKey(call)) ?? 0) + 1);
  sink?.({ ...call, kind: 'outbound' });
}

export function recordProviderCacheEvent(event: ProviderCacheEvent) {
  sink?.(event);
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
