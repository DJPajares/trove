import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { ItineraryNotFoundError } from '../services/itineraries.js';
import { getPlaceGroupings } from '../services/place-groupings.js';

const paramsSchema = z.object({ tripId: z.uuid() }).strict();

export function createPlaceGroupingsControllers() {
  return {
    async getPlaceGroupings(request: FastifyRequest, reply: FastifyReply) {
      if (!request.authUserId) {
        return reply.code(500).send({ code: 'authentication_context_missing' });
      }
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ code: 'invalid_place_groupings_request' });

      try {
        return reply.send(await getPlaceGroupings(request.authUserId, params.data.tripId));
      } catch (error) {
        if (error instanceof ItineraryNotFoundError) {
          return reply.code(404).send({ code: error.message });
        }
        throw error;
      }
    },
  };
}
