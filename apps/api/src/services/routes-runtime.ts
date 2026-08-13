import { getRoutesEnvironment } from '../environment.js';
import { GoogleRoutesProvider } from './google-routes.js';
import { RoutesService } from './routes.js';

export function createRoutesService(environment: Record<string, string | undefined> = process.env) {
  const routesEnvironment = getRoutesEnvironment(environment);

  if (!routesEnvironment) return null;

  return new RoutesService(
    new GoogleRoutesProvider({ apiKey: routesEnvironment.googleRoutesApiKey }),
  );
}
