import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { listPublicItinerary, PublicTripNotFoundError } from '../services/public-itinerary.js';

const tripParamsSchema = z.object({ tripId: z.uuid() }).strict();

/** One body for every way this can fail to find a trip, so none of them is a tell. */
const notFound = { code: 'trip_not_found' } as const;

/**
 * Nothing about a shared trip may be held anywhere between the database and the
 * reader, in either direction.
 *
 * A cached 200 is the serious one: turning the switch off is a traveller taking
 * their plan back, and a link that keeps working afterwards means the control did
 * not do what it says. A cached 404 is the same failure mirrored - a trip shared
 * a moment ago still reading as private to the people it was sent to.
 *
 * The cost is a database read per visit, which `PUBLIC_SHARE_RATE_LIMIT` exists to
 * bound. It is a cheap read and it reaches no provider, so it is the right thing
 * to spend on a control that has to be believable.
 */
const NO_STORE = 'no-store';

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
      if (!params.success) return reply.code(404).header('Cache-Control', NO_STORE).send(notFound);

      try {
        const itinerary = await listPublicItinerary(params.data.tripId);

        return reply.header('Cache-Control', NO_STORE).send(itinerary);
      } catch (error) {
        if (error instanceof PublicTripNotFoundError) {
          return reply.code(404).header('Cache-Control', NO_STORE).send(notFound);
        }
        throw error;
      }
    },
  };
}
