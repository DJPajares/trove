import type { Prisma } from '@trove/db';
import { asPlanKey, EntitlementError, getPlanEntitlements } from './plan-entitlements.js';

export type SubscriptionStatus = 'active' | 'inactive';

function subscriptionStatus(value: string): SubscriptionStatus {
  if (value !== 'active' && value !== 'inactive')
    throw new EntitlementError('configuration_invalid', 503);
  return value;
}

/** Resolve under the owner's transaction lock; never cache mutable assignments across requests. */
export async function resolveUserEntitlements(
  tx: Prisma.TransactionClient,
  ownerId: string,
  now: Date,
) {
  let account = await tx.userEntitlement.upsert({
    where: { ownerId },
    create: { ownerId, createdAt: now },
    update: {},
  });
  const assignedPlan = asPlanKey(account.planKey);
  const status = subscriptionStatus(account.subscriptionStatus);
  const effectivePlan = status === 'active' ? assignedPlan : 'free';
  // This async service is the boundary for a future database-managed plan catalog.
  const entitlements = getPlanEntitlements(effectivePlan);
  if (entitlements.aiPlanner.renewal === 'monthly' && !account.monthlyAnchorAt) {
    account = await tx.userEntitlement.update({
      where: { ownerId },
      data: { monthlyAnchorAt: now },
    });
  }
  return { account, assignedPlan, status, effectivePlan, entitlements };
}
