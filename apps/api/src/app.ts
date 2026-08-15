import cors from '@fastify/cors';
import Fastify from 'fastify';

import { getWebOrigins } from './environment.js';
import { registerAuthenticationRoutes } from './routes/auth.js';
import { registerCurrencyRoutes } from './routes/currency.js';
import { registerExpenseRoutes } from './routes/expenses.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerItineraryRoutes } from './routes/itineraries.js';
import { registerMemoryRoutes } from './routes/memories.js';
import { registerNotificationRoutes } from './routes/notifications.js';
import { registerPlacesRoutes } from './routes/places.js';
import { registerPlanScoreRoutes } from './routes/plan-score.js';
import { registerProfileRoutes } from './routes/profile.js';
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
  const app = Fastify({ logger: true });
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

  registerAuthenticationRoutes(app);
  registerCurrencyRoutes(app);
  registerWeatherRoutes(app);
  registerPlacesRoutes(app);
  registerProfileRoutes(app);
  registerSavedPlacesRoutes(app);
  registerItineraryRoutes(app);
  registerNotificationRoutes(app);
  registerReservationRoutes(app);
  registerExpenseRoutes(app);
  registerTasksRoutes(app);
  registerTripInfoRoutes(app);
  registerTripPlacesRoutes(app);
  registerTripRoutes(app);
  registerPlanScoreRoutes(app);
  registerMemoryRoutes(app);
  registerSearchRoutes(app);
  registerHealthRoutes(app);

  return app;
}
