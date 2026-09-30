import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { ItineraryNotFoundError } from '../services/itineraries.js';
import { getPlaceHoursNotices } from '../services/place-hours-notices.js';

const paramsSchema = z.object({ tripId: z.uuid() }).strict();

export function createPlaceHoursNoticesControllers() {
  return {
    async getPlaceHoursNotices(request: FastifyRequest, reply: FastifyReply) {
      if (!request.authUserId) {
        return reply.code(500).send({ code: 'authentication_context_missing' });
      }
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ code: 'invalid_hours_notices_request' });

      try {
        return reply.send(await getPlaceHoursNotices(request.authUserId, params.data.tripId));
      } catch (error) {
        if (error instanceof ItineraryNotFoundError) {
          return reply.code(404).send({ code: error.message });
        }
        throw error;
      }
    },
  };
}
