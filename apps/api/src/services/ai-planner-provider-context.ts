import { getPlacesEnvironment, getRoutesEnvironment } from '../environment.js';
import { CachedPlacesService } from './cached-places.js';
import { CachedRoutesService } from './cached-routes.js';
import { GooglePlacesProvider } from './google-places.js';
import { GoogleRoutesProvider } from './google-routes.js';
import type { PlacesLogger } from './places.js';
import { ProviderCallBudget, type ProviderCallSource } from './provider-usage.js';

/** One context per Generate/Regenerate run; every Google path shares its budget. */
export function createAiPlannerProviderContext(
  options: {
    budget?: ProviderCallBudget;
    environment?: Record<string, string | undefined>;
    logger?: PlacesLogger;
    source?: ProviderCallSource;
  } = {},
) {
  const environment = options.environment ?? process.env;
  const budget = options.budget ?? new ProviderCallBudget();
  const source = options.source ?? 'ai-planner';
  const placesEnvironment = getPlacesEnvironment(environment);
  const routesEnvironment = getRoutesEnvironment(environment);
  const placesProvider = placesEnvironment
    ? new GooglePlacesProvider({
        apiKey: placesEnvironment.googlePlacesApiKey,
        budget,
        source,
      })
    : null;

  return {
    budget,
    placesProvider,
    placesService: placesProvider
      ? new CachedPlacesService(placesProvider, () => new Date(), options.logger, source)
      : null,
    routesService: routesEnvironment
      ? new CachedRoutesService(
          new GoogleRoutesProvider({
            apiKey: routesEnvironment.googleRoutesApiKey,
            budget,
            source,
          }),
          () => new Date(),
          source,
        )
      : null,
  };
}
