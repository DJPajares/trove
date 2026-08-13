import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { createPlacesService } from '../services/places-runtime.js';
import { searchTrove } from '../services/search.js';

const searchQuerySchema = z
  .object({
    places: z.enum(['0', '1']).optional().default('0'),
    q: z.string().trim().min(2).max(120),
  })
  .strict();

export async function searchController(request: FastifyRequest, reply: FastifyReply) {
  if (!request.authUserId) {
    return reply.code(500).send({ code: 'authentication_context_missing' });
  }
  const query = searchQuerySchema.safeParse(request.query);
  if (!query.success) return reply.code(400).send({ code: 'invalid_search_query' });

  return reply.send(
    await searchTrove(request.authUserId, query.data.q, {
      includePlaces: query.data.places === '1',
      placesService: createPlacesService(),
    }),
  );
}
