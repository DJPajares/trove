import type { FastifyInstance } from 'fastify';

import { createWeatherControllers } from '../controllers/weather.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';
import { WeatherService } from '../services/weather.js';

export function registerWeatherRoutes(app: FastifyInstance) {
  const controllers = createWeatherControllers(new WeatherService());
  app.get('/weather', { preHandler: requireAuthenticatedUser }, controllers.getWeather);
}
