import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { ItineraryNotFoundError } from '../services/itineraries.js';
import { getTripPlaceHours } from '../services/trip-place-hours.js';

const paramsSchema = z.object({ tripId: z.uuid() }).strict();
const querySchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

export function createTripPlaceHoursControllers() {
  return {
    async getTripPlaceHours(request: FastifyRequest, reply: FastifyReply) {
      if (!request.authUserId) {
        return reply.code(500).send({ code: 'authentication_context_missing' });
      }
      const params = paramsSchema.safeParse(request.params);
      const query = querySchema.safeParse(request.query);
      if (!params.success || !query.success) {
        return reply.code(400).send({ code: 'invalid_trip_place_hours_request' });
      }

      try {
        return reply.send(
          await getTripPlaceHours(request.authUserId, params.data.tripId, query.data.date ?? null),
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
