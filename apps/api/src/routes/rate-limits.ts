/**
 * A limit exists here for one of two reasons: the route costs money per request,
 * or anybody at all can reach it. The ceilings sit far above what a person
 * clicking through the app produces and far below what a runaway client does,
 * so they are a backstop against a loop rather than a quota on real use.
 */
const perMinute = (max: number) => ({ rateLimit: { max, timeWindow: '1 minute' } }) as const;

/** Debounced autocomplete: roughly one request per second while typing. */
export const PROVIDER_SEARCH_RATE_LIMIT = perMinute(120);

/** Endpoints where one request becomes many provider calls. */
export const PROVIDER_FANOUT_RATE_LIMIT = perMinute(30);

/**
 * The shared itinerary. It reaches no provider and so costs nothing per request,
 * but it is the one route with no signed-in user behind it, and a link doing the
 * rounds is meant to be opened by a group rather than hammered by one client.
 */
export const PUBLIC_SHARE_RATE_LIMIT = perMinute(60);
