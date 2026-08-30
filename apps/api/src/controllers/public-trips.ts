import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { listPublicItinerary, PublicTripNotFoundError } from '../services/public-itinerary.js';

const tripParamsSchema = z.object({ tripId: z.uuid() }).strict();

/** One body for every way this can fail to find a trip, so none of them is a tell. */
const notFound = { code: 'trip_not_found' } as const;

export function createPublicTripControllers() {
  return {
    /**
     * The only data handler in Trove that runs without a signed-in user.
     *
     * A trip that is private, a trip that never existed, and an id that is not a
     * uuid all answer 404 with the same body. Anything more helpful would let a
     * stranger enumerate which trips exist and which of those have been shared.
     */
    async getPublicItinerary(request: FastifyRequest, reply: FastifyReply) {
      const params = tripParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(404).send(notFound);

      try {
        const itinerary = await listPublicItinerary(params.data.tripId);

        // Short enough that turning sharing off takes effect while the traveller
        // is still looking, long enough that a link doing the rounds in a group
        // chat does not become one database read per tap.
        return reply.header('Cache-Control', 'public, max-age=60').send(itinerary);
      } catch (error) {
        if (error instanceof PublicTripNotFoundError) return reply.code(404).send(notFound);
        throw error;
      }
    },
  };
}
