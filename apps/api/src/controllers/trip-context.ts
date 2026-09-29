import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { ItineraryNotFoundError } from '../services/itineraries.js';
import { readTripContext } from '../services/trip-context.js';

const paramsSchema = z.object({ tripId: z.uuid() }).strict();
const querySchema = z
  .object({ languageCode: z.string().trim().min(2).max(35).optional() })
  .strict();

export function createTripContextControllers() {
  return {
    async getTripContext(request: FastifyRequest, reply: FastifyReply) {
      if (!request.authUserId) {
        return reply.code(500).send({ code: 'authentication_context_missing' });
      }

      const params = paramsSchema.safeParse(request.params);
      const query = querySchema.safeParse(request.query ?? {});
      if (!params.success || !query.success) {
        return reply.code(400).send({ code: 'invalid_trip_context_request' });
      }

      try {
        return reply.send(
          await readTripContext(request.authUserId, params.data.tripId, {
            languageCode: query.data.languageCode,
          }),
        );
      } catch (error) {
        if (error instanceof ItineraryNotFoundError) {
          return reply.code(404).send({ code: error.message });
        }
        throw error;
      }
    },
  };
}
