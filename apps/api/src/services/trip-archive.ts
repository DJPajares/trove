import { getPrismaClient } from '@trove/db';
import type { FastifyReply, FastifyRequest } from 'fastify';

export type ArchiveFilter = 'exclude' | 'only' | 'include';
export function archiveWhere(filter: ArchiveFilter = 'exclude') {
  return filter === 'include' ? {} : { archivedAt: filter === 'only' ? { not: null } : null };
}

/** Runs after authentication, before any content write or Trip Mode acquisition. */
export async function requireUnarchivedTrip(request: FastifyRequest, reply: FastifyReply) {
  const params = request.params as { tripId?: string };
  const path = request.routeOptions.url ?? '';
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  const management =
    path === '/trips/:tripId/archive' || (path === '/trips/:tripId' && request.method === 'DELETE');
  if (management || (!mutation && !path.includes('/trip-mode/'))) return;
  const tripId =
    params.tripId ??
    (path === '/task-templates/:templateId/apply'
      ? (request.body as { tripId?: string })?.tripId
      : undefined);
  if (!tripId || !/^[\da-f-]{36}$/i.test(tripId)) return;
  const trip = await getPrismaClient().trip.findFirst({
    where: { id: tripId, ownerId: request.authUserId },
    select: { archivedAt: true },
  });
  if (trip?.archivedAt) return reply.code(409).send({ code: 'trip_archived' });
}
