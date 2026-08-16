import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  getItineraryDayRoutes,
  updateItineraryDayRouteMode,
  updateItineraryItemRouteMode,
} from '../services/itinerary-routes.js';
import { ItineraryNotFoundError } from '../services/itineraries.js';
import { ROUTE_TRAVEL_MODES } from '../services/routes.js';

const dayParamsSchema = z.object({ itineraryDayId: z.uuid(), tripId: z.uuid() }).strict();
const itemParamsSchema = z.object({ itemId: z.uuid(), tripId: z.uuid() }).strict();
const querySchema = z
  .object({
    includePolyline: z.enum(['true', 'false']).optional(),
    languageCode: z.string().trim().min(2).max(35).optional(),
  })
  .strict();
const routeModeSchema = z.object({ mode: z.enum(ROUTE_TRAVEL_MODES) }).strict();

function getUserId(request: FastifyRequest, reply: FastifyReply) {
  if (!request.authUserId) {
    void reply.code(500).send({ code: 'authentication_context_missing' });
    return null;
  }
  return request.authUserId;
}

function handleError(reply: FastifyReply, error: unknown) {
  if (error instanceof ItineraryNotFoundError) {
    return reply.code(404).send({ code: error.message });
  }
  throw error;
}

export function createItineraryRouteControllers() {
  return {
    async getDayRoutes(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = dayParamsSchema.safeParse(request.params);
      const query = querySchema.safeParse(request.query);
      if (!userId) return;
      if (!params.success || !query.success) {
        return reply.code(400).send({ code: 'invalid_itinerary_route_request' });
      }

      try {
        return reply.send(
          await getItineraryDayRoutes(userId, params.data.tripId, params.data.itineraryDayId, {
            includePolyline: query.data.includePolyline === 'true',
            languageCode: query.data.languageCode,
          }),
        );
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async updateDayRouteMode(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = dayParamsSchema.safeParse(request.params);
      const body = routeModeSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success) {
        return reply.code(400).send({ code: 'invalid_itinerary_route_mode' });
      }

      try {
        await updateItineraryDayRouteMode(
          userId,
          params.data.tripId,
          params.data.itineraryDayId,
          body.data.mode,
        );
        return reply.code(204).send();
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async updateItemRouteMode(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = itemParamsSchema.safeParse(request.params);
      const body = routeModeSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success) {
        return reply.code(400).send({ code: 'invalid_itinerary_route_mode' });
      }

      try {
        await updateItineraryItemRouteMode(
          userId,
          params.data.tripId,
          params.data.itemId,
          body.data.mode,
        );
        return reply.code(204).send();
      } catch (error) {
        return handleError(reply, error);
      }
    },
  };
}
