import { Prisma, getPrismaClient } from '@trove/db';
import type { AiPlannerEntitlementSnapshot, CreditRenewalPolicy } from '@trove/types';

import { creditPeriod, EntitlementError, getAiPlannerBurstLimit } from './plan-entitlements.js';
import { resolveUserEntitlements } from './user-entitlements.js';

export type CreditTransaction = Prisma.TransactionClient;

/** Shared by dispatch, settlement, renewal and admin operations across API instances. */
export async function lockAiCreditOwner(tx: CreditTransaction, ownerId: string) {
  // Profile creation itself must be serialized: ORM upsert can race on the first request.
  await tx.$queryRaw(
    Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`ai-credit:${ownerId}`}, 0))`,
  );
  await tx.profile.upsert({ where: { id: ownerId }, create: { id: ownerId }, update: {} });
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "trove"."profiles" WHERE "id" = ${ownerId}::uuid FOR UPDATE`,
  );
}

export async function resolveAiCreditPeriod(tx: CreditTransaction, ownerId: string, now: Date) {
  const subscription = await resolveUserEntitlements(tx, ownerId, now);
  const { account, effectivePlan: tier } = subscription;
  const limits = subscription.entitlements.aiPlanner;
  const anchor = limits.renewal === 'monthly' ? account.monthlyAnchorAt! : account.createdAt;
  const boundary = creditPeriod(anchor, now, limits.renewal);
  let period = await tx.aiCreditPeriod.findFirst({
    where: { ownerId, planKey: tier, startAt: boundary.startAt },
    orderBy: { sequence: 'desc' },
  });
  if (!period) {
    period = await tx.aiCreditPeriod.create({
      data: {
        ownerId,
        planKey: tier,
        ...boundary,
        renewalPolicy: limits.renewal,
        allowance: limits.credits,
        source: 'plan',
        createdAt: now,
      },
    });
    await tx.aiCreditEvent.create({
      data: {
        ownerId,
        periodId: period.id,
        kind: 'grant',
        amount: period.allowance,
        source: 'plan',
        createdAt: now,
      },
    });
  }
  return { ...subscription, limits, period };
}

export function creditSnapshot(
  resolved: Awaited<ReturnType<typeof resolveAiCreditPeriod>>,
): AiPlannerEntitlementSnapshot {
  const { effectivePlan, limits, period } = resolved;
  return {
    tier: effectivePlan,
    allowance: period.allowance,
    usedCredits: period.used,
    reservedCredits: period.reserved,
    availableCredits: period.allowance - period.used - period.reserved,
    renewalPolicy: period.renewalPolicy as CreditRenewalPolicy,
    periodStart: period.startAt.toISOString(),
    periodEnd: period.endAt?.toISOString() ?? null,
    nextRenewalAt: period.endAt?.toISOString() ?? null,
    maxItineraryDays: limits.maxItineraryDays,
  };
}

/** Terminal transition and balance/event writes commit together. Repeated callbacks are no-ops. */
export async function settleAiCredit(
  tx: CreditTransaction,
  ownerId: string,
  runId: string,
  consume: boolean,
  reason: string,
  now: Date,
) {
  const action = await tx.aiCreditAction.findFirst({
    where: { ownerId, runId, state: 'reserved' },
  });
  if (!action) return;
  const updated = await tx.aiCreditAction.updateMany({
    where: { ownerId, runId, state: 'reserved' },
    data: { state: consume ? 'consumed' : 'released', settledAt: now, settlementReason: reason },
  });
  if (updated.count !== 1) return;
  await tx.aiCreditPeriod.update({
    where: { id_ownerId: { id: action.periodId, ownerId } },
    data: { reserved: { decrement: 1 }, ...(consume ? { used: { increment: 1 } } : {}) },
  });
  await tx.aiCreditEvent.create({
    data: {
      ownerId,
      periodId: action.periodId,
      runId,
      kind: consume ? 'consume' : 'release',
      amount: 1,
      source: reason,
      createdAt: now,
    },
  });
}

/** Must run under the owner lock. A crashed request cannot strand an allowance. */
export async function reconcileOwnerAiCredits(tx: CreditTransaction, ownerId: string, now: Date) {
  const overdue = await tx.aiCreditAction.findMany({
    where: { ownerId, state: 'reserved', deadlineAt: { lte: now } },
  });
  for (const action of overdue) {
    const session = await tx.aiPlanningSession.findFirst({
      where: { ownerId, id: action.sessionId },
    });
    // Settlement is independent of telemetry, which may already have been pruned.
    await settleAiCredit(tx, ownerId, action.runId, false, 'timeout', now);
    await tx.aiGenerationRun.updateMany({
      where: { ownerId, id: action.runId, result: 'PENDING' },
      data: {
        completedAt: now,
        result: 'FAILED',
        errorCode: 'timeout',
        failureStage: session?.stage.toLowerCase() ?? null,
      },
    });
    if (session?.status === 'GENERATING') {
      await tx.aiPlanningSession.updateMany({
        where: { ownerId, id: action.sessionId, status: 'GENERATING' },
        data: {
          status: session.draft ? 'REVIEWING' : 'FAILED',
          stage: session.draft ? 'REVIEWING' : 'COMPLETE',
          lastErrorCode: 'timeout',
        },
      });
    }
  }
}

export async function getAiCreditSnapshot(
  ownerId: string,
  options: {
    prisma?: ReturnType<typeof getPrismaClient>;
    now?: Date;
  } = {},
) {
  return (options.prisma ?? getPrismaClient()).$transaction(async (tx) => {
    await lockAiCreditOwner(tx, ownerId);
    const now = options.now ?? new Date();
    await reconcileOwnerAiCredits(tx, ownerId, now);
    return creditSnapshot(await resolveAiCreditPeriod(tx, ownerId, now));
  });
}

export async function reserveAiCredit(
  tx: CreditTransaction,
  run: { id: string; ownerId: string; sessionId: string; idempotencyKey: string },
  deadlineAt: Date,
  now: Date,
  resolved: Awaited<ReturnType<typeof resolveAiCreditPeriod>>,
  environment?: Record<string, string | undefined>,
) {
  // The caller reconciles and resolves once within this same owner-locked transaction.
  if (resolved.account.ownerId !== run.ownerId)
    throw new EntitlementError('configuration_invalid', 503);
  const snapshot = creditSnapshot(resolved);
  if (snapshot.availableCredits <= 0)
    throw new EntitlementError('quota_exceeded', 429, resolved.period.endAt);
  const cutoff = new Date(now.getTime() - 60_000);
  const attempts = await tx.aiGenerationRun.count({
    where: { ownerId: run.ownerId, dispatchedAt: { gt: cutoff } },
  });
  if (attempts >= getAiPlannerBurstLimit(environment)) {
    const oldest = await tx.aiGenerationRun.findFirst({
      where: { ownerId: run.ownerId, dispatchedAt: { gt: cutoff } },
      orderBy: { dispatchedAt: 'asc' },
      select: { dispatchedAt: true },
    });
    throw new EntitlementError(
      'rate_limited',
      429,
      new Date((oldest?.dispatchedAt ?? now).getTime() + 60_000),
    );
  }
  await tx.aiCreditAction.create({
    data: {
      runId: run.id,
      ownerId: run.ownerId,
      sessionId: run.sessionId,
      idempotencyKey: run.idempotencyKey,
      periodId: resolved.period.id,
      maxItineraryDays: snapshot.maxItineraryDays,
      deadlineAt,
      reservedAt: now,
    },
  });
  await tx.aiCreditPeriod.update({
    where: { id_ownerId: { id: resolved.period.id, ownerId: run.ownerId } },
    data: { reserved: { increment: 1 } },
  });
  await tx.aiCreditEvent.create({
    data: {
      ownerId: run.ownerId,
      periodId: resolved.period.id,
      runId: run.id,
      kind: 'reserve',
      amount: 1,
      source: 'dispatch',
      createdAt: now,
    },
  });
  return snapshot.maxItineraryDays;
}

export async function reconcileOverdueAiCredits(
  options: { prisma?: ReturnType<typeof getPrismaClient>; now?: Date } = {},
) {
  const prisma = options.prisma ?? getPrismaClient();
  const now = options.now ?? new Date();
  const owners = await prisma.aiCreditAction.findMany({
    where: { state: 'reserved', deadlineAt: { lte: now } },
    select: { ownerId: true },
    distinct: ['ownerId'],
  });
  for (const { ownerId } of owners)
    await prisma.$transaction(async (tx) => {
      await lockAiCreditOwner(tx, ownerId);
      await reconcileOwnerAiCredits(tx, ownerId, now);
    });
  return owners.length;
}
