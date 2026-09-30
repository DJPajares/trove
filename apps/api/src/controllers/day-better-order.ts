import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { getDayBetterOrder } from '../services/day-better-order.js';
import { ItineraryNotFoundError } from '../services/itineraries.js';

const paramsSchema = z.object({ itineraryDayId: z.uuid(), tripId: z.uuid() }).strict();

export function createDayBetterOrderControllers() {
  return {
    async getDayBetterOrder(request: FastifyRequest, reply: FastifyReply) {
      if (!request.authUserId) {
        return reply.code(500).send({ code: 'authentication_context_missing' });
      }
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ code: 'invalid_better_order_request' });

      try {
        return reply.send(
          await getDayBetterOrder(
            request.authUserId,
            params.data.tripId,
            params.data.itineraryDayId,
          ),
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
