import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  addMemoryPhoto,
  createMemory,
  deleteMemory,
  deleteMemoryPhoto,
  listMemories,
  MemoryNotFoundError,
  MemoryValidationError,
  reorderHighlights,
  reorderMemoryPhotos,
  setStoryCoverPhoto,
  updateMemory,
} from '../services/memories.js';
import { getBearerToken } from '../services/request-auth.js';

const tripParamsSchema = z.object({ tripId: z.uuid() }).strict();
const memoryParamsSchema = z.object({ memoryId: z.uuid(), tripId: z.uuid() }).strict();
const photoParamsSchema = z
  .object({ memoryId: z.uuid(), photoId: z.uuid(), tripId: z.uuid() })
  .strict();

const memorySchema = z
  .object({
    capturedAt: z.iso.datetime({ offset: true }).optional(),
    capturedLocalDate: z.iso.date().optional(),
    capturedLocalTime: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    isHighlight: z.boolean().optional(),
    itineraryDayId: z.uuid().nullable().optional(),
    itineraryItemId: z.uuid().nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
    tripPlaceId: z.uuid().nullable().optional(),
  })
  .strict();

/** A queued offline capture replays with its own id so retries never duplicate. */
const createMemorySchema = memorySchema.extend({ clientMemoryId: z.uuid().optional() }).strict();

const photoSchema = z
  .object({
    contentType: z.string().min(1).max(100),
    fileName: z.string().min(1).max(255),
    path: z.string().min(1).max(1024),
    sizeBytes: z.number().int().min(0),
  })
  .strict();

const orderSchema = z.object({ order: z.array(z.uuid()).min(1).max(200) }).strict();
const storyCoverSchema = z.object({ memoryPhotoId: z.uuid().nullable() }).strict();

function getUserId(request: FastifyRequest, reply: FastifyReply) {
  if (!request.authUserId) {
    void reply.code(500).send({ code: 'authentication_context_missing' });
    return null;
  }
  return request.authUserId;
}

function handleError(reply: FastifyReply, error: unknown) {
  if (error instanceof MemoryNotFoundError) {
    return reply.code(404).send({ code: error.message });
  }
  if (error instanceof MemoryValidationError) {
    return reply.code(400).send({ code: error.message });
  }
  throw error;
}

export function createMemoryControllers() {
  return {
    async addPhoto(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = memoryParamsSchema.safeParse(request.params);
      const body = photoSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success) {
        return reply.code(400).send({ code: 'invalid_memory_photo' });
      }

      try {
        return reply
          .code(201)
          .send(
            await addMemoryPhoto(
              userId,
              params.data.tripId,
              params.data.memoryId,
              body.data,
              getBearerToken(request.headers.authorization),
            ),
          );
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async create(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = tripParamsSchema.safeParse(request.params);
      const body = createMemorySchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success) {
        return reply.code(400).send({ code: 'invalid_memory' });
      }

      const { clientMemoryId, ...input } = body.data;
      try {
        return reply
          .code(201)
          .send(
            await createMemory(
              userId,
              params.data.tripId,
              input,
              getBearerToken(request.headers.authorization),
              clientMemoryId,
            ),
          );
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async list(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = tripParamsSchema.safeParse(request.params);
      if (!userId) return;
      if (!params.success) return reply.code(400).send({ code: 'invalid_memory' });

      try {
        return reply.send(
          await listMemories(
            userId,
            params.data.tripId,
            getBearerToken(request.headers.authorization),
          ),
        );
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async remove(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = memoryParamsSchema.safeParse(request.params);
      if (!userId) return;
      if (!params.success) return reply.code(400).send({ code: 'invalid_memory' });

      try {
        await deleteMemory(
          userId,
          params.data.tripId,
          params.data.memoryId,
          getBearerToken(request.headers.authorization),
        );
        return reply.code(204).send();
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async removePhoto(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = photoParamsSchema.safeParse(request.params);
      if (!userId) return;
      if (!params.success) return reply.code(400).send({ code: 'invalid_memory_photo' });

      try {
        await deleteMemoryPhoto(
          userId,
          params.data.tripId,
          params.data.memoryId,
          params.data.photoId,
          getBearerToken(request.headers.authorization),
        );
        return reply.code(204).send();
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async reorderHighlights(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = tripParamsSchema.safeParse(request.params);
      const body = orderSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success) {
        return reply.code(400).send({ code: 'invalid_memory' });
      }

      try {
        return reply.send(
          await reorderHighlights(
            userId,
            params.data.tripId,
            body.data.order,
            getBearerToken(request.headers.authorization),
          ),
        );
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async reorderPhotos(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = memoryParamsSchema.safeParse(request.params);
      const body = orderSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success) {
        return reply.code(400).send({ code: 'invalid_memory_photo' });
      }

      try {
        return reply.send(
          await reorderMemoryPhotos(
            userId,
            params.data.tripId,
            params.data.memoryId,
            body.data.order,
            getBearerToken(request.headers.authorization),
          ),
        );
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async setStoryCover(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = tripParamsSchema.safeParse(request.params);
      const body = storyCoverSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success) {
        return reply.code(400).send({ code: 'invalid_memory_photo' });
      }

      try {
        return reply.send(
          await setStoryCoverPhoto(
            userId,
            params.data.tripId,
            body.data.memoryPhotoId,
            getBearerToken(request.headers.authorization),
          ),
        );
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async update(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = memoryParamsSchema.safeParse(request.params);
      const body = memorySchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success) {
        return reply.code(400).send({ code: 'invalid_memory' });
      }

      try {
        return reply.send(
          await updateMemory(
            userId,
            params.data.tripId,
            params.data.memoryId,
            body.data,
            getBearerToken(request.headers.authorization),
          ),
        );
      } catch (error) {
        return handleError(reply, error);
      }
    },
  };
}
