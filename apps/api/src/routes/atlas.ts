import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ATLAS_INDEX } from '@trove/types/atlas-index';

import { getAtlasEnvironment } from '../environment.js';
import { getAtlasGuide } from '../services/atlas-guides.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';
import { ATLAS_GUIDE_RATE_LIMIT } from './rate-limits.js';

const paramsSchema = z.object({ countryCode: z.string().regex(/^[A-Z]{2}$/) }).strict();

export function registerAtlasRoutes(app: FastifyInstance) {
  app.get(
    '/atlas/guides/:countryCode',
    { config: ATLAS_GUIDE_RATE_LIMIT, preHandler: requireAuthenticatedUser },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ code: 'invalid_atlas_country' });

      const known = ATLAS_INDEX.countries.some(
        (country) => country.countryCode === params.data.countryCode,
      );
      if (!known) return reply.code(404).send({ code: 'atlas_country_unknown' });

      const environment = getAtlasEnvironment();
      if (!environment) return reply.code(503).send({ code: 'atlas_disabled' });

      const guide = await getAtlasGuide(params.data.countryCode, {
        userAgent: environment.userAgent,
      });
      // Wikivoyage could not be read and no earlier copy is stored: worth a retry.
      if (!guide) return reply.code(503).send({ code: 'atlas_guide_unavailable' });

      return reply.send({ guide });
    },
  );
}
