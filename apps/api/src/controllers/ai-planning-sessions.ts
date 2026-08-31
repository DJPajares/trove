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

export function createAiPlanningSessionControllers() {
  return {
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
        return reply.send({
          session: await cancelAiPlanningSession(userId, params.data.sessionId),
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
        return reply.code(202).send({
          session: await createAiPlanningSession(userId, body.data.prompt, idempotencyKey.data),
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
        return reply.code(202).send({
          session: await regenerateAiPlanningSession(
            userId,
            params.data.sessionId,
            body.data.prompt,
            body.data.expectedRevision,
            idempotencyKey.data,
          ),
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
