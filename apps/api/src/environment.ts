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

export function getPlacesEnvironment(
  environment: Record<string, string | undefined> = process.env,
): PlacesEnvironment | null {
  const googlePlacesApiKey = environment.GOOGLE_PLACES_API_KEY?.trim();

  return googlePlacesApiKey ? { googlePlacesApiKey } : null;
}
