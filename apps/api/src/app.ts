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

export function buildApp() {
  const app = Fastify({ logger: true });
  const allowedOrigins = getWebOrigins();

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
