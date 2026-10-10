import { createHash, randomUUID } from 'node:crypto';
import { getPrismaClient, Prisma } from '@trove/db';
import type { AiPlannerEntitlementSnapshot, PlanKey } from '@trove/types';

import type { AdminPrincipal } from './admin-auth.js';
import {
  creditSnapshot,
  reconcileOwnerAiCredits,
  resolveAiCreditPeriod,
} from './ai-planner-credits.js';

export class AdminOperationError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: 404 | 409,
  ) {
    super(code);
  }
}
export type AdminEntitlementOperation = {
  ownerId: string;
  operation: 'reset' | 'assign_plan';
  planKey?: PlanKey;
  reason: string;
  idempotencyKey: string;
  requestId: string;
  principal: AdminPrincipal;
};
export type AdminEntitlementResult = {
  auditId: string;
  changed: boolean;
  entitlements: AiPlannerEntitlementSnapshot;
};

export async function performAdminEntitlementOperation(
  input: AdminEntitlementOperation,
  options: {
    prisma?: ReturnType<typeof getPrismaClient>;
    now?: Date;
  } = {},
): Promise<AdminEntitlementResult> {
  const prisma = options.prisma ?? getPrismaClient();
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        ownerId: input.ownerId,
        operation: input.operation,
        planKey: input.planKey ?? null,
        reason: input.reason,
      }),
    )
    .digest('hex');
  return prisma.$transaction(async (tx) => {
    // Serialize retries by actor too, including reuse against different targets.
    await tx.$queryRaw(
      Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${input.principal.actorId}, 0))`,
    );
    const replay = await tx.adminOperationAudit.findUnique({
      where: {
        actorId_idempotencyKey: {
          actorId: input.principal.actorId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (replay) {
      if (replay.requestHash !== hash)
        throw new AdminOperationError('admin_idempotency_conflict', 409);
      return replay.result as unknown as AdminEntitlementResult;
    }
    const target = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "trove"."profiles" WHERE "id" = ${input.ownerId}::uuid FOR UPDATE`,
    );
    if (!target.length) throw new AdminOperationError('user_not_found', 404);
    const now = options.now ?? new Date();
    await reconcileOwnerAiCredits(tx, input.ownerId, now);
    if (
      (await tx.aiGenerationRun.count({
        where: {
          ownerId: input.ownerId,
          result: 'PENDING',
          dispatchedAt: { not: null },
          deadlineAt: { gt: now },
        },
      })) ||
      (await tx.aiCreditAction.count({ where: { ownerId: input.ownerId, state: 'reserved' } }))
    ) {
      throw new AdminOperationError('ai_generation_active', 409);
    }
    let resolved = await resolveAiCreditPeriod(tx, input.ownerId, now);
    const before = {
      ...creditSnapshot(resolved),
      assignedPlan: resolved.assignedPlan,
      subscriptionStatus: resolved.status,
    };
    const changed =
      input.operation === 'reset' ||
      input.planKey !== resolved.assignedPlan ||
      resolved.status !== 'active';
    if (input.operation === 'assign_plan') {
      if (!input.planKey) throw new AdminOperationError('plan_required', 409);
      if (changed) {
        await tx.userEntitlement.update({
          where: { ownerId: input.ownerId },
          data: {
            planKey: input.planKey,
            subscriptionStatus: 'active',
            ...(input.planKey === 'paid' && !resolved.account.monthlyAnchorAt
              ? { monthlyAnchorAt: now }
              : {}),
          },
        });
        resolved = await resolveAiCreditPeriod(tx, input.ownerId, now);
      }
    } else {
      // New allocation epoch keeps the old balance and every charge intact.
      const previous = resolved.period;
      const period = await tx.aiCreditPeriod.create({
        data: {
          ownerId: input.ownerId,
          planKey: previous.planKey,
          startAt: previous.startAt,
          endAt: previous.endAt,
          renewalPolicy: previous.renewalPolicy,
          sequence: previous.sequence + 1,
          allowance: resolved.limits.credits,
          source: 'admin_reset',
          createdAt: now,
        },
      });
      await tx.aiCreditEvent.create({
        data: {
          ownerId: input.ownerId,
          periodId: period.id,
          kind: 'grant',
          amount: period.allowance,
          source: 'admin_reset',
          createdAt: now,
        },
      });
      resolved = { ...resolved, period };
    }
    const result = { auditId: randomUUID(), changed, entitlements: creditSnapshot(resolved) };
    await tx.adminOperationAudit.create({
      data: {
        id: result.auditId,
        ownerId: input.ownerId,
        actorId: input.principal.actorId,
        credentialId: input.principal.credentialId,
        operation: input.operation,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        requestId: input.requestId,
        requestHash: hash,
        before: before as unknown as Prisma.InputJsonValue,
        result: result as unknown as Prisma.InputJsonValue,
        createdAt: now,
      },
    });
    return result;
  });
}
