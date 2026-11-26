import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { getAtlasEnvironment } from '../environment.js';
import { getAtlasCountry, getAtlasIndex } from '../services/atlas-countries.js';
import { getAtlasDestinationGuide, getAtlasGuide } from '../services/atlas-guides.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';
import { ATLAS_GUIDE_RATE_LIMIT, ATLAS_INDEX_RATE_LIMIT } from './rate-limits.js';

const paramsSchema = z.object({ countryCode: z.string().regex(/^[A-Z]{2}$/) }).strict();
const destinationParamsSchema = z
  .object({
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })
  .strict();

export function registerAtlasRoutes(app: FastifyInstance) {
  // Every country with its typical conditions: shared data from the database,
  // the same for every traveller, so browsers may keep it for a while.
  app.get(
    '/atlas/countries',
    { config: ATLAS_INDEX_RATE_LIMIT, preHandler: requireAuthenticatedUser },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const index = await getAtlasIndex();
      return reply.header('Cache-Control', 'private, max-age=3600').send(index);
    },
  );

  app.get(
    '/atlas/guides/:countryCode',
    { config: ATLAS_GUIDE_RATE_LIMIT, preHandler: requireAuthenticatedUser },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ code: 'invalid_atlas_country' });

      const country = await getAtlasCountry(params.data.countryCode);
      if (!country) return reply.code(404).send({ code: 'atlas_country_unknown' });

      const environment = getAtlasEnvironment();
      if (!environment) return reply.code(503).send({ code: 'atlas_disabled' });

      const guide = await getAtlasGuide(params.data.countryCode, {
        title: country.wikivoyageTitle,
        userAgent: environment.userAgent,
      });
      // Wikivoyage could not be read and no earlier copy is stored: worth a retry.
      if (!guide) return reply.code(503).send({ code: 'atlas_guide_unavailable' });

      return reply.send({ guide });
    },
  );

  app.get(
    '/atlas/guides/:countryCode/:slug',
    { config: ATLAS_GUIDE_RATE_LIMIT, preHandler: requireAuthenticatedUser },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = destinationParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ code: 'invalid_atlas_destination' });

      const country = await getAtlasCountry(params.data.countryCode);
      if (!country) return reply.code(404).send({ code: 'atlas_country_unknown' });

      const environment = getAtlasEnvironment();
      if (!environment) return reply.code(503).send({ code: 'atlas_disabled' });

      const result = await getAtlasDestinationGuide(params.data.countryCode, params.data.slug, {
        title: country.wikivoyageTitle,
        userAgent: environment.userAgent,
      });
      if (result === 'unknown') return reply.code(404).send({ code: 'atlas_destination_unknown' });
      if (!result) return reply.code(503).send({ code: 'atlas_guide_unavailable' });

      return reply.send(result);
    },
  );
}
