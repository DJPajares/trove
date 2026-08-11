import type { FastifyReply, FastifyRequest } from 'fastify';

export async function authenticatedUserController(request: FastifyRequest, reply: FastifyReply) {
  if (!request.authUserId) {
    return reply.code(500).send({ code: 'authentication_context_missing' });
  }

  return { userId: request.authUserId };
}
