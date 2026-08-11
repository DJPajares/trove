import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { getBearerToken } from '../services/request-auth.js';
import {
  createTrip,
  deleteTrip,
  getTrip,
  listTrips,
  TripDateShrinkConfirmationError,
  TripNotFoundError,
  TripValidationError,
  updateTrip,
} from '../services/trips.js';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeZoneSchema = z.string().trim().min(1).max(100);
const destinationSchema = z.object({ name: z.string().trim().min(1).max(200) }).strict();
const tripFields = {
  coverPhotoPath: z.string().trim().max(512).nullable().optional(),
  destinations: z
    .array(destinationSchema)
    .max(20)
    .superRefine((destinations, context) => {
      const names = new Set<string>();

      destinations.forEach((destination, index) => {
        const name = destination.name.toLocaleLowerCase('en');
        if (names.has(name)) {
          context.addIssue({
            code: 'custom',
            message: 'duplicate_destination',
            path: [index, 'name'],
          });
        }
        names.add(name);
      });
    })
    .optional(),
  deviceTimeZone: timeZoneSchema.optional(),
  endDate: dateSchema,
  name: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(5_000).nullable().optional(),
  partySize: z.number().int().min(1).max(99).optional(),
  planningReadiness: z.enum(['in_progress', 'ready']).optional(),
  referenceTimeZone: timeZoneSchema.nullable().optional(),
  startDate: dateSchema,
  startingLocation: z.string().trim().max(200).nullable().optional(),
} as const;
const tripCreateSchema = z.object(tripFields).strict();
const tripUpdateSchema = z
  .object({
    coverPhotoPath: tripFields.coverPhotoPath,
    confirmDateShrink: z.boolean().optional(),
    destinations: tripFields.destinations,
    deviceTimeZone: tripFields.deviceTimeZone,
    endDate: tripFields.endDate.optional(),
    name: tripFields.name.optional(),
    notes: tripFields.notes,
    partySize: tripFields.partySize,
    planningReadiness: tripFields.planningReadiness,
    referenceTimeZone: tripFields.referenceTimeZone,
    startDate: tripFields.startDate.optional(),
    startingLocation: tripFields.startingLocation,
  })
  .strict();
const tripParamsSchema = z.object({ tripId: z.uuid() }).strict();

function getRequestContext(request: FastifyRequest, reply: FastifyReply) {
  const userId = request.authUserId;
  const accessToken = getBearerToken(request.headers.authorization);

  if (!userId || !accessToken) {
    void reply.code(500).send({ code: 'authentication_context_missing' });
    return null;
  }

  return { accessToken, userId };
}

function handleTripError(error: unknown, reply: FastifyReply) {
  if (error instanceof TripNotFoundError) {
    return reply.code(404).send({ code: error.message });
  }
  if (error instanceof TripDateShrinkConfirmationError) {
    return reply.code(409).send({
      affectedItemCount: error.affectedItemCount,
      code: error.message,
    });
  }
  if (error instanceof TripValidationError) {
    return reply.code(400).send({ code: error.code });
  }
  throw error;
}

function parseTripId(request: FastifyRequest, reply: FastifyReply) {
  const parsed = tripParamsSchema.safeParse(request.params);
  if (!parsed.success) {
    void reply.code(400).send({ code: 'invalid_trip_id' });
    return null;
  }
  return parsed.data.tripId;
}

export async function listTripsController(request: FastifyRequest, reply: FastifyReply) {
  const context = getRequestContext(request, reply);
  if (!context) return;
  return { trips: await listTrips(context.userId, context.accessToken) };
}

export async function getTripController(request: FastifyRequest, reply: FastifyReply) {
  const context = getRequestContext(request, reply);
  const tripId = parseTripId(request, reply);
  if (!context || !tripId) return;

  try {
    return { trip: await getTrip(context.userId, context.accessToken, tripId) };
  } catch (error) {
    return handleTripError(error, reply);
  }
}

export async function createTripController(request: FastifyRequest, reply: FastifyReply) {
  const context = getRequestContext(request, reply);
  if (!context) return;
  const parsed = tripCreateSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ code: 'invalid_trip' });
  if (parsed.data.coverPhotoPath && !parsed.data.coverPhotoPath.startsWith(`${context.userId}/`)) {
    return reply.code(400).send({ code: 'invalid_cover_photo_path' });
  }

  try {
    const trip = await createTrip(context.userId, context.accessToken, parsed.data);
    return reply.code(201).send({ trip });
  } catch (error) {
    return handleTripError(error, reply);
  }
}

export async function updateTripController(request: FastifyRequest, reply: FastifyReply) {
  const context = getRequestContext(request, reply);
  const tripId = parseTripId(request, reply);
  if (!context || !tripId) return;
  const parsed = tripUpdateSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ code: 'invalid_trip' });
  if (parsed.data.coverPhotoPath && !parsed.data.coverPhotoPath.startsWith(`${context.userId}/`)) {
    return reply.code(400).send({ code: 'invalid_cover_photo_path' });
  }

  try {
    return { trip: await updateTrip(context.userId, context.accessToken, tripId, parsed.data) };
  } catch (error) {
    return handleTripError(error, reply);
  }
}

export async function deleteTripController(request: FastifyRequest, reply: FastifyReply) {
  const context = getRequestContext(request, reply);
  const tripId = parseTripId(request, reply);
  if (!context || !tripId) return;

  try {
    await deleteTrip(context.userId, context.accessToken, tripId);
    return reply.code(204).send();
  } catch (error) {
    return handleTripError(error, reply);
  }
}
