import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  addTripPlace,
  listTripPlaces,
  removeTripPlace,
  TripPlaceNotFoundError,
  TripPlaceReferencedError,
  TripPlaceSourceNotFoundError,
  TripPlaceTripNotFoundError,
  updateTripPlace,
} from '../services/trip-places.js';

const tripParamsSchema = z.object({ tripId: z.uuid() }).strict();
const tripPlaceParamsSchema = z.object({ tripId: z.uuid(), tripPlaceId: z.uuid() }).strict();
const addTripPlaceSchema = z.object({ placeId: z.uuid() }).strict();
const updateTripPlaceSchema = z
  .object({
    note: z.string().trim().max(5_000).nullable().optional(),
    priority: z.enum(['must_go', 'interested', 'maybe']).nullable().optional(),
  })
  .strict()
  .refine((value) => value.note !== undefined || value.priority !== undefined);

function getUserId(request: FastifyRequest, reply: FastifyReply) {
  if (!request.authUserId) {
    void reply.code(500).send({ code: 'authentication_context_missing' });
    return null;
  }
  return request.authUserId;
}

function handleError(reply: FastifyReply, error: unknown) {
  if (error instanceof TripPlaceTripNotFoundError || error instanceof TripPlaceNotFoundError) {
    return reply.code(404).send({ code: error.message });
  }
  if (error instanceof TripPlaceSourceNotFoundError) {
    return reply.code(404).send({ code: error.message });
  }
  if (error instanceof TripPlaceReferencedError) {
    return reply.code(409).send({ code: error.message, referenceCount: error.referenceCount });
  }
  throw error;
}

export function createTripPlacesControllers() {
  return {
    async addTripPlace(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = tripParamsSchema.safeParse(request.params);
      const body = addTripPlaceSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success)
        return reply.code(400).send({ code: 'invalid_trip_place' });
      try {
        return reply
          .code(201)
          .send({ tripPlace: await addTripPlace(userId, params.data.tripId, body.data.placeId) });
      } catch (error) {
        return handleError(reply, error);
      }
    },
    async getTripPlaces(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = tripParamsSchema.safeParse(request.params);
      if (!userId) return;
      if (!params.success) return reply.code(400).send({ code: 'invalid_trip_id' });
      try {
        return reply.send(await listTripPlaces(userId, params.data.tripId));
      } catch (error) {
        return handleError(reply, error);
      }
    },
    async removeTripPlace(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = tripPlaceParamsSchema.safeParse(request.params);
      if (!userId) return;
      if (!params.success) return reply.code(400).send({ code: 'invalid_trip_place' });
      try {
        await removeTripPlace(userId, params.data.tripId, params.data.tripPlaceId);
        return reply.code(204).send();
      } catch (error) {
        return handleError(reply, error);
      }
    },
    async updateTripPlace(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = tripPlaceParamsSchema.safeParse(request.params);
      const body = updateTripPlaceSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success)
        return reply.code(400).send({ code: 'invalid_trip_place' });
      try {
        return reply.send({
          tripPlace: await updateTripPlace(
            userId,
            params.data.tripId,
            params.data.tripPlaceId,
            body.data,
          ),
        });
      } catch (error) {
        return handleError(reply, error);
      }
    },
  };
}
