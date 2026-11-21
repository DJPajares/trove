import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  listSavedTrips,
  saveTrip,
  SavedTripNotFoundError,
  SavedTripOwnTripError,
  unsaveTrip,
} from '../services/saved-trips.js';

const tripParamsSchema = z.object({ tripId: z.uuid() }).strict();

function getAuthenticatedUserId(request: FastifyRequest, reply: FastifyReply) {
  if (!request.authUserId) {
    void reply.code(500).send({ code: 'authentication_context_missing' });
    return null;
  }
  return request.authUserId;
}

export function createSavedTripsControllers() {
  return {
    async getSavedTrips(request: FastifyRequest, reply: FastifyReply) {
      const userId = getAuthenticatedUserId(request, reply);
      if (!userId) return;
      return { trips: await listSavedTrips(userId) };
    },

    async saveTrip(request: FastifyRequest, reply: FastifyReply) {
      const userId = getAuthenticatedUserId(request, reply);
      const params = tripParamsSchema.safeParse(request.params);
      if (!userId) return;
      // A malformed id answers like a missing trip, as the read-only link does.
      if (!params.success) return reply.code(404).send({ code: 'trip_not_found' });

      try {
        await saveTrip(userId, params.data.tripId);
        return reply.code(204).send();
      } catch (error) {
        if (error instanceof SavedTripNotFoundError) {
          return reply.code(404).send({ code: error.message });
        }
        if (error instanceof SavedTripOwnTripError) {
          return reply.code(409).send({ code: error.message });
        }
        throw error;
      }
    },

    async unsaveTrip(request: FastifyRequest, reply: FastifyReply) {
      const userId = getAuthenticatedUserId(request, reply);
      const params = tripParamsSchema.safeParse(request.params);
      if (!userId) return;
      if (!params.success) return reply.code(204).send();

      await unsaveTrip(userId, params.data.tripId);
      return reply.code(204).send();
    },
  };
}
