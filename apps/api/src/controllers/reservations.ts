import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { getBearerToken } from '../services/request-auth.js';
import {
  addReservationAttachment,
  createReservation,
  deleteReservation,
  deleteReservationAttachment,
  listReservations,
  ReservationNotFoundError,
  ReservationValidationError,
  updateReservation,
} from '../services/reservations.js';

const tripParamsSchema = z.object({ tripId: z.uuid() }).strict();
const reservationParamsSchema = z.object({ reservationId: z.uuid(), tripId: z.uuid() }).strict();
const attachmentParamsSchema = z
  .object({ attachmentId: z.uuid(), reservationId: z.uuid(), tripId: z.uuid() })
  .strict();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
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
const reservationFields = {
  accommodationAddress: z.string().trim().max(2_000).nullable().optional(),
  applicableDayIds: z.array(z.uuid()).max(366).optional(),
  bookingReference: z.string().trim().max(300).nullable().optional(),
  checkInDate: dateSchema.nullable().optional(),
  checkOutDate: dateSchema.nullable().optional(),
  itineraryItemId: z.uuid().nullable().optional(),
  localDate: dateSchema.nullable().optional(),
  localTime: timeSchema.nullable().optional(),
  notes: z.string().trim().max(5_000).nullable().optional(),
  plannedCost: plannedCostSchema.nullable().optional(),
  provider: z.string().trim().max(200).nullable().optional(),
  title: z.string().trim().min(1).max(300),
  tripPlaceId: z.uuid().nullable().optional(),
  type: z
    .enum([
      'flight',
      'accommodation',
      'restaurant',
      'attraction',
      'train',
      'rental_car',
      'tour',
      'other',
    ])
    .nullable()
    .optional(),
} as const;
const createReservationSchema = z
  .object(reservationFields)
  .strict()
  .refine(
    (value) => !value.checkInDate || !value.checkOutDate || value.checkOutDate >= value.checkInDate,
    { message: 'invalid_accommodation_dates' },
  );
const updateReservationSchema = z
  .object({ ...reservationFields, title: reservationFields.title.optional() })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined));
const attachmentSchema = z
  .object({
    contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
    fileName: z.string().trim().min(1).max(500),
    path: z.string().trim().min(1).max(2_000),
    sizeBytes: z
      .number()
      .int()
      .min(0)
      .max(10 * 1024 * 1024),
  })
  .strict();

function getRequestContext(request: FastifyRequest, reply: FastifyReply) {
  const accessToken = getBearerToken(request.headers.authorization);
  if (!request.authUserId || !accessToken) {
    void reply.code(500).send({ code: 'authentication_context_missing' });
    return null;
  }
  return { accessToken, userId: request.authUserId };
}

function handleError(reply: FastifyReply, error: unknown) {
  if (error instanceof ReservationNotFoundError) {
    return reply.code(404).send({ code: error.message });
  }
  if (error instanceof ReservationValidationError) {
    return reply.code(400).send({ code: error.code });
  }
  throw error;
}

export function createReservationControllers() {
  return {
    async list(request: FastifyRequest, reply: FastifyReply) {
      const context = getRequestContext(request, reply);
      const params = tripParamsSchema.safeParse(request.params);
      if (!context) return;
      if (!params.success) return reply.code(400).send({ code: 'invalid_reservation_id' });
      try {
        return reply.send(
          await listReservations(context.userId, params.data.tripId, context.accessToken),
        );
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async create(request: FastifyRequest, reply: FastifyReply) {
      const context = getRequestContext(request, reply);
      const params = tripParamsSchema.safeParse(request.params);
      const body = createReservationSchema.safeParse(request.body);
      if (!context) return;
      if (!params.success || !body.success) {
        return reply.code(400).send({ code: 'invalid_reservation' });
      }
      try {
        return reply.code(201).send({
          reservation: await createReservation(context.userId, params.data.tripId, body.data),
        });
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async update(request: FastifyRequest, reply: FastifyReply) {
      const context = getRequestContext(request, reply);
      const params = reservationParamsSchema.safeParse(request.params);
      const body = updateReservationSchema.safeParse(request.body);
      if (!context) return;
      if (!params.success || !body.success) {
        return reply.code(400).send({ code: 'invalid_reservation' });
      }
      try {
        return reply.send({
          reservation: await updateReservation(
            context.userId,
            params.data.tripId,
            params.data.reservationId,
            body.data,
          ),
        });
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async remove(request: FastifyRequest, reply: FastifyReply) {
      const context = getRequestContext(request, reply);
      const params = reservationParamsSchema.safeParse(request.params);
      if (!context) return;
      if (!params.success) return reply.code(400).send({ code: 'invalid_reservation_id' });
      try {
        await deleteReservation(
          context.userId,
          params.data.tripId,
          params.data.reservationId,
          context.accessToken,
        );
        return reply.code(204).send();
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async addAttachment(request: FastifyRequest, reply: FastifyReply) {
      const context = getRequestContext(request, reply);
      const params = reservationParamsSchema.safeParse(request.params);
      const body = attachmentSchema.safeParse(request.body);
      if (!context) return;
      if (!params.success || !body.success) {
        return reply.code(400).send({ code: 'invalid_document' });
      }
      try {
        return reply.code(201).send({
          attachment: await addReservationAttachment(
            context.userId,
            params.data.tripId,
            params.data.reservationId,
            body.data,
            context.accessToken,
          ),
        });
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async removeAttachment(request: FastifyRequest, reply: FastifyReply) {
      const context = getRequestContext(request, reply);
      const params = attachmentParamsSchema.safeParse(request.params);
      if (!context) return;
      if (!params.success) return reply.code(400).send({ code: 'invalid_document' });
      try {
        await deleteReservationAttachment(
          context.userId,
          params.data.tripId,
          params.data.reservationId,
          params.data.attachmentId,
          context.accessToken,
        );
        return reply.code(204).send();
      } catch (error) {
        return handleError(reply, error);
      }
    },
  };
}
