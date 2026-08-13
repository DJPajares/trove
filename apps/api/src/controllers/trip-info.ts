import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { getBearerToken } from '../services/request-auth.js';
import {
  createTripInfo,
  deleteTripInfo,
  listTripInfo,
  TripInfoNotFoundError,
  TripInfoConflictError,
  TripInfoValidationError,
  updateTripInfo,
} from '../services/trip-info.js';

const tripParamsSchema = z.object({ tripId: z.uuid() }).strict();
const entryParamsSchema = z.object({ entryId: z.uuid(), tripId: z.uuid() }).strict();
const infoFields = {
  category: z.string().trim().max(100).nullable().optional(),
  isPinned: z.boolean().optional(),
  label: z.string().trim().min(1).max(120),
  link: z.string().trim().max(2_000).nullable().optional(),
  note: z.string().trim().max(5_000).nullable().optional(),
  value: z.string().trim().min(1).max(5_000),
} as const;
const createSchema = z.object({ ...infoFields, clientEntryId: z.uuid().optional() }).strict();
const updateSchema = z
  .object({
    category: infoFields.category,
    isPinned: infoFields.isPinned,
    label: infoFields.label.optional(),
    link: infoFields.link,
    note: infoFields.note,
    value: infoFields.value.optional(),
  })
  .strict();

function getUserId(request: FastifyRequest, reply: FastifyReply) {
  const accessToken = getBearerToken(request.headers.authorization);
  if (!request.authUserId || !accessToken) {
    void reply.code(500).send({ code: 'authentication_context_missing' });
    return null;
  }
  return request.authUserId;
}

function parseParams<T>(
  schema: z.ZodType<T>,
  request: FastifyRequest,
  reply: FastifyReply,
): T | null {
  const parsed = schema.safeParse(request.params);
  if (!parsed.success) {
    void reply.code(400).send({ code: 'invalid_trip_info_id' });
    return null;
  }
  return parsed.data;
}

function handleError(error: unknown, reply: FastifyReply) {
  if (error instanceof TripInfoConflictError) {
    return reply.code(409).send({ code: error.message });
  }
  if (error instanceof TripInfoNotFoundError) {
    return reply.code(404).send({ code: error.message });
  }
  if (error instanceof TripInfoValidationError) {
    return reply.code(400).send({ code: error.code });
  }
  throw error;
}

function getExpectedUpdatedAt(request: FastifyRequest) {
  const value = request.headers['x-trove-expected-updated-at'];
  return typeof value === 'string' ? value : undefined;
}

export async function getTripInfoController(request: FastifyRequest, reply: FastifyReply) {
  const userId = getUserId(request, reply);
  const params = parseParams(tripParamsSchema, request, reply);
  if (!userId || !params) return;

  try {
    return await listTripInfo(userId, params.tripId);
  } catch (error) {
    return handleError(error, reply);
  }
}

export async function createTripInfoController(request: FastifyRequest, reply: FastifyReply) {
  const userId = getUserId(request, reply);
  const params = parseParams(tripParamsSchema, request, reply);
  const body = createSchema.safeParse(request.body);
  if (!userId || !params) return;
  if (!body.success) return reply.code(400).send({ code: 'invalid_trip_info' });

  try {
    const { clientEntryId, ...input } = body.data;
    return reply
      .code(201)
      .send({ entry: await createTripInfo(userId, params.tripId, input, clientEntryId) });
  } catch (error) {
    return handleError(error, reply);
  }
}

export async function updateTripInfoController(request: FastifyRequest, reply: FastifyReply) {
  const userId = getUserId(request, reply);
  const params = parseParams(entryParamsSchema, request, reply);
  const body = updateSchema.safeParse(request.body);
  if (!userId || !params) return;
  if (!body.success) return reply.code(400).send({ code: 'invalid_trip_info' });

  try {
    return reply.send({
      entry: await updateTripInfo(
        userId,
        params.tripId,
        params.entryId,
        body.data,
        getExpectedUpdatedAt(request),
      ),
    });
  } catch (error) {
    return handleError(error, reply);
  }
}

export async function deleteTripInfoController(request: FastifyRequest, reply: FastifyReply) {
  const userId = getUserId(request, reply);
  const params = parseParams(entryParamsSchema, request, reply);
  if (!userId || !params) return;

  try {
    await deleteTripInfo(userId, params.tripId, params.entryId, getExpectedUpdatedAt(request));
    return reply.code(204).send();
  } catch (error) {
    return handleError(error, reply);
  }
}
