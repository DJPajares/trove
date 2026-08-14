import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { ItineraryNotFoundError } from '../services/itineraries.js';
import { getTripPlanScore } from '../services/plan-score.js';

const paramsSchema = z.object({ tripId: z.uuid() }).strict();

export function createPlanScoreControllers() {
  return {
    async getPlanScore(request: FastifyRequest, reply: FastifyReply) {
      if (!request.authUserId) {
        return reply.code(500).send({ code: 'authentication_context_missing' });
      }

      const params = paramsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ code: 'invalid_plan_score_request' });
      }

      try {
        return reply.send(await getTripPlanScore(request.authUserId, params.data.tripId));
      } catch (error) {
        if (error instanceof ItineraryNotFoundError) {
          return reply.code(404).send({ code: error.message });
        }
        throw error;
      }
    },
  };
}
