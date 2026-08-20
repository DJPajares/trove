import { getRoutesEnvironment } from '../environment.js';
import { CachedRoutesService } from './cached-routes.js';
import { GoogleRoutesProvider } from './google-routes.js';
import type { ProviderCallSource } from './provider-usage.js';

export function createRoutesService(options: {
  environment?: Record<string, string | undefined>;
  source: ProviderCallSource;
}) {
  const { environment = process.env, source } = options;
  const routesEnvironment = getRoutesEnvironment(environment);

  if (!routesEnvironment) return null;

  return new CachedRoutesService(
    new GoogleRoutesProvider({ apiKey: routesEnvironment.googleRoutesApiKey, source }),
    () => new Date(),
    source,
  );
}
