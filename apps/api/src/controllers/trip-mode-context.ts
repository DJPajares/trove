import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { ItineraryConflictError, ItineraryNotFoundError } from '../services/itineraries.js';
import {
  resolveTripModeContext,
  TripModeContextValidationError,
  updateItineraryItemTravelStatus,
} from '../services/trip-mode-context.js';

const tripParamsSchema = z.object({ tripId: z.uuid() }).strict();
const itemParamsSchema = z.object({ itemId: z.uuid(), tripId: z.uuid() }).strict();
const contextQuerySchema = z
  .object({
    at: z.string().datetime({ offset: true }).optional(),
    date: z.string().date().optional(),
    languageCode: z.string().trim().min(2).max(35).optional(),
    time: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
  })
  .strict()
  .refine((value) => Boolean(value.date) === Boolean(value.time))
  .refine((value) => !(value.at && value.date));
const travelStatusSchema = z
  .object({ travelStatus: z.enum(['upcoming', 'completed', 'skipped']) })
  .strict();

function getUserId(request: FastifyRequest, reply: FastifyReply) {
  if (!request.authUserId) {
    void reply.code(500).send({ code: 'authentication_context_missing' });
    return null;
  }
  return request.authUserId;
}

function getExpectedUpdatedAt(request: FastifyRequest) {
  const value = request.headers['x-trove-expected-updated-at'];
  if (typeof value !== 'string') return undefined;
  const parsed = z.string().datetime({ offset: true }).safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function handleError(reply: FastifyReply, error: unknown) {
  if (error instanceof ItineraryConflictError) {
    return reply.code(409).send({ code: error.message });
  }
  if (error instanceof ItineraryNotFoundError) {
    return reply.code(404).send({ code: error.message });
  }
  if (error instanceof TripModeContextValidationError) {
    return reply.code(400).send({ code: error.code });
  }
  throw error;
}

export function createTripModeContextControllers() {
  return {
    async getContext(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = tripParamsSchema.safeParse(request.params);
      const query = contextQuerySchema.safeParse(request.query);
      if (!userId) return;
      if (!params.success || !query.success) {
        return reply.code(400).send({ code: 'invalid_trip_mode_context' });
      }

      try {
        return reply.send(
          await resolveTripModeContext(userId, params.data.tripId, {
            at: query.data.at ? new Date(query.data.at) : undefined,
            languageCode: query.data.languageCode,
            preview:
              query.data.date && query.data.time
                ? { date: query.data.date, time: query.data.time }
                : undefined,
          }),
        );
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async updateTravelStatus(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = itemParamsSchema.safeParse(request.params);
      const body = travelStatusSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success) {
        return reply.code(400).send({ code: 'invalid_itinerary_travel_status' });
      }

      try {
        return reply.send(
          await updateItineraryItemTravelStatus(
            userId,
            params.data.tripId,
            params.data.itemId,
            body.data.travelStatus,
            getExpectedUpdatedAt(request),
          ),
        );
      } catch (error) {
        return handleError(reply, error);
      }
    },
  };
}
