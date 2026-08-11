import cors from '@fastify/cors';
import Fastify from 'fastify';

import { getWebOrigins } from './environment.js';
import { registerAuthenticationRoutes } from './routes/auth.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerPlacesRoutes } from './routes/places.js';
import { registerProfileRoutes } from './routes/profile.js';
import { registerTripRoutes } from './routes/trips.js';

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
    methods: ['DELETE', 'GET', 'PATCH', 'POST', 'OPTIONS'],
    origin(origin, callback) {
      callback(
        null,
        origin === undefined ||
          allowedOrigins.some((allowedOrigin) => originMatches(allowedOrigin, origin)),
      );
    },
  });

  registerAuthenticationRoutes(app);
  registerPlacesRoutes(app);
  registerProfileRoutes(app);
  registerTripRoutes(app);
  registerHealthRoutes(app);

  return app;
}
