import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';

import { MAX_PLACE_PHOTOS } from './services/place-photo-policy.js';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

type AuthenticationEnvironment = {
  publishableKey: string;
  url: string;
};

type PlacesEnvironment = {
  googlePlacesApiKey: string;
  googlePlacePhotoLimit: number;
};

type RoutesEnvironment = {
  googleRoutesApiKey: string;
};

type EditorialImagesEnvironment = {
  hourlyBudget: number | null;
  pexelsApiKey: string;
};

export const DEFAULT_AI_PROVIDER = 'vertex' as const;
export const DEFAULT_AI_MODEL = 'gemini-3.8-flash';
export const DEFAULT_AI_LOCATION = 'global';
export const DEFAULT_AI_TIMEOUT_MS = 120_000;
export const DEFAULT_AI_MAX_OUTPUT_TOKENS = 16_384;
export const DEFAULT_AI_THINKING_LEVEL = 'medium' as const;
export const DEFAULT_AI_PLANNING_DISPATCH_LIMIT = 5;

const MIN_AI_TIMEOUT_MS = 1_000;
const MAX_AI_TIMEOUT_MS = 300_000;
const MAX_AI_OUTPUT_TOKENS = 65_536;
const MAX_AI_PLANNING_DISPATCH_LIMIT = 1_000;

type AiThinkingLevel = 'low' | 'medium' | 'high';

function isAiThinkingLevel(value: string): value is AiThinkingLevel {
  return value === 'low' || value === 'medium' || value === 'high';
}

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
    thinkingLevel: AiThinkingLevel;
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
 * Google resolves Application Default Credentials lazily, inside the first
 * generation request, so an unauthenticated environment would otherwise read as
 * `available` and only fail after a dispatch was spent. Detecting the ADC source
 * up front keeps the missing credential a configuration state.
 *
 * Metadata-server credentials on GCE and Cloud Run cannot be detected
 * synchronously. The API deploys to Vercel, which has no metadata server, so a
 * GCP host must set the explicit credential pair or GOOGLE_APPLICATION_CREDENTIALS.
 */
function detectApplicationDefaultCredentials(environment: Record<string, string | undefined>) {
  if (environment.GOOGLE_APPLICATION_CREDENTIALS?.trim()) return true;

  const configRoot = environment.CLOUDSDK_CONFIG?.trim()
    ? environment.CLOUDSDK_CONFIG.trim()
    : environment.APPDATA?.trim()
      ? join(environment.APPDATA.trim(), 'gcloud')
      : environment.HOME?.trim()
        ? join(environment.HOME.trim(), '.config', 'gcloud')
        : null;

  return configRoot ? existsSync(join(configRoot, 'application_default_credentials.json')) : false;
}

/**
 * AI configuration is API-only. Disabled and invalid environments become a
 * recoverable gateway state rather than preventing the manual app from booting.
 */
export function getAiGenerationEnvironment(
  environment: Record<string, string | undefined> = process.env,
  hasApplicationDefaultCredentials = detectApplicationDefaultCredentials,
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
  const thinkingLevel = environment.TROVE_AI_THINKING_LEVEL?.trim() || DEFAULT_AI_THINKING_LEVEL;
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

  if (timeoutMs === null || maxOutputTokens === null || !isAiThinkingLevel(thinkingLevel)) {
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

  if (provider !== DEFAULT_AI_PROVIDER || model.length > 120 || /^gemini-2\.5(?:-|$)/.test(model)) {
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

  if (!clientEmail && !privateKey && !hasApplicationDefaultCredentials(environment)) {
    return {
      code: 'configuration_missing',
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
      thinkingLevel,
    },
  };
}

/**
 * A soft limit, not a hard dependency like credentials — an invalid value falls
 * back to the default rather than becoming a new `configuration_invalid` gate.
 */
export function getAiPlanningDispatchLimit(
  environment: Record<string, string | undefined> = process.env,
) {
  return (
    parseBoundedInteger(
      environment.TROVE_AI_PLANNING_DISPATCH_LIMIT,
      DEFAULT_AI_PLANNING_DISPATCH_LIMIT,
      0,
      MAX_AI_PLANNING_DISPATCH_LIMIT,
    ) ?? DEFAULT_AI_PLANNING_DISPATCH_LIMIT
  );
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

/** Server-only Storage credential. Never expose this through an API response. */
export function getStorageCleanupEnvironment(
  environment: Record<string, string | undefined> = process.env,
) {
  const url = environment.SUPABASE_URL;
  const secretKey = environment.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secretKey) return null;
  try {
    new URL(url);
    return { url, secretKey };
  } catch {
    return null;
  }
}

/**
 * Scheduled maintenance runs as a Vercel Cron request rather than as a signed-in
 * user, so it authenticates with a shared secret instead of a Supabase session.
 * Absent secret means the maintenance route stays closed.
 */
export function getMaintenanceEnvironment(
  environment: Record<string, string | undefined> = process.env,
) {
  const cronSecret = environment.CRON_SECRET?.trim();

  return cronSecret ? { cronSecret } : null;
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

  return googlePlacesApiKey
    ? { googlePlacesApiKey, googlePlacePhotoLimit: getGooglePlacePhotoLimit(environment) }
    : null;
}

let warnedInvalidPhotoLimit = false;

/** Photo configuration cannot disable functional Places requests or silently increase spend. */
export function getGooglePlacePhotoLimit(
  environment: Record<string, string | undefined> = process.env,
) {
  const limit = parseBoundedInteger(
    environment.GOOGLE_PLACE_PHOTO_LIMIT,
    MAX_PLACE_PHOTOS,
    0,
    MAX_PLACE_PHOTOS,
  );
  if (limit !== null) return limit;
  if (!warnedInvalidPhotoLimit) {
    warnedInvalidPhotoLimit = true;
    console.warn(
      'GOOGLE_PLACE_PHOTO_LIMIT must be an integer from 0 to 3; using 0 to disable new Google photo requests.',
    );
  }
  return 0;
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
