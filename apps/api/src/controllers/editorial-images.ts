import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { EditorialImagesService } from '../services/editorial-images.js';
import { TROVE_PLACE_CATEGORIES } from '../services/places.js';

/**
 * The same ceiling the inline place hydration uses. A screen asking for more
 * media than this in one request is a fan-out, not a screen.
 */
const MAX_EDITORIAL_IMAGE_SUBJECTS = 25;

const resolveEditorialImagesSchema = z
  .object({
    subjects: z
      .array(
        z
          .object({
            category: z.enum(TROVE_PLACE_CATEGORIES).optional(),
            name: z.string().trim().min(1).max(200),
            placeId: z.uuid().optional(),
            tripId: z.uuid().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_EDITORIAL_IMAGE_SUBJECTS),
  })
  .strict();

export function createEditorialImagesControllers(service: EditorialImagesService | null) {
  return {
    async resolve(request: FastifyRequest, reply: FastifyReply) {
      if (!request.authUserId) {
        return reply.code(500).send({ code: 'authentication_context_missing' });
      }

      const parsed = resolveEditorialImagesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: 'invalid_editorial_image_request' });
      }

      // Disabled and unconfigured both arrive here as a null service, and both
      // mean the same thing to a caller: render the branded fallback.
      if (!service) {
        return reply.code(204).send();
      }

      const images = await service.resolveMany(
        parsed.data.subjects.map(({ category, name, placeId, tripId }) => ({
          placeId,
          subject: { category, name },
          tripId,
        })),
        { ownerId: request.authUserId },
      );

      return { images };
    },
  };
}
