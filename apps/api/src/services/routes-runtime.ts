import { getRoutesEnvironment } from '../environment.js';
import { CachedRoutesService } from './cached-routes.js';
import { GoogleRoutesProvider } from './google-routes.js';
import type { ProviderCallBudget, ProviderCallSource } from './provider-usage.js';

export function createRoutesService(options: {
  environment?: Record<string, string | undefined>;
  source: ProviderCallSource;
  budget?: ProviderCallBudget;
}) {
  const { budget, environment = process.env, source } = options;
  const routesEnvironment = getRoutesEnvironment(environment);

  if (!routesEnvironment) return null;

  return new CachedRoutesService(
    new GoogleRoutesProvider({ apiKey: routesEnvironment.googleRoutesApiKey, budget, source }),
    () => new Date(),
    source,
  );
}
