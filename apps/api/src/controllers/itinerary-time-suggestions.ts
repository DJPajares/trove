import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { getItineraryDayTimeSuggestions } from '../services/itinerary-time-suggestions.js';
import { ItineraryNotFoundError } from '../services/itineraries.js';

const dayParamsSchema = z.object({ itineraryDayId: z.uuid(), tripId: z.uuid() }).strict();
const querySchema = z.object({ itemId: z.uuid().optional() }).strict();

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

export function createItineraryTimeSuggestionControllers() {
  return {
    async getDayTimeSuggestions(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = dayParamsSchema.safeParse(request.params);
      const query = querySchema.safeParse(request.query);
      if (!userId) return;
      if (!params.success || !query.success) {
        return reply.code(400).send({ code: 'invalid_itinerary_time_suggestion_request' });
      }

      try {
        return reply.send(
          await getItineraryDayTimeSuggestions(
            userId,
            params.data.tripId,
            params.data.itineraryDayId,
            { itemId: query.data.itemId },
          ),
        );
      } catch (error) {
        return handleError(reply, error);
      }
    },
  };
}
