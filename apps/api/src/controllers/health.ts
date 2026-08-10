import type { FastifyReply, FastifyRequest } from 'fastify';

import { getDatabaseHealthStatus } from '../services/database-health.js';
import { getHealthStatus } from '../services/health.js';

export function healthController(_request: FastifyRequest, reply: FastifyReply) {
  return reply.code(200).send(getHealthStatus());
}

export async function databaseHealthController(_request: FastifyRequest, reply: FastifyReply) {
  try {
    await getDatabaseHealthStatus();
    return reply.code(200).send(getHealthStatus());
  } catch {
    return reply.code(503).send({ status: 'unavailable' });
  }
}
