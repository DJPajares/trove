import type { FastifyReply, FastifyRequest } from 'fastify';

import { getHealthStatus } from '../services/health.js';

export function healthController(_request: FastifyRequest, reply: FastifyReply) {
  return reply.code(200).send(getHealthStatus());
}
