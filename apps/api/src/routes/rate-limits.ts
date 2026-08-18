/**
 * Only provider-backed routes carry a limit, because they are the only ones
 * that cost money per request. The ceilings sit far above what a person
 * clicking through the app produces and far below what a runaway client does,
 * so they are a backstop against a loop rather than a quota on real use.
 */
const perMinute = (max: number) => ({ rateLimit: { max, timeWindow: '1 minute' } }) as const;

/** Debounced autocomplete: roughly one request per second while typing. */
export const PROVIDER_SEARCH_RATE_LIMIT = perMinute(120);

/** Place details and photos, fetched per place across a list. */
export const PROVIDER_DETAILS_RATE_LIMIT = perMinute(120);

/** Endpoints where one request becomes many provider calls. */
export const PROVIDER_FANOUT_RATE_LIMIT = perMinute(30);
