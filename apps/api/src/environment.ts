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
 * dedicated switch so it can be turned off without also breaking search,
 * place-details, and day-route views, which `TROVE_GOOGLE_PROVIDERS_DISABLED`
 * would.
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
