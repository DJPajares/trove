import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { getWebOrigins } from './environment.js';
import { setAiGenerationTelemetrySink } from './services/ai-generation-telemetry.js';
import { setAiPlanningTelemetrySink } from './services/ai-planning-telemetry.js';
import { setProviderUsageSink } from './services/provider-usage.js';
import { registerAuthenticationRoutes } from './routes/auth.js';
import { registerAiPlanningSessionRoutes } from './routes/ai-planning-sessions.js';
import { registerCurrencyRoutes } from './routes/currency.js';
import { registerEditorialImageRoutes } from './routes/editorial-images.js';
import { registerExpenseRoutes } from './routes/expenses.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerItineraryRoutes } from './routes/itineraries.js';
import { registerMaintenanceRoutes } from './routes/maintenance.js';
import { registerMemoryRoutes } from './routes/memories.js';
import { registerNotificationRoutes } from './routes/notifications.js';
import { registerPlacesRoutes } from './routes/places.js';
import { registerPlanScoreRoutes } from './routes/plan-score.js';
import { registerProfileRoutes } from './routes/profile.js';
import { registerPublicTripRoutes } from './routes/public-trips.js';
import { registerReservationRoutes } from './routes/reservations.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerTripRoutes } from './routes/trips.js';
import { registerTripPlacesRoutes } from './routes/trip-places.js';
import { registerTripInfoRoutes } from './routes/trip-info.js';
import { registerSavedPlacesRoutes } from './routes/saved-places.js';
import { registerTasksRoutes } from './routes/tasks.js';
import { registerWeatherRoutes } from './routes/weather.js';

function originMatches(allowedOrigin: string, origin: string) {
  if (allowedOrigin === origin) {
    return true;
  }

  if (!allowedOrigin.includes('*')) {
    return false;
  }

  try {
    const allowedUrl = new URL(allowedOrigin);
    const originUrl = new URL(origin);

    if (allowedUrl.protocol !== originUrl.protocol || allowedUrl.port !== originUrl.port) {
      return false;
    }

    const hostnamePattern = allowedUrl.hostname
      .split('*')
      .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'))
      .join('[^.]*');

    return new RegExp(`^${hostnamePattern}$`).test(originUrl.hostname);
  } catch {
    return false;
  }
}

/**
 * Prisma reports schema and constraint problems through codes rather than
 * distinguishable error types. Naming the few that a running deployment can
 * actually hit turns an opaque failure into one the client can explain: a
 * database behind on migrations reads very differently from a real bug.
 */
function describeError(error: unknown) {
  const { code, statusCode } = (error ?? {}) as { code?: unknown; statusCode?: unknown };
  const known: Record<string, string> = {
    P1001: 'database_unavailable',
    P1002: 'database_unavailable',
    P2003: 'record_referenced',
    P2021: 'database_schema_outdated',
    P2022: 'database_schema_outdated',
  };

  return {
    code: typeof code === 'string' ? (known[code] ?? code) : 'internal_error',
    isKnownPrismaFailure: typeof code === 'string' && code in known,
    statusCode: typeof statusCode === 'number' ? statusCode : 500,
  };
}

export function buildApp() {
  // Google Place IDs for address-only results (no POI) run well past Fastify's
  // default 100-char route param limit; `/places/:providerPlaceId` already
  // validates up to 512 chars, so the router needs the same ceiling or those
  // requests never reach the handler at all.
  const app = Fastify({ logger: true, maxParamLength: 512 });
  const allowedOrigins = getWebOrigins();

  app.setErrorHandler((error: unknown, request, reply) => {
    const described = describeError(error);
    // Fastify's own client errors already carry a usable status and code.
    if (described.statusCode < 500 && !described.isKnownPrismaFailure) {
      return reply.code(described.statusCode).send({ code: described.code });
    }
    request.log.error({ err: error }, 'unhandled request error');
    return reply.code(500).send({ code: described.code });
  });

  void app.register(cors, {
    methods: ['DELETE', 'GET', 'PATCH', 'POST', 'PUT', 'OPTIONS'],
    origin(origin, callback) {
      callback(
        null,
        origin === undefined ||
          allowedOrigins.some((allowedOrigin) => originMatches(allowedOrigin, origin)),
      );
    },
  });

  // Spend on Google is only attributable after the fact if every outbound call
  // is logged with the operation that caused it.
  setProviderUsageSink((event) => {
    if (event.kind === 'cache_hit') {
      app.log.debug(event, 'google provider cache hit');
      return;
    }
    app.log.info(
      event,
      event.kind === 'negative_cache_hit'
        ? 'google provider negative cache hit'
        : 'google provider request',
    );
  });

  // AI telemetry deliberately carries only provider/model identifiers, timing,
  // token counts, and a normalized result. Prompts and generated objects never
  // cross this boundary into application logs.
  setAiGenerationTelemetrySink((event) => {
    app.log.info(event, 'ai generation');
  });

  // The planner's own operational events: why a dispatch was refused, how much
  // of a draft Google could identify, and how Apply resolved. Counts and closed
  // vocabularies only - see `ai-planning-telemetry.ts` for why there is nowhere
  // in these events to put a place name, a label, or a prompt.
  setAiPlanningTelemetrySink((event) => {
    app.log.info(event, 'ai planning');
  });

  // A rate limiter only sees routes registered after it is loaded, so the routes
  // it protects are registered inside a scope that awaits it rather than beside
  // it. Limits are opt-in per route (`global: false`); the provider-backed ones
  // and the public share declare a `rateLimit` config.
  void app.register(async (instance) => {
    await instance.register(rateLimit, { global: false });

    registerAuthenticationRoutes(instance);
    registerAiPlanningSessionRoutes(instance);
    registerCurrencyRoutes(instance);
    registerWeatherRoutes(instance);
    registerPlacesRoutes(instance);
    registerEditorialImageRoutes(instance);
    registerProfileRoutes(instance);
    registerSavedPlacesRoutes(instance);
    registerItineraryRoutes(instance);
    registerNotificationRoutes(instance);
    registerReservationRoutes(instance);
    registerExpenseRoutes(instance);
    registerTasksRoutes(instance);
    registerTripInfoRoutes(instance);
    registerTripPlacesRoutes(instance);
    registerTripRoutes(instance);
    registerPublicTripRoutes(instance);
    registerPlanScoreRoutes(instance);
    registerMemoryRoutes(instance);
    registerSearchRoutes(instance);
    registerHealthRoutes(instance);
    registerMaintenanceRoutes(instance);
  });

  return app;
}
