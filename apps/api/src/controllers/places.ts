import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { PlacesService } from '../services/places.js';

const languageCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/);

const regionCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/)
  .transform((value) => value.toLowerCase());

const sessionTokenSchema = z
  .string()
  .trim()
  .min(1)
  .max(36)
  .regex(/^[A-Za-z0-9_-]+$/);

const placeSearchSchema = z
  .object({
    input: z.string().trim().min(1).max(200),
    languageCode: languageCodeSchema.optional(),
    locationBias: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        radiusMeters: z.number().positive().max(50_000),
      })
      .strict()
      .optional(),
    regionCode: regionCodeSchema.optional(),
    sessionToken: sessionTokenSchema.optional(),
  })
  .strict();

const placeDetailsParamsSchema = z
  .object({ providerPlaceId: z.string().trim().min(1).max(512) })
  .strict();

const placeDetailsQuerySchema = z
  .object({
    languageCode: languageCodeSchema.optional(),
    regionCode: regionCodeSchema.optional(),
    sessionToken: sessionTokenSchema.optional(),
  })
  .strict();

const photoNamePattern = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;
const placePhotoSchema = z
  .object({
    maxHeightPx: z.number().int().min(1).max(4_800).optional(),
    maxWidthPx: z.number().int().min(1).max(4_800).optional(),
    name: z.string().trim().max(4_096).regex(photoNamePattern),
  })
  .strict()
  .refine((value) => value.maxHeightPx !== undefined || value.maxWidthPx !== undefined);

function sendConfigurationMissing(reply: FastifyReply) {
  return reply.code(500).send({
    code: 'configuration_missing',
    provider: 'google',
    status: 'unavailable',
  });
}

function sendServiceResult(
  reply: FastifyReply,
  result: Awaited<
    | ReturnType<PlacesService['getDetails']>
    | ReturnType<PlacesService['resolvePhoto']>
    | ReturnType<PlacesService['search']>
  >,
) {
  if (result.status === 'unavailable') {
    const statusCode =
      result.code === 'invalid_request' ? 400 : result.code === 'configuration_missing' ? 500 : 503;
    return reply.code(statusCode).send(result);
  }

  if (result.status === 'empty' && !('suggestions' in result)) {
    return reply.code(404).send(result);
  }

  return reply.send(result);
}

export function createPlacesControllers(placesService: PlacesService | null) {
  return {
    async getDetails(request: FastifyRequest, reply: FastifyReply) {
      const parsedParams = placeDetailsParamsSchema.safeParse(request.params);
      const parsedQuery = placeDetailsQuerySchema.safeParse(request.query);

      if (!parsedParams.success || !parsedQuery.success) {
        return reply.code(400).send({ code: 'invalid_place_details_request' });
      }

      if (!placesService) {
        return sendConfigurationMissing(reply);
      }

      const result = await placesService.getDetails({
        externalPlaceId: parsedParams.data.providerPlaceId,
        ...parsedQuery.data,
      });

      return sendServiceResult(reply, result);
    },

    async resolvePhoto(request: FastifyRequest, reply: FastifyReply) {
      const parsed = placePhotoSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({ code: 'invalid_place_photo_request' });
      }

      if (!placesService) {
        return sendConfigurationMissing(reply);
      }

      const result = await placesService.resolvePhoto(parsed.data);
      return sendServiceResult(reply, result);
    },

    async search(request: FastifyRequest, reply: FastifyReply) {
      const parsed = placeSearchSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({ code: 'invalid_place_search_request' });
      }

      if (!placesService) {
        return sendConfigurationMissing(reply);
      }

      const result = await placesService.search(parsed.data);
      return sendServiceResult(reply, result);
    },
  };
}
