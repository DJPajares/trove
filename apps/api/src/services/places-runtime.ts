import { getPlacesEnvironment } from '../environment.js';
import { GooglePlacesProvider } from './google-places.js';
import { PlacesService } from './places.js';

export function createPlacesService(environment: Record<string, string | undefined> = process.env) {
  const placesEnvironment = getPlacesEnvironment(environment);

  if (!placesEnvironment) {
    return null;
  }

  return new PlacesService(
    new GooglePlacesProvider({ apiKey: placesEnvironment.googlePlacesApiKey }),
  );
}
