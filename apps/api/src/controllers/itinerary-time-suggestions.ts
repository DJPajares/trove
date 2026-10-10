import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  applyItineraryDayTiming,
  getItineraryDayTimeSuggestions,
} from '../services/itinerary-time-suggestions.js';
import {
  ItineraryConflictError,
  ItineraryNotFoundError,
  ItineraryValidationError,
} from '../services/itineraries.js';

const dayParamsSchema = z.object({ itineraryDayId: z.uuid(), tripId: z.uuid() }).strict();
const querySchema = z
  .object({
    // A stop being added, not yet saved: it is described rather than named.
    candidate: z.literal('1').optional(),
    candidateDurationMinutes: z.coerce.number().int().positive().max(1440).optional(),
    candidateTripPlaceId: z.uuid().optional(),
    candidatePosition: z.coerce.number().int().min(0).max(10000).optional(),
    durationMinutes: z
      .union([
        z.literal('none').transform(() => null),
        z.coerce.number().int().positive().max(43200),
      ])
      .optional(),
    localTime: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    localEndTime: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    itemId: z.uuid().optional(),
    // The timing the caller is showing, which may not be what is stored yet.
    schedule: z.enum(['afternoon', 'anytime', 'evening', 'exact', 'morning', 'none']).optional(),
  })
  .strict()
  .refine((query) => !(query.candidate && query.itemId), {
    error: 'candidate_or_item',
  });

const batchSchema = z
  .object({
    scheduleRevision: z.string().regex(/^[a-f0-9]{64}$/),
    itemIds: z.array(z.uuid()).min(1).max(200),
  })
  .strict();

function getUserId(request: FastifyRequest, reply: FastifyReply) {
  if (!request.authUserId) {
    void reply.code(500).send({ code: 'authentication_context_missing' });
    return null;
  }
  return request.authUserId;
}

function handleError(reply: FastifyReply, error: unknown) {
  if (error instanceof ItineraryValidationError)
    return reply.code(400).send({ code: error.message });
  if (error instanceof ItineraryConflictError) return reply.code(409).send({ code: error.message });
  if (error instanceof ItineraryNotFoundError) {
    return reply.code(404).send({ code: error.message });
  }
  throw error;
}

export function createItineraryTimeSuggestionControllers() {
  return {
    async applyDayTiming(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = dayParamsSchema.safeParse(request.params);
      const body = batchSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success)
        return reply.code(400).send({ code: 'invalid_itinerary_time_suggestion_request' });
      try {
        return reply.send(
          await applyItineraryDayTiming(
            userId,
            params.data.tripId,
            params.data.itineraryDayId,
            body.data,
          ),
        );
      } catch (error) {
        return handleError(reply, error);
      }
    },
    async getDayTimeSuggestions(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = dayParamsSchema.safeParse(request.params);
      const query = querySchema.safeParse(request.query);
      if (!userId) return;
      if (!params.success || !query.success) {
        return reply.code(400).send({ code: 'invalid_itinerary_time_suggestion_request' });
      }

      try {
        return reply.send(
          await getItineraryDayTimeSuggestions(
            userId,
            params.data.tripId,
            params.data.itineraryDayId,
            {
              candidate: query.data.candidate
                ? {
                    durationMinutes: query.data.candidateDurationMinutes ?? null,
                    tripPlaceId: query.data.candidateTripPlaceId ?? null,
                    position: query.data.candidatePosition,
                  }
                : undefined,
              itemId: query.data.itemId,
              durationMinutes: query.data.durationMinutes,
              localTime: query.data.localTime,
              localEndTime: query.data.localEndTime,
              schedule: query.data.schedule,
            },
          ),
        );
      } catch (error) {
        return handleError(reply, error);
      }
    },
  };
}
