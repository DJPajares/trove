import { getRoutesEnvironment } from '../environment.js';
import { CachedRoutesService } from './cached-routes.js';
import { GoogleRoutesProvider } from './google-routes.js';

export function createRoutesService(environment: Record<string, string | undefined> = process.env) {
  const routesEnvironment = getRoutesEnvironment(environment);

  if (!routesEnvironment) return null;

  return new CachedRoutesService(
    new GoogleRoutesProvider({ apiKey: routesEnvironment.googleRoutesApiKey }),
  );
}
