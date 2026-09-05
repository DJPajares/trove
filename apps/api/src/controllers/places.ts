import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  CanonicalPlaceNotFoundError,
  createCanonicalPlacesService,
  type CanonicalPlacesService,
} from '../services/canonical-places.js';
import type { PlaceLocationCandidatesService } from '../services/place-location-candidates.js';
import {
  PLACE_PROVIDERS,
  type PlacesService,
  type PlacesUnavailableCode,
} from '../services/places.js';

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

const providerPlaceResolutionSchema = z
  .object({
    externalPlaceId: z.string().trim().min(1).max(512),
    // The language the snapshot taken on this resolution is stored in, so the
    // screens that render it afterwards read the same one back.
    languageCode: languageCodeSchema.optional(),
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
    sessionToken: sessionTokenSchema.optional(),
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

/**
 * The wording the lookup is run on. Optional: a place already carries the name
 * the planner gave it, and that is the query worth trying first. A traveller who
 * knows the name was the problem retypes it here rather than editing the place
 * and searching again.
 */
const placeLocationCandidatesSchema = z
  .object({
    languageCode: languageCodeSchema.optional(),
    query: z.string().trim().min(1).max(200).optional(),
    regionCode: regionCodeSchema.optional(),
  })
  .strict();

function sendConfigurationMissing(reply: FastifyReply) {
  return reply.code(500).send({
    code: 'configuration_missing',
    provider: 'google',
    status: 'unavailable',
  });
}

/** One mapping, so two provider-backed routes cannot disagree about a refusal. */
function unavailableStatusCode(code: PlacesUnavailableCode) {
  return code === 'invalid_request' ? 400 : code === 'configuration_missing' ? 500 : 503;
}

function sendServiceResult(
  reply: FastifyReply,
  result: Awaited<ReturnType<PlacesService['search']>>,
) {
  if (result.status === 'unavailable') {
    return reply.code(unavailableStatusCode(result.code)).send(result);
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
  placeLocationCandidatesService: PlaceLocationCandidatesService | null = null,
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

    /**
     * Where one Custom Place might be, bought once because a traveller asked.
     *
     * Scoped to a Place the caller owns rather than taking a free-text query, so
     * every billed request is attached to something they are actually looking at.
     * It reads nothing and writes nothing: the traveller picks a candidate and
     * the existing custom-place update stores the coordinates.
     */
    async locationCandidates(request: FastifyRequest, reply: FastifyReply) {
      const userId = getAuthenticatedUserId(request, reply);
      if (!userId) return;

      const parsedParams = customPlaceParamsSchema.safeParse(request.params);
      const parsedBody = placeLocationCandidatesSchema.safeParse(request.body ?? {});
      if (!parsedParams.success || !parsedBody.success) {
        return reply.code(400).send({ code: 'invalid_place_location_request' });
      }

      const placeName = await canonicalPlacesService.findOwnedCustomPlaceName(
        userId,
        parsedParams.data.placeId,
      );
      if (!placeName) {
        return reply.code(404).send({ code: 'place_not_found' });
      }

      if (!placeLocationCandidatesService) {
        return sendConfigurationMissing(reply);
      }

      const result = await placeLocationCandidatesService.find({
        languageCode: parsedBody.data.languageCode,
        regionCode: parsedBody.data.regionCode,
        textQuery: parsedBody.data.query ?? placeName,
      });

      if (result.status === 'unavailable') {
        return reply.code(unavailableStatusCode(result.code)).send(result);
      }

      return reply.send(result);
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
        {
          languageCode: parsed.data.languageCode,
          sessionToken: parsed.data.sessionToken,
        },
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
