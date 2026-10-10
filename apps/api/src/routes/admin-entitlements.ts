import type { FastifyInstance } from 'fastify';
import type { PlanKey } from '@trove/types';
import { z } from 'zod';
import { requireAdmin } from '../services/admin-auth.js';
import {
  AdminOperationError,
  performAdminEntitlementOperation,
} from '../services/admin-entitlements.js';
import { EntitlementError, subscriptionPlanKeys } from '../services/plan-entitlements.js';

const targetSchema = z.object({ userId: z.uuid() }).strict();
const resetSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
const planSchema = resetSchema.extend({ planKey: z.enum(subscriptionPlanKeys) }).strict();
const keySchema = z.uuid();

export function registerAdminEntitlementRoutes(
  app: FastifyInstance,
  operate = performAdminEntitlementOperation,
) {
  for (const operation of ['reset', 'assign_plan'] as const) {
    app.route({
      method: operation === 'reset' ? 'POST' : 'PUT',
      url:
        operation === 'reset'
          ? '/admin/users/:userId/ai-planner/reset'
          : '/admin/users/:userId/plan',
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: requireAdmin(operation === 'reset' ? 'ai_planner:reset' : 'entitlements:write'),
      async handler(request, reply) {
        const params = targetSchema.safeParse(request.params);
        const body = (operation === 'reset' ? resetSchema : planSchema).safeParse(request.body);
        const key = keySchema.safeParse(request.headers['idempotency-key']);
        if (!params.success || !body.success || !key.success)
          return reply.code(400).send({ code: 'invalid_admin_operation' });
        if (!request.adminPrincipal) return reply.code(500).send({ code: 'admin_context_missing' });
        try {
          const result = await operate({
            ownerId: params.data.userId,
            operation,
            reason: body.data.reason,
            planKey: 'planKey' in body.data ? (body.data.planKey as PlanKey) : undefined,
            idempotencyKey: key.data,
            requestId: request.id.slice(0, 120),
            principal: request.adminPrincipal,
          });
          request.log.info(
            {
              kind: 'admin_entitlement_operation',
              auditId: result.auditId,
              actorId: request.adminPrincipal.actorId,
              ownerId: params.data.userId,
              operation,
            },
            'admin entitlement operation',
          );
          return reply.send(result);
        } catch (error) {
          if (!(error instanceof AdminOperationError) && !(error instanceof EntitlementError))
            throw error;
          return reply.code(error.statusCode).send({ code: error.code });
        }
      },
    });
  }
}
