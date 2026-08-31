import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { getMaintenanceEnvironment } from '../environment.js';
import { cleanupAiPlanningRetention } from '../services/ai-planning-retention.js';
import { getBearerToken } from '../services/request-auth.js';

/**
 * Vercel Cron authenticates by sending `Authorization: Bearer $CRON_SECRET`, so
 * this is the one route in the API whose caller is a scheduler rather than a
 * traveller. With no secret configured the route is closed rather than open: a
 * misconfigured deployment must not expose a maintenance endpoint to the world.
 */
function isScheduler(request: FastifyRequest) {
  const configured = getMaintenanceEnvironment();
  if (!configured) return false;

  const presented = getBearerToken(request.headers.authorization);
  if (!presented) return false;

  const expectedBytes = Buffer.from(configured.cronSecret);
  const presentedBytes = Buffer.from(presented);

  return (
    expectedBytes.length === presentedBytes.length && timingSafeEqual(expectedBytes, presentedBytes)
  );
}

export async function aiPlanningRetentionController(request: FastifyRequest, reply: FastifyReply) {
  if (!getMaintenanceEnvironment()) {
    return reply.code(503).send({ code: 'configuration_missing' });
  }
  if (!isScheduler(request)) {
    return reply.code(401).send({ code: 'unauthorized' });
  }

  // The report is three counts. Nothing it can carry describes what was removed.
  const report = await cleanupAiPlanningRetention();
  request.log.info({ ...report, kind: 'ai_planning_retention' }, 'ai planning retention');

  return reply.send(report);
}
