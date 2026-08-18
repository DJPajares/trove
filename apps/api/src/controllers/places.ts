import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  CanonicalPlaceNotFoundError,
  createCanonicalPlacesService,
  type CanonicalPlacesService,
} from '../services/canonical-places.js';
import { PLACE_PROVIDERS, type PlacesService } from '../services/places.js';

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
    // The in-app detail sheet is gone, so `full` is no longer a servable
    // level: a request for it fails validation rather than paying for it.
    detail: z.enum(['location']).optional(),
    languageCode: languageCodeSchema.optional(),
    regionCode: regionCodeSchema.optional(),
    sessionToken: sessionTokenSchema.optional(),
  })
  .strict();

const providerPlaceResolutionSchema = z
  .object({
    externalPlaceId: z.string().trim().min(1).max(512),
    // What the caller saw when it picked this Place, kept only as a fallback for
    // when the provider cannot be reached later.
    label: z
      .object({
        address: z.string().trim().max(500).nullable().optional(),
        name: z.string().trim().max(200).nullable().optional(),
      })
      .strict()
      .optional(),
    provider: z.enum(PLACE_PROVIDERS),
  })
  .strict();

const customPlaceLocationSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    timeZone: z.string().trim().min(1).max(100).nullable().optional(),
  })
  .strict();

const customPlaceCreateSchema = z
  .object({
    location: customPlaceLocationSchema.nullable().optional(),
    name: z.string().trim().min(1).max(200),
    note: z.string().trim().max(5_000).nullable().optional(),
  })
  .strict();

const customPlaceUpdateSchema = z
  .object({
    location: customPlaceLocationSchema.nullable().optional(),
    name: z.string().trim().min(1).max(200).optional(),
    note: z.string().trim().max(5_000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined));

const customPlaceParamsSchema = z.object({ placeId: z.uuid() }).strict();

function sendConfigurationMissing(reply: FastifyReply) {
  return reply.code(500).send({
    code: 'configuration_missing',
    provider: 'google',
    status: 'unavailable',
  });
}

function sendServiceResult(
  reply: FastifyReply,
  result: Awaited<ReturnType<PlacesService['getDetails']> | ReturnType<PlacesService['search']>>,
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

function getAuthenticatedUserId(request: FastifyRequest, reply: FastifyReply) {
  if (!request.authUserId) {
    void reply.code(500).send({ code: 'authentication_context_missing' });
    return null;
  }

  return request.authUserId;
}

export function createPlacesControllers(
  placesService: PlacesService | null,
  canonicalPlacesService: CanonicalPlacesService = createCanonicalPlacesService(),
) {
  return {
    async createCustomPlace(request: FastifyRequest, reply: FastifyReply) {
      const userId = getAuthenticatedUserId(request, reply);
      if (!userId) return;

      const parsed = customPlaceCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: 'invalid_custom_place' });
      }

      const place = await canonicalPlacesService.createCustomPlace(userId, parsed.data);
      return reply.code(201).send({ place });
    },

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

    async resolveProviderPlace(request: FastifyRequest, reply: FastifyReply) {
      const parsed = providerPlaceResolutionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: 'invalid_place_resolution_request' });
      }

      const place = await canonicalPlacesService.resolveProviderPlace(
        parsed.data.provider,
        parsed.data.externalPlaceId,
        parsed.data.label,
      );
      return reply.send({ place });
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

    async updateCustomPlace(request: FastifyRequest, reply: FastifyReply) {
      const userId = getAuthenticatedUserId(request, reply);
      if (!userId) return;

      const parsedParams = customPlaceParamsSchema.safeParse(request.params);
      const parsedBody = customPlaceUpdateSchema.safeParse(request.body);
      if (!parsedParams.success || !parsedBody.success) {
        return reply.code(400).send({ code: 'invalid_custom_place' });
      }

      try {
        const place = await canonicalPlacesService.updateCustomPlace(
          userId,
          parsedParams.data.placeId,
          parsedBody.data,
        );
        return reply.send({ place });
      } catch (error) {
        if (error instanceof CanonicalPlaceNotFoundError) {
          return reply.code(404).send({ code: error.message });
        }
        throw error;
      }
    },
  };
}
