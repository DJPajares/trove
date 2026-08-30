import { getPlacesEnvironment, getRoutesEnvironment } from '../environment.js';
import { CachedPlacesService } from './cached-places.js';
import { CachedRoutesService } from './cached-routes.js';
import { GooglePlacesProvider } from './google-places.js';
import { GoogleRoutesProvider } from './google-routes.js';
import type { PlacesLogger } from './places.js';
import { ProviderCallBudget } from './provider-usage.js';

/** One context per Generate/Regenerate run; every Google path shares its budget. */
export function createAiPlannerProviderContext(
  options: {
    environment?: Record<string, string | undefined>;
    logger?: PlacesLogger;
  } = {},
) {
  const environment = options.environment ?? process.env;
  const budget = new ProviderCallBudget();
  const placesEnvironment = getPlacesEnvironment(environment);
  const routesEnvironment = getRoutesEnvironment(environment);
  const placesProvider = placesEnvironment
    ? new GooglePlacesProvider({
        apiKey: placesEnvironment.googlePlacesApiKey,
        budget,
        source: 'ai-planner',
      })
    : null;

  return {
    budget,
    placesProvider,
    placesService: placesProvider
      ? new CachedPlacesService(placesProvider, () => new Date(), options.logger, 'ai-planner')
      : null,
    routesService: routesEnvironment
      ? new CachedRoutesService(
          new GoogleRoutesProvider({
            apiKey: routesEnvironment.googleRoutesApiKey,
            budget,
            source: 'ai-planner',
          }),
          () => new Date(),
          'ai-planner',
        )
      : null,
  };
}
