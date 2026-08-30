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

export const DEFAULT_AI_PROVIDER = 'vertex' as const;
export const DEFAULT_AI_MODEL = 'gemini-3.1-flash-lite';
export const DEFAULT_AI_LOCATION = 'global';
export const DEFAULT_AI_TIMEOUT_MS = 60_000;
export const DEFAULT_AI_MAX_OUTPUT_TOKENS = 8_192;

const MIN_AI_TIMEOUT_MS = 1_000;
const MAX_AI_TIMEOUT_MS = 300_000;
const MAX_AI_OUTPUT_TOKENS = 65_536;

type AiUnavailableCode =
  'ai_budget_disabled' | 'ai_disabled' | 'configuration_invalid' | 'configuration_missing';

export type AvailableAiEnvironment = {
  maxOutputTokens: number;
  provider: typeof DEFAULT_AI_PROVIDER;
  status: 'available';
  timeoutMs: number;
  vertex: {
    credentials: { clientEmail: string; privateKey: string } | null;
    location: string;
    model: string;
    project: string;
  };
};

export type AiEnvironment =
  | AvailableAiEnvironment
  | {
      code: AiUnavailableCode;
      maxOutputTokens: number;
      status: 'unavailable';
      timeoutMs: number;
    };

function isEnabled(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
}

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (!value?.trim()) return fallback;

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

/**
 * AI configuration is API-only. Disabled and invalid environments become a
 * recoverable gateway state rather than preventing the manual app from booting.
 */
export function getAiGenerationEnvironment(
  environment: Record<string, string | undefined> = process.env,
): AiEnvironment {
  const timeoutMs = parseBoundedInteger(
    environment.TROVE_AI_TIMEOUT_MS,
    DEFAULT_AI_TIMEOUT_MS,
    MIN_AI_TIMEOUT_MS,
    MAX_AI_TIMEOUT_MS,
  );
  const maxOutputTokens = parseBoundedInteger(
    environment.TROVE_AI_MAX_OUTPUT_TOKENS,
    DEFAULT_AI_MAX_OUTPUT_TOKENS,
    1,
    MAX_AI_OUTPUT_TOKENS,
  );
  const safeTimeoutMs = timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
  const safeMaxOutputTokens = maxOutputTokens ?? DEFAULT_AI_MAX_OUTPUT_TOKENS;

  if (isEnabled(environment.TROVE_AI_DISABLED)) {
    return {
      code: 'ai_disabled',
      maxOutputTokens: safeMaxOutputTokens,
      status: 'unavailable',
      timeoutMs: safeTimeoutMs,
    };
  }

  if (isEnabled(environment.TROVE_AI_BUDGET_DISABLED)) {
    return {
      code: 'ai_budget_disabled',
      maxOutputTokens: safeMaxOutputTokens,
      status: 'unavailable',
      timeoutMs: safeTimeoutMs,
    };
  }

  if (timeoutMs === null || maxOutputTokens === null) {
    return {
      code: 'configuration_invalid',
      maxOutputTokens: safeMaxOutputTokens,
      status: 'unavailable',
      timeoutMs: safeTimeoutMs,
    };
  }

  const provider = environment.TROVE_AI_PROVIDER?.trim() || DEFAULT_AI_PROVIDER;
  const project = environment.GOOGLE_VERTEX_PROJECT?.trim();
  const location = environment.GOOGLE_VERTEX_LOCATION?.trim() || DEFAULT_AI_LOCATION;
  const model = environment.TROVE_AI_MODEL?.trim() || DEFAULT_AI_MODEL;
  const clientEmail = environment.GOOGLE_VERTEX_CLIENT_EMAIL?.trim();
  const privateKey = environment.GOOGLE_VERTEX_PRIVATE_KEY?.trim();

  if (provider !== DEFAULT_AI_PROVIDER || model.length > 120) {
    return {
      code: 'configuration_invalid',
      maxOutputTokens,
      status: 'unavailable',
      timeoutMs,
    };
  }

  if (!project) {
    return {
      code: 'configuration_missing',
      maxOutputTokens,
      status: 'unavailable',
      timeoutMs,
    };
  }

  if (Boolean(clientEmail) !== Boolean(privateKey)) {
    return {
      code: 'configuration_invalid',
      maxOutputTokens,
      status: 'unavailable',
      timeoutMs,
    };
  }

  return {
    maxOutputTokens,
    provider: DEFAULT_AI_PROVIDER,
    status: 'available',
    timeoutMs,
    vertex: {
      credentials:
        clientEmail && privateKey
          ? { clientEmail, privateKey: privateKey.replaceAll('\\n', '\n') }
          : null,
      location,
      model,
      project,
    },
  };
}

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
