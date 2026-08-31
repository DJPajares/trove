import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  acknowledgeAiPlanningWarnings,
  AiPlanningSessionError,
  cancelAiPlanningSession,
  createAiPlanningSession,
  getAiPlanningSession,
  recoverLatestAiPlanningSession,
  regenerateAiPlanningSession,
  replaceAiPlanningDraft,
} from '../services/ai-planning-sessions.js';
import {
  abortActiveAiPlanningSession,
  runAiPlanningPipeline,
} from '../services/ai-planning-pipeline.js';
import { applyAiPlanningSession } from '../services/ai-planning-apply.js';
import { getBearerToken } from '../services/request-auth.js';
import { getTrip } from '../services/trips.js';

const sessionParamsSchema = z.object({ sessionId: z.uuid() }).strict();
const promptSchema = z.object({ prompt: z.string() }).strict();
const regenerateSchema = z
  .object({ expectedRevision: z.number().int().nonnegative(), prompt: z.string() })
  .strict();
const draftSchema = z
  .object({ draft: z.unknown(), expectedRevision: z.number().int().nonnegative() })
  .strict();
const acknowledgementSchema = z.object({ revision: z.number().int().nonnegative() }).strict();
const emptyBodySchema = z.object({}).strict();
const applySchema = z
  .object({
    deviceTimeZone: z.string().trim().min(1).max(100).optional(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
const idempotencyKeySchema = z.uuid();

function getUserId(request: FastifyRequest, reply: FastifyReply) {
  if (!request.authUserId) {
    void reply.code(500).send({ code: 'authentication_context_missing' });
    return null;
  }
  return request.authUserId;
}

function getIdempotencyKey(request: FastifyRequest) {
  const value = request.headers['idempotency-key'];
  return idempotencyKeySchema.safeParse(typeof value === 'string' ? value : undefined);
}

function handleError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof AiPlanningSessionError)) throw error;
  return reply.code(error.statusCode).send({
    code: error.code,
    ...(error.retryAt ? { retryAt: error.retryAt.toISOString() } : {}),
  });
}

type DispatchablePlanningSession = {
  id: string;
  pendingRunId: string | null;
  stage: string;
  status: string;
};

type PlanningSessionControllerDependencies = {
  abortSession?: (sessionId: string) => void;
  getSession?: (ownerId: string, sessionId: string) => Promise<DispatchablePlanningSession>;
  runPipeline?: (ownerId: string, runId: string) => Promise<void>;
};

export async function dispatchReservedAiPlanningRun(
  ownerId: string,
  session: DispatchablePlanningSession,
  dependencies: Pick<PlanningSessionControllerDependencies, 'getSession' | 'runPipeline'> = {},
) {
  if (
    session.status !== 'pending' ||
    session.stage !== 'created' ||
    session.pendingRunId === null
  ) {
    return session;
  }

  try {
    await (dependencies.runPipeline ?? runAiPlanningPipeline)(ownerId, session.pendingRunId);
  } catch (error) {
    // An idempotent concurrent request may observe the same reservation before
    // the first request claims it. It must recover the shared session instead
    // of surfacing a second dispatch attempt as a client error.
    if (!(error instanceof AiPlanningSessionError) || error.code !== 'run_already_claimed') {
      throw error;
    }
  }

  return (dependencies.getSession ?? getAiPlanningSession)(ownerId, session.id);
}

export function createAiPlanningSessionControllers(
  dependencies: PlanningSessionControllerDependencies = {},
) {
  return {
    async apply(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = sessionParamsSchema.safeParse(request.params);
      const body = applySchema.safeParse(request.body);
      const accessToken = getBearerToken(request.headers.authorization);
      if (!userId) return;
      if (!accessToken) {
        return reply.code(500).send({ code: 'authentication_context_missing' });
      }
      if (!params.success || !body.success) {
        return reply.code(400).send({ code: 'invalid_planning_session_request' });
      }
      try {
        const applied = await applyAiPlanningSession(
          userId,
          params.data.sessionId,
          body.data.expectedRevision,
          body.data.deviceTimeZone,
        );
        return reply.send({ trip: await getTrip(userId, accessToken, applied.tripId) });
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async acknowledgeWarnings(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = sessionParamsSchema.safeParse(request.params);
      const body = acknowledgementSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success) {
        return reply.code(400).send({ code: 'invalid_planning_session_request' });
      }
      try {
        return reply.send({
          session: await acknowledgeAiPlanningWarnings(
            userId,
            params.data.sessionId,
            body.data.revision,
          ),
        });
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async cancel(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = sessionParamsSchema.safeParse(request.params);
      const body = emptyBodySchema.safeParse(request.body ?? {});
      if (!userId) return;
      if (!params.success || !body.success) {
        return reply.code(400).send({ code: 'invalid_planning_session_request' });
      }
      try {
        const session = await cancelAiPlanningSession(userId, params.data.sessionId);
        (dependencies.abortSession ?? abortActiveAiPlanningSession)(params.data.sessionId);
        return reply.send({
          session,
        });
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async create(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const body = promptSchema.safeParse(request.body);
      const idempotencyKey = getIdempotencyKey(request);
      if (!userId) return;
      if (!body.success) {
        return reply.code(400).send({ code: 'invalid_planning_session_request' });
      }
      if (!idempotencyKey.success) {
        return reply.code(400).send({ code: 'idempotency_key_required' });
      }
      try {
        const session = await createAiPlanningSession(
          userId,
          body.data.prompt,
          idempotencyKey.data,
        );
        return reply.code(202).send({
          session: await dispatchReservedAiPlanningRun(userId, session, dependencies),
        });
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async get(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = sessionParamsSchema.safeParse(request.params);
      if (!userId) return;
      if (!params.success) {
        return reply.code(400).send({ code: 'invalid_planning_session_request' });
      }
      try {
        return reply.send({
          session: await getAiPlanningSession(userId, params.data.sessionId),
        });
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async recover(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      if (!userId) return;
      return reply.send({ session: await recoverLatestAiPlanningSession(userId) });
    },

    async regenerate(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = sessionParamsSchema.safeParse(request.params);
      const body = regenerateSchema.safeParse(request.body);
      const idempotencyKey = getIdempotencyKey(request);
      if (!userId) return;
      if (!params.success || !body.success) {
        return reply.code(400).send({ code: 'invalid_planning_session_request' });
      }
      if (!idempotencyKey.success) {
        return reply.code(400).send({ code: 'idempotency_key_required' });
      }
      try {
        const session = await regenerateAiPlanningSession(
          userId,
          params.data.sessionId,
          body.data.prompt,
          body.data.expectedRevision,
          idempotencyKey.data,
        );
        return reply.code(202).send({
          session: await dispatchReservedAiPlanningRun(userId, session, dependencies),
        });
      } catch (error) {
        return handleError(reply, error);
      }
    },

    async replaceDraft(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      const params = sessionParamsSchema.safeParse(request.params);
      const body = draftSchema.safeParse(request.body);
      if (!userId) return;
      if (!params.success || !body.success) {
        return reply.code(400).send({ code: 'invalid_planning_session_request' });
      }
      try {
        return reply.send({
          session: await replaceAiPlanningDraft(
            userId,
            params.data.sessionId,
            body.data.draft,
            body.data.expectedRevision,
          ),
        });
      } catch (error) {
        return handleError(reply, error);
      }
    },
  };
}
