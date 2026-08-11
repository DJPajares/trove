import type { FastifyReply, FastifyRequest } from 'fastify';

import { getAuthenticatedUserId } from './supabase-auth.js';

export function getBearerToken(authorization: string | undefined) {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);

  return match?.[1] ?? null;
}

export async function requireAuthenticatedUser(request: FastifyRequest, reply: FastifyReply) {
  const accessToken = getBearerToken(request.headers.authorization);

  if (!accessToken) {
    return reply.code(401).send({ code: 'unauthorized' });
  }

  const authentication = await getAuthenticatedUserId(accessToken);

  if (authentication.reason === 'configuration') {
    return reply.code(500).send({ code: 'authentication_configuration_missing' });
  }

  if (!authentication.userId) {
    return reply.code(401).send({ code: 'unauthorized' });
  }

  request.authUserId = authentication.userId;
}
