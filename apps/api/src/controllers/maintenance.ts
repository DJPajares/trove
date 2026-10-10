import { cleanupProviderEvidence } from '../services/provider-evidence-retention.js';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { getMaintenanceEnvironment } from '../environment.js';
import { cleanupAiPlanningRetention } from '../services/ai-planning-retention.js';
import { reconcileOverdueAiCredits } from '../services/ai-planner-credits.js';
import {
  createStorageCleanupClient,
  processTripMediaCleanup,
} from '../services/trip-media-cleanup.js';
import { getBearerToken } from '../services/request-auth.js';
import { dispatchNotifications, getPushEnvironment } from '../services/web-push.js';

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

  let report;
  try {
    await reconcileOverdueAiCredits();
    report = await cleanupAiPlanningRetention();
  } catch {
    request.log.error({ kind: 'ai_planning_retention' }, 'ai planning retention failed');
    return reply.code(503).send({ code: 'retention_failed' });
  }
  request.log.info({ ...report, kind: 'ai_planning_retention' }, 'ai planning retention');
  if (report.remainingOverdueSessions > 0) {
    request.log.error(
      { kind: 'ai_planning_retention', remainingOverdueSessions: report.remainingOverdueSessions },
      'ai planning retention left overdue content',
    );
    return reply.code(503).send(report);
  }

  return reply.send(report);
}

export async function tripMediaCleanupController(request: FastifyRequest, reply: FastifyReply) {
  if (!getMaintenanceEnvironment()) return reply.code(503).send({ code: 'configuration_missing' });
  if (!isScheduler(request)) return reply.code(401).send({ code: 'unauthorized' });
  const client = createStorageCleanupClient();
  if (!client) return reply.code(503).send({ code: 'storage_cleanup_configuration_missing' });
  const report = await processTripMediaCleanup({ client });
  request.log.info({ ...report, kind: 'trip_media_cleanup' }, 'trip media cleanup');
  return reply.send(report);
}

export async function notificationDispatchController(request: FastifyRequest, reply: FastifyReply) {
  const secret = process.env.NOTIFICATION_DISPATCH_SECRET?.trim();
  if (!secret || !getPushEnvironment())
    return reply.code(503).send({ code: 'configuration_missing' });
  const presented = getBearerToken(request.headers.authorization);
  if (!presented) return reply.code(401).send({ code: 'unauthorized' });
  const expected = Buffer.from(secret);
  const actual = Buffer.from(presented);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return reply.code(401).send({ code: 'unauthorized' });
  }
  try {
    const report = await dispatchNotifications();
    request.log.info({ ...report, kind: 'notification_dispatch' }, 'notification dispatch');
    return reply.send(report);
  } catch {
    request.log.error({ kind: 'notification_dispatch' }, 'notification dispatch failed');
    return reply.code(503).send({ code: 'notification_dispatch_failed' });
  }
}

export async function providerEvidenceRetentionController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!getMaintenanceEnvironment()) return reply.code(503).send({ code: 'configuration_missing' });
  if (!isScheduler(request)) return reply.code(401).send({ code: 'unauthorized' });
  try {
    const report = await cleanupProviderEvidence();
    request.log.info(
      { ...report, kind: 'provider_evidence_retention' },
      'provider evidence retention',
    );
    return reply.send(report);
  } catch {
    return reply.code(503).send({ code: 'retention_failed' });
  }
}
