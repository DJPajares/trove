import type { FastifyInstance } from 'fastify';

import { createItineraryControllers } from '../controllers/itineraries.js';
import { createItineraryRouteControllers } from '../controllers/itinerary-routes.js';
import { createItineraryTimeSuggestionControllers } from '../controllers/itinerary-time-suggestions.js';
import { createDayBetterOrderControllers } from '../controllers/day-better-order.js';
import { createPlaceGroupingsControllers } from '../controllers/place-groupings.js';
import { createTripOfflineContextControllers } from '../controllers/trip-offline-context.js';
import { createGapSuggestionsControllers } from '../controllers/gap-suggestions.js';
import { createPlaceHoursNoticesControllers } from '../controllers/place-hours-notices.js';
import { createRainAlternativesControllers } from '../controllers/rain-alternatives.js';
import { createTripPlaceHoursControllers } from '../controllers/trip-place-hours.js';
import { createTripModeContextControllers } from '../controllers/trip-mode-context.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';
import { PROVIDER_FANOUT_RATE_LIMIT } from './rate-limits.js';
import { movementInputSchema, movementApplySchema } from '@trove/types';
import {
  previewItineraryMovement,
  applyItineraryMovement,
} from '../services/itinerary-movements.js';
import {
  ItineraryConflictError,
  ItineraryNotFoundError,
  ItineraryValidationError,
} from '../services/itineraries.js';
import { z } from 'zod';

export function registerItineraryRoutes(app: FastifyInstance) {
  const controllers = createItineraryControllers();
  const routeControllers = createItineraryRouteControllers();
  const timeSuggestionControllers = createItineraryTimeSuggestionControllers();
  const tripModeContextControllers = createTripModeContextControllers();
  const tripPlaceHoursControllers = createTripPlaceHoursControllers();
  const betterOrderControllers = createDayBetterOrderControllers();
  const placeGroupingsControllers = createPlaceGroupingsControllers();
  const offlineContextControllers = createTripOfflineContextControllers();
  const gapSuggestionsControllers = createGapSuggestionsControllers();
  const hoursNoticesControllers = createPlaceHoursNoticesControllers();
  const rainAlternativesControllers = createRainAlternativesControllers();
  const authenticated = { preHandler: requireAuthenticatedUser };
  for (const action of ['preview', 'apply'] as const) {
    app.post(
      `/trips/:tripId/itinerary/movements/${action}`,
      authenticated,
      async (request, reply) => {
        const params = z.object({ tripId: z.uuid() }).safeParse(request.params);
        if (!request.authUserId) return reply.code(401).send({ code: 'not_authenticated' });
        if (!params.success) return reply.code(400).send({ code: 'invalid_trip_id' });
        try {
          if (action === 'apply') {
            const body = movementApplySchema.safeParse(request.body);
            if (!body.success) return reply.code(400).send({ code: 'invalid_itinerary_movement' });
            return reply.send(
              await applyItineraryMovement(request.authUserId, params.data.tripId, body.data),
            );
          }
          const body = movementInputSchema.safeParse(request.body);
          if (!body.success) return reply.code(400).send({ code: 'invalid_itinerary_movement' });
          return reply.send(
            await previewItineraryMovement(request.authUserId, params.data.tripId, body.data),
          );
        } catch (error) {
          if (error instanceof ItineraryConflictError)
            return reply.code(409).send({ code: error.message });
          if (error instanceof ItineraryNotFoundError)
            return reply.code(404).send({ code: error.message });
          if (error instanceof ItineraryValidationError)
            return reply.code(400).send({ code: error.code });
          throw error;
        }
      },
    );
  }
  // These reach Google once per place and once per leg of the day.
  const providerBacked = { config: PROVIDER_FANOUT_RATE_LIMIT, ...authenticated };

  app.get('/trips/:tripId/itinerary', providerBacked, controllers.getItinerary);
  app.get(
    '/trips/:tripId/trip-mode/context',
    providerBacked,
    tripModeContextControllers.getContext,
  );
  app.get(
    '/trips/:tripId/itinerary/days/:itineraryDayId/routes',
    providerBacked,
    routeControllers.getDayRoutes,
  );
  app.get(
    '/trips/:tripId/itinerary/days/:itineraryDayId/time-suggestions',
    authenticated,
    timeSuggestionControllers.getDayTimeSuggestions,
  );
  app.post(
    '/trips/:tripId/itinerary/days/:itineraryDayId/timing',
    authenticated,
    timeSuggestionControllers.applyDayTiming,
  );
  // Stored evidence only, so no provider fan-out: an ordinary authenticated read.
  app.get('/trips/:tripId/place-hours', authenticated, tripPlaceHoursControllers.getTripPlaceHours);
  // What offline Trip Mode keeps: stored legs and hours only, never acquired.
  app.get(
    '/trips/:tripId/offline-context',
    authenticated,
    offlineContextControllers.getTripOfflineContext,
  );
  // The traveller's own unplanned places that fit a day's free stretches.
  app.get(
    '/trips/:tripId/itinerary/days/:itineraryDayId/gap-suggestions',
    authenticated,
    gapSuggestionsControllers.getDayGapSuggestions,
  );
  // Special hours and holiday checks for Insights; stored evidence only.
  app.get(
    '/trips/:tripId/hours-notices',
    authenticated,
    hoursNoticesControllers.getPlaceHoursNotices,
  );
  // Indoor places from the traveller's own list for a rainy day's outdoor stops.
  app.get(
    '/trips/:tripId/itinerary/days/:itineraryDayId/rain-alternatives',
    authenticated,
    rainAlternativesControllers.getRainAlternatives,
  );
  // Stored coordinates and the itinerary only.
  app.get(
    '/trips/:tripId/place-groupings',
    authenticated,
    placeGroupingsControllers.getPlaceGroupings,
  );
  // Read as Plan Score reads the day: stored legs and hours only.
  app.get(
    '/trips/:tripId/itinerary/days/:itineraryDayId/better-order',
    authenticated,
    betterOrderControllers.getDayBetterOrder,
  );
  app.patch(
    '/trips/:tripId/day-experiences/:date',
    authenticated,
    controllers.updateDatedExperienceRating,
  );
  app.post('/trips/:tripId/itinerary/items', authenticated, controllers.createItem);
  app.post(
    '/trips/:tripId/itinerary/days/:itineraryDayId/move',
    authenticated,
    controllers.moveDayPlan,
  );
  app.post(
    '/trips/:tripId/itinerary/items/:itemId/duplicate',
    authenticated,
    controllers.duplicateItem,
  );
  app.patch(
    '/trips/:tripId/itinerary/items/:itemId/organization',
    authenticated,
    controllers.organizeItem,
  );
  app.put('/trips/:tripId/itinerary/stays', authenticated, controllers.setStayPlan);
  app.patch(
    '/trips/:tripId/itinerary/days/:itineraryDayId/stay',
    authenticated,
    controllers.setDayStay,
  );
  app.patch(
    '/trips/:tripId/itinerary/days/:itineraryDayId/base',
    authenticated,
    controllers.setDayBase,
  );
  app.patch(
    '/trips/:tripId/itinerary/days/:itineraryDayId/note',
    authenticated,
    controllers.updateDayNote,
  );
  app.patch(
    '/trips/:tripId/itinerary/days/:itineraryDayId/planning-context',
    authenticated,
    controllers.updateDayPlanningContext,
  );
  app.patch(
    '/trips/:tripId/itinerary/days/:itineraryDayId/name',
    authenticated,
    controllers.updateDayName,
  );
  app.patch(
    '/trips/:tripId/itinerary/days/:itineraryDayId/experience-rating',
    authenticated,
    controllers.updateDayExperienceRating,
  );
  app.patch(
    '/trips/:tripId/itinerary/days/:itineraryDayId/route-mode',
    authenticated,
    routeControllers.updateDayRouteMode,
  );
  app.patch(
    '/trips/:tripId/itinerary/items/:itemId/route-mode',
    authenticated,
    routeControllers.updateItemRouteMode,
  );
  app.patch(
    '/trips/:tripId/itinerary/items/:itemId/travel-status',
    authenticated,
    tripModeContextControllers.updateTravelStatus,
  );
  app.patch('/trips/:tripId/itinerary/items/:itemId', authenticated, controllers.updateItem);
  app.delete('/trips/:tripId/itinerary/items/:itemId', authenticated, controllers.deleteItem);
}
