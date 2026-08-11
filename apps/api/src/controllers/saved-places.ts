import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  addSavedPlaceToCollection,
  createSavedCollection,
  listSavedPlaces,
  removeSavedCollection,
  removeSavedPlaceFromCollection,
  renameSavedCollection,
  savePlace,
  SavedCollectionNameConflictError,
  SavedCollectionNotFoundError,
  SavedPlaceNotFoundError,
  unsavePlace,
  updateSavedPlaceNote,
} from '../services/saved-places.js';

const idParamsSchema = z.object({ id: z.uuid() }).strict();
const collectionLinkParamsSchema = z
  .object({ collectionId: z.uuid(), savedPlaceId: z.uuid() })
  .strict();
const savePlaceSchema = z.object({ placeId: z.uuid() }).strict();
const noteSchema = z.object({ note: z.string().trim().max(5_000).nullable() }).strict();
const collectionNameSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();

function getAuthenticatedUserId(request: FastifyRequest, reply: FastifyReply) {
  if (!request.authUserId) {
    void reply.code(500).send({ code: 'authentication_context_missing' });
    return null;
  }

  return request.authUserId;
}

function sendSavedPlaceError(reply: FastifyReply, error: unknown) {
  if (error instanceof SavedPlaceNotFoundError) {
    return reply.code(404).send({ code: error.message });
  }
  if (error instanceof SavedCollectionNotFoundError) {
    return reply.code(404).send({ code: error.message });
  }
  if (error instanceof SavedCollectionNameConflictError) {
    return reply.code(409).send({ code: error.message });
  }
  throw error;
}

export function createSavedPlacesControllers() {
  return {
    async addPlaceToCollection(request: FastifyRequest, reply: FastifyReply) {
      const userId = getAuthenticatedUserId(request, reply);
      const params = collectionLinkParamsSchema.safeParse(request.params);
      if (!userId) return;
      if (!params.success) return reply.code(400).send({ code: 'invalid_saved_collection_link' });

      try {
        await addSavedPlaceToCollection(userId, params.data.savedPlaceId, params.data.collectionId);
        return reply.code(204).send();
      } catch (error) {
        return sendSavedPlaceError(reply, error);
      }
    },

    async createCollection(request: FastifyRequest, reply: FastifyReply) {
      const userId = getAuthenticatedUserId(request, reply);
      const body = collectionNameSchema.safeParse(request.body);
      if (!userId) return;
      if (!body.success) return reply.code(400).send({ code: 'invalid_saved_collection' });

      try {
        const collection = await createSavedCollection(userId, body.data.name);
        return reply.code(201).send({ collection });
      } catch (error) {
        return sendSavedPlaceError(reply, error);
      }
    },

    async deleteCollection(request: FastifyRequest, reply: FastifyReply) {
      const userId = getAuthenticatedUserId(request, reply);
      const params = idParamsSchema.safeParse(request.params);
      if (!userId) return;
      if (!params.success) return reply.code(400).send({ code: 'invalid_saved_collection' });

      try {
        await removeSavedCollection(userId, params.data.id);
        return reply.code(204).send();
      } catch (error) {
        return sendSavedPlaceError(reply, error);
      }
    },

    async getSavedPlaces(request: FastifyRequest, reply: FastifyReply) {
      const userId = getAuthenticatedUserId(request, reply);
      if (!userId) return;
      return listSavedPlaces(userId);
    },

    async removePlaceFromCollection(request: FastifyRequest, reply: FastifyReply) {
      const userId = getAuthenticatedUserId(request, reply);
      const params = collectionLinkParamsSchema.safeParse(request.params);
      if (!userId) return;
      if (!params.success) return reply.code(400).send({ code: 'invalid_saved_collection_link' });

      try {
        await removeSavedPlaceFromCollection(
          userId,
          params.data.savedPlaceId,
          params.data.collectionId,
        );
        return reply.code(204).send();
      } catch (error) {
        return sendSavedPlaceError(reply, error);
      }
    },

    async renameCollection(request: FastifyRequest, reply: FastifyReply) {
      const userId = getAuthenticatedUserId(request, reply);
      const params = idParamsSchema.safeParse(request.params);
      const body = collectionNameSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success) {
        return reply.code(400).send({ code: 'invalid_saved_collection' });
      }

      try {
        const collection = await renameSavedCollection(userId, params.data.id, body.data.name);
        return reply.send({ collection });
      } catch (error) {
        return sendSavedPlaceError(reply, error);
      }
    },

    async savePlace(request: FastifyRequest, reply: FastifyReply) {
      const userId = getAuthenticatedUserId(request, reply);
      const body = savePlaceSchema.safeParse(request.body);
      if (!userId) return;
      if (!body.success) return reply.code(400).send({ code: 'invalid_saved_place' });

      try {
        const savedPlace = await savePlace(userId, body.data.placeId);
        return reply.send({ savedPlace });
      } catch (error) {
        return sendSavedPlaceError(reply, error);
      }
    },

    async unsavePlace(request: FastifyRequest, reply: FastifyReply) {
      const userId = getAuthenticatedUserId(request, reply);
      const params = idParamsSchema.safeParse(request.params);
      if (!userId) return;
      if (!params.success) return reply.code(400).send({ code: 'invalid_saved_place' });

      await unsavePlace(userId, params.data.id);
      return reply.code(204).send();
    },

    async updatePlaceNote(request: FastifyRequest, reply: FastifyReply) {
      const userId = getAuthenticatedUserId(request, reply);
      const params = idParamsSchema.safeParse(request.params);
      const body = noteSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success)
        return reply.code(400).send({ code: 'invalid_saved_place' });

      try {
        const savedPlace = await updateSavedPlaceNote(userId, params.data.id, body.data.note);
        return reply.send({ savedPlace });
      } catch (error) {
        return sendSavedPlaceError(reply, error);
      }
    },
  };
}
