/** Weather acquisition is reused for three hours; reads never renew its age. */
export const WEATHER_CACHE_TTL_MS = 3 * 60 * 60 * 1_000;
