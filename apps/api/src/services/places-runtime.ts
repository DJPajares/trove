import { getPlacesEnvironment } from '../environment.js';
import { CachedPlacesService } from './cached-places.js';
import { GooglePlacesProvider } from './google-places.js';
import { type PlacesLogger } from './places.js';
import type { ProviderCallSource } from './provider-usage.js';

/**
 * Every caller gets a caching service. The cache it reads lives in the database
 * and in module state, not on the instance, so the several call paths that
 * build one per request cost nothing beyond the allocation.
 */
export function createPlacesService(options: {
  environment?: Record<string, string | undefined>;
  logger?: PlacesLogger;
  source: ProviderCallSource;
}) {
  const { environment = process.env, logger, source } = options;
  const placesEnvironment = getPlacesEnvironment(environment);

  if (!placesEnvironment) {
    return null;
  }

  return new CachedPlacesService(
    new GooglePlacesProvider({ apiKey: placesEnvironment.googlePlacesApiKey, source }),
    () => new Date(),
    logger,
    source,
  );
}
