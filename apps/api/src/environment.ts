import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

type AuthenticationEnvironment = {
  publishableKey: string;
  url: string;
};

type PlacesEnvironment = {
  googlePlacesApiKey: string;
};

type RoutesEnvironment = {
  googleRoutesApiKey: string;
};

type EditorialImagesEnvironment = {
  hourlyBudget: number | null;
  pexelsApiKey: string;
};

export function getAuthenticationEnvironment(
  environment: Record<string, string | undefined> = process.env,
): AuthenticationEnvironment | null {
  const url = environment.SUPABASE_URL;
  const publishableKey = environment.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    return null;
  }

  try {
    new URL(url);
  } catch {
    return null;
  }

  return { publishableKey, url };
}

export function getWebOrigins(environment: Record<string, string | undefined> = process.env) {
  return (environment.TROVE_WEB_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * A single switch that stops every outbound Google request. Both provider
 * factories already return null when their key is absent and the app degrades
 * to `configuration_missing` end to end, so this reuses a path that is already
 * the everyday local one rather than introducing a new failure mode.
 */
export function areGoogleProvidersDisabled(
  environment: Record<string, string | undefined> = process.env,
) {
  const value = environment.TROVE_GOOGLE_PROVIDERS_DISABLED?.trim().toLowerCase();

  return value === '1' || value === 'true';
}

/**
 * Plan Score is the single widest fan-out over Google providers in the app - one
 * request can issue a Places/Routes call per day and per trip place. This is a
 * dedicated feature kill switch so its API and UI can disappear without breaking
 * search, place-details, or day-route views elsewhere.
 */
export function arePlanScoreProvidersDisabled(
  environment: Record<string, string | undefined> = process.env,
) {
  const value = environment.TROVE_PLAN_SCORE_DISABLED?.trim().toLowerCase();

  return value === '1' || value === 'true';
}

export function getPlacesEnvironment(
  environment: Record<string, string | undefined> = process.env,
): PlacesEnvironment | null {
  if (areGoogleProvidersDisabled(environment)) {
    return null;
  }

  const googlePlacesApiKey = environment.GOOGLE_PLACES_API_KEY?.trim();

  return googlePlacesApiKey ? { googlePlacesApiKey } : null;
}

export function getRoutesEnvironment(
  environment: Record<string, string | undefined> = process.env,
): RoutesEnvironment | null {
  if (areGoogleProvidersDisabled(environment)) {
    return null;
  }

  const googleRoutesApiKey = environment.GOOGLE_ROUTES_API_KEY?.trim();

  return googleRoutesApiKey ? { googleRoutesApiKey } : null;
}

/**
 * Editorial imagery is decorative, so nothing in the product breaks when it is
 * off - every surface already has a branded fallback it must be able to reach.
 * That makes a single global switch enough, and it is deliberately separate from
 * the Google one: the two media tracks have different costs and different rules,
 * and turning off travel photography should never turn off place search.
 */
export function areEditorialImagesDisabled(
  environment: Record<string, string | undefined> = process.env,
) {
  const value = environment.TROVE_EDITORIAL_IMAGES_DISABLED?.trim().toLowerCase();

  return value === '1' || value === 'true';
}

export function getEditorialImagesEnvironment(
  environment: Record<string, string | undefined> = process.env,
): EditorialImagesEnvironment | null {
  if (areEditorialImagesDisabled(environment)) {
    return null;
  }

  const pexelsApiKey = environment.PEXELS_API_KEY?.trim();

  if (!pexelsApiKey) {
    return null;
  }

  const parsedBudget = Number(environment.TROVE_EDITORIAL_IMAGE_HOURLY_BUDGET?.trim());
  const hourlyBudget = Number.isInteger(parsedBudget) && parsedBudget > 0 ? parsedBudget : null;

  return { hourlyBudget, pexelsApiKey };
}
