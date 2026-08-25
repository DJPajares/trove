import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  createItineraryItem,
  deleteItineraryItem,
  duplicateItineraryItem,
  ItineraryConflictError,
  ItineraryNotFoundError,
  ItineraryValidationError,
  listItinerary,
  moveItineraryDayPlan,
  organizeItineraryItem,
  setItineraryDayBase,
  updateItineraryDayExperienceRating,
  updateItineraryDayName,
  updateItineraryDayNote,
  updateItineraryItem,
} from '../services/itineraries.js';

const tripParamsSchema = z.object({ tripId: z.uuid() }).strict();
const languageQuerySchema = z
  .object({ languageCode: z.string().trim().min(2).max(35).optional() })
  .strict();
const itemParamsSchema = z.object({ itemId: z.uuid(), tripId: z.uuid() }).strict();
const dayParamsSchema = z.object({ itineraryDayId: z.uuid(), tripId: z.uuid() }).strict();
const moveDaySchema = z
  .object({
    expectedSourceBase: z
      .object({
        dailyBaseDepartureTripPlaceId: z.uuid().nullable(),
        dailyBaseTripPlaceId: z.uuid().nullable(),
      })
      .strict(),
    expectedSourceItemIds: z.array(z.uuid()),
    expectedTargetBase: z
      .object({
        dailyBaseDepartureTripPlaceId: z.uuid().nullable(),
        dailyBaseTripPlaceId: z.uuid().nullable(),
      })
      .strict(),
    expectedTargetItemIds: z.array(z.uuid()),
    strategy: z.enum(['append', 'swap']),
    targetItineraryDayId: z.uuid(),
  })
  .strict();
const organizeItemSchema = z
  .object({ itineraryDayId: z.uuid().nullable(), position: z.number().int().min(0) })
  .strict();
const dayBaseSchema = z
  .object({
    departureTripPlaceId: z.uuid().nullable().optional(),
    tripPlaceId: z.uuid().nullable(),
  })
  .strict();
const dayNoteSchema = z.object({ note: z.string().trim().max(5_000).nullable() }).strict();
const dayNameSchema = z.object({ name: z.string().trim().min(1).max(120).nullable() }).strict();
const dayExperienceRatingSchema = z
  .object({
    note: z.string().trim().max(2_000).nullable().optional(),
    rating: z.number().int().min(1).max(5).nullable(),
  })
  .strict();
const timeZoneSchema = z.string().trim().min(1).max(100);
const scheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z
    .object({
      dayPart: z.enum(['morning', 'afternoon', 'evening', 'anytime']),
      kind: z.literal('day_part'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('exact'),
      localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    })
    .strict(),
]);
const plannedCostSchema = z
  .object({
    amount: z.string().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/),
    currencyCode: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/)
      .transform((value) => value.toUpperCase()),
  })
  .strict();
const itemFields = {
  customLabel: z.string().trim().max(200).nullable().optional(),
  customLocation: z
    .object({
      label: z.string().trim().min(1).max(300),
      timeZone: timeZoneSchema.nullable().optional(),
    })
    .strict()
    .nullable()
    .optional(),
  durationMinutes: z.number().int().positive().max(43_200).nullable().optional(),
  localEndTime: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
    .nullable()
    .optional(),
  notes: z.string().trim().max(5_000).nullable().optional(),
  plannedCost: plannedCostSchema.nullable().optional(),
  priority: z.enum(['must_go', 'interested', 'maybe']).nullable().optional(),
  schedule: scheduleSchema.optional(),
  tripPlaceId: z.uuid().nullable().optional(),
} as const;
const createItemSchema = z
  .object({
    ...itemFields,
    clientItemId: z.uuid().optional(),
    itineraryDayId: z.uuid(),
    schedule: scheduleSchema.default({ kind: 'none' }),
  })
  .strict()
  .refine((value) => Boolean(value.tripPlaceId || value.customLabel?.trim()), {
    message: 'minimum_content_required',
  })
  .refine((value) => !(value.localEndTime && value.durationMinutes), {
    message: 'exclusive_itinerary_timing_required',
  });
const updateItemSchema = z
  .object(itemFields)
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined))
  .refine((value) => !(value.localEndTime && value.durationMinutes), {
    message: 'exclusive_itinerary_timing_required',
  });

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
  if (error instanceof ItineraryValidationError) {
    return reply.code(400).send({ code: error.code });
  }
  throw error;
}

export function createItineraryControllers() {
  return {
    async moveDayPlan(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = dayParamsSchema.safeParse(request.params);
      const body = moveDaySchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success) {
        return reply.code(400).send({ code: 'invalid_itinerary_day_move' });
      }
      try {
        await moveItineraryDayPlan(
          userId,
          params.data.tripId,
          params.data.itineraryDayId,
          body.data,
        );
        return reply.code(204).send();
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async duplicateItem(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = itemParamsSchema.safeParse(request.params);
      if (!userId) return;
      if (!params.success) return reply.code(400).send({ code: 'invalid_itinerary_item' });
      try {
        await duplicateItineraryItem(userId, params.data.tripId, params.data.itemId);
        return reply.code(201).send();
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async createItem(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = tripParamsSchema.safeParse(request.params);
      const body = createItemSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success) {
        return reply.code(400).send({ code: 'invalid_itinerary_item' });
      }
      try {
        const item = await createItineraryItem(userId, params.data.tripId, body.data);
        return reply.code(201).send({ item });
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async deleteItem(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = itemParamsSchema.safeParse(request.params);
      if (!userId) return;
      if (!params.success) return reply.code(400).send({ code: 'invalid_itinerary_item' });
      try {
        await deleteItineraryItem(
          userId,
          params.data.tripId,
          params.data.itemId,
          getExpectedUpdatedAt(request),
        );
        return reply.code(204).send();
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async getItinerary(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = tripParamsSchema.safeParse(request.params);
      const query = languageQuerySchema.safeParse(request.query);
      if (!userId) return;
      if (!params.success) return reply.code(400).send({ code: 'invalid_trip_id' });
      try {
        return reply.send(
          await listItinerary(userId, params.data.tripId, query.data?.languageCode),
        );
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async organizeItem(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = itemParamsSchema.safeParse(request.params);
      const body = organizeItemSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success)
        return reply.code(400).send({ code: 'invalid_itinerary_item' });
      try {
        await organizeItineraryItem(
          userId,
          params.data.tripId,
          params.data.itemId,
          body.data,
          getExpectedUpdatedAt(request),
        );
        return reply.code(204).send();
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async setDayBase(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = dayParamsSchema.safeParse(request.params);
      const body = dayBaseSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success)
        return reply.code(400).send({ code: 'invalid_itinerary_day' });
      try {
        await setItineraryDayBase(
          userId,
          params.data.tripId,
          params.data.itineraryDayId,
          body.data.tripPlaceId,
          body.data.departureTripPlaceId,
        );
        return reply.code(204).send();
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async updateDayNote(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = dayParamsSchema.safeParse(request.params);
      const body = dayNoteSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success)
        return reply.code(400).send({ code: 'invalid_itinerary_day' });
      try {
        return reply.send(
          await updateItineraryDayNote(
            userId,
            params.data.tripId,
            params.data.itineraryDayId,
            body.data.note,
          ),
        );
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async updateDayName(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = dayParamsSchema.safeParse(request.params);
      const body = dayNameSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success)
        return reply.code(400).send({ code: 'invalid_itinerary_day' });
      try {
        return reply.send(
          await updateItineraryDayName(
            userId,
            params.data.tripId,
            params.data.itineraryDayId,
            body.data.name,
          ),
        );
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async updateDayExperienceRating(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = dayParamsSchema.safeParse(request.params);
      const body = dayExperienceRatingSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success) {
        return reply.code(400).send({ code: 'invalid_experience_rating' });
      }
      try {
        return reply.send(
          await updateItineraryDayExperienceRating(
            userId,
            params.data.tripId,
            params.data.itineraryDayId,
            body.data.rating,
            body.data.note,
          ),
        );
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async updateItem(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = itemParamsSchema.safeParse(request.params);
      const body = updateItemSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success) {
        return reply.code(400).send({ code: 'invalid_itinerary_item' });
      }
      try {
        return reply.send(
          await updateItineraryItem(
            userId,
            params.data.tripId,
            params.data.itemId,
            body.data,
            getExpectedUpdatedAt(request),
          ),
        );
      } catch (error) {
        return handleError(reply, error);
      }
    },
  };
}
