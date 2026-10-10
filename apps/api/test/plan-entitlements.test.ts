import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { creditModels } from './support/fake-ai-credits.js';
import { asPlanKey, creditPeriod, getPlanEntitlements } from '../src/services/plan-entitlements.js';
import {
  checkAiPlannerPromptDays,
  explicitAiTripDays,
} from '../src/services/ai-planner-preflight.js';
import {
  creditSnapshot,
  reconcileOwnerAiCredits,
  reserveAiCredit,
  resolveAiCreditPeriod,
  settleAiCredit,
} from '../src/services/ai-planner-credits.js';
import { performAdminEntitlementOperation } from '../src/services/admin-entitlements.js';
import { resolveUserEntitlements } from '../src/services/user-entitlements.js';

const ownerId = randomUUID();
const now = new Date('2026-01-31T12:34:56.000Z');
function store() {
  const credits = creditModels(now);
  const tx = {
    ...credits.models,
    $queryRaw: async () => [{ id: ownerId }],
    aiGenerationRun: { count: async () => 0, updateMany: async () => ({ count: 0 }) },
    aiPlanningSession: { findFirst: async () => null },
  };
  return {
    ...credits,
    tx: tx as never,
    prisma: { $transaction: async (callback: (tx: unknown) => unknown) => callback(tx) } as never,
  };
}
async function reserve(
  tx: Parameters<typeof reserveAiCredit>[0],
  run: Parameters<typeof reserveAiCredit>[1],
) {
  await reconcileOwnerAiCredits(tx, run.ownerId, now);
  const resolved = await resolveAiCreditPeriod(tx, run.ownerId, now);
  return reserveAiCredit(tx, run, new Date(now.getTime() + 90_000), now, resolved, {});
}

test('code-defined plans preserve product limits and ignore legacy environment overrides', () => {
  vi.stubEnv('TROVE_PAID_AI_PLANNER_CREDITS', '75');
  try {
    expect(getPlanEntitlements('free').aiPlanner).toEqual({
      credits: 10,
      maxItineraryDays: 10,
      renewal: 'lifetime',
    });
    expect(getPlanEntitlements('paid').aiPlanner).toEqual({
      credits: 50,
      maxItineraryDays: 20,
      renewal: 'monthly',
    });
    for (const key of ['unknown', 'toString', '__proto__'])
      expect(() => asPlanKey(key)).toThrow('configuration_invalid');
  } finally {
    vi.unstubAllEnvs();
  }
});

test('missing assignment defaults to active Free without a monthly anchor', async () => {
  const { tx } = store();
  const resolved = await resolveUserEntitlements(tx, ownerId, now);
  expect(resolved).toMatchObject({ assignedPlan: 'free', status: 'active', effectivePlan: 'free' });
  expect(resolved.account.monthlyAnchorAt).toBeNull();
  expect(resolved.entitlements).toEqual(getPlanEntitlements('free'));
});

test('active Paid initializes its stable monthly anchor once', async () => {
  const { tx, models } = store();
  await models.userEntitlement.create({ data: { ownerId, planKey: 'paid' } });
  const resolved = await resolveUserEntitlements(tx, ownerId, now);
  expect(resolved).toMatchObject({ assignedPlan: 'paid', status: 'active', effectivePlan: 'paid' });
  expect(resolved.account.monthlyAnchorAt).toEqual(now);
  expect(resolved.entitlements).toEqual(getPlanEntitlements('paid'));
  expect(
    (await resolveUserEntitlements(tx, ownerId, new Date('2026-03-01'))).account.monthlyAnchorAt,
  ).toEqual(now);
});

test.each([
  { planKey: 'unknown', subscriptionStatus: 'active' },
  { planKey: 'unknown', subscriptionStatus: 'inactive' },
  { planKey: 'paid', subscriptionStatus: 'unknown' },
])('invalid stored assignment fails closed: %j', async (data) => {
  const { tx, models } = store();
  await models.userEntitlement.create({ data: { ownerId, ...data } });
  await expect(resolveAiCreditPeriod(tx, ownerId, now)).rejects.toMatchObject({
    code: 'configuration_invalid',
  });
  expect(await models.aiCreditPeriod.count({ where: {} })).toBe(0);
});

test('zero snapshotted allowance is retained and creates no reservation', async () => {
  const { tx, models } = store();
  const period = (await resolveAiCreditPeriod(tx, ownerId, now)).period;
  await models.aiCreditPeriod.update({ where: { id: period.id }, data: { allowance: 0 } });
  const run = { id: randomUUID(), ownerId, sessionId: randomUUID(), idempotencyKey: randomUUID() };
  await expect(reserve(tx, run)).rejects.toMatchObject({ code: 'quota_exceeded', retryAt: null });
  expect(await models.aiCreditAction.count({ where: {} })).toBe(0);
  expect(creditSnapshot(await resolveAiCreditPeriod(tx, ownerId, now))).toMatchObject({
    allowance: 0,
    availableCredits: 0,
  });
});

test('Free exhaustion persists for the lifetime of the account', async () => {
  const { tx, models } = store();
  const period = (await resolveAiCreditPeriod(tx, ownerId, now)).period;
  await models.aiCreditPeriod.update({ where: { id: period.id }, data: { used: 10 } });
  const run = { id: randomUUID(), ownerId, sessionId: randomUUID(), idempotencyKey: randomUUID() };
  await expect(reserve(tx, run)).rejects.toMatchObject({ code: 'quota_exceeded', retryAt: null });
  const later = await resolveAiCreditPeriod(tx, ownerId, new Date('2027-03-01T00:00:00Z'));
  expect(later.period.id).toBe(period.id);
  expect(creditSnapshot(later)).toMatchObject({
    usedCredits: 10,
    availableCredits: 0,
    nextRenewalAt: null,
  });
  expect(await models.aiCreditAction.count({ where: {} })).toBe(0);
});

test('monthly anniversaries clamp February without drifting, skip missed months and renew at the exact boundary', () => {
  expect(creditPeriod(now, new Date('2026-02-28T12:34:55Z'), 'monthly')).toEqual({
    startAt: now,
    endAt: new Date('2026-02-28T12:34:56Z'),
  });
  expect(creditPeriod(now, new Date('2026-02-28T12:34:56Z'), 'monthly')).toEqual({
    startAt: new Date('2026-02-28T12:34:56Z'),
    endAt: new Date('2026-03-31T12:34:56Z'),
  });
  expect(creditPeriod(now, new Date('2026-08-15T00:00:00Z'), 'monthly')).toEqual({
    startAt: new Date('2026-07-31T12:34:56Z'),
    endAt: new Date('2026-08-31T12:34:56Z'),
  });
  expect(
    creditPeriod(new Date('2028-01-31T00:00:00Z'), new Date('2028-02-29T00:00:00Z'), 'monthly')
      .startAt,
  ).toEqual(new Date('2028-02-29T00:00:00Z'));
});
test.each([
  'Plan an 11-day trip in Japan',
  'Plan a 14-day trip to Japan with food or museums',
  'Plan a 14-day trip to Japan with the last night free',
  'Plan a 14-day trip to Japan. Do not add museums.',
  'Plan a trip to Tokyo for eleven days',
  'Spend two weeks in Japan',
  'Plan from 2026-10-01 to 2026-10-11',
])('rejects explicit excessive prompts before dispatch: %s', (prompt) => {
  expect(() => checkAiPlannerPromptDays(prompt, 10)).toThrow('itinerary_day_limit_exceeded');
});
test.each([
  'I spent two weeks in Japan last year. Plan a weekend.',
  'Plan 7 or 14 days in Japan',
  'Not a 14-day trip; plan 3 days.',
  'Plan a 5-day trip then a 14-day holiday',
])('leaves ambiguous context to normalized validation: %s', (prompt) => {
  expect(explicitAiTripDays(prompt)).toBeNull();
});
test('reservation, refund and consumption are atomic state transitions and repeated settlement is harmless', async () => {
  const { tx } = store();
  const run = { id: randomUUID(), ownerId, sessionId: randomUUID(), idempotencyKey: randomUUID() };
  await reserve(tx, run);
  expect(creditSnapshot(await resolveAiCreditPeriod(tx, ownerId, now))).toMatchObject({
    reservedCredits: 1,
    usedCredits: 0,
    availableCredits: 9,
  });
  await settleAiCredit(tx, ownerId, run.id, false, 'provider_failure', now);
  await settleAiCredit(tx, ownerId, run.id, true, 'late_success', now);
  expect(creditSnapshot(await resolveAiCreditPeriod(tx, ownerId, now))).toMatchObject({
    reservedCredits: 0,
    usedCredits: 0,
    availableCredits: 10,
  });
  const next = { ...run, id: randomUUID(), idempotencyKey: randomUUID() };
  await reserve(tx, next);
  await settleAiCredit(tx, ownerId, next.id, true, 'user_cancelled', now);
  await settleAiCredit(tx, ownerId, next.id, true, 'duplicate', now);
  expect(creditSnapshot(await resolveAiCreditPeriod(tx, ownerId, now))).toMatchObject({
    usedCredits: 1,
    reservedCredits: 0,
    availableCredits: 9,
  });
});
test('timeout reconciliation refunds orphaned reservations even after telemetry is deleted', async () => {
  const { tx, models } = store();
  const run = { id: randomUUID(), ownerId, sessionId: randomUUID(), idempotencyKey: randomUUID() };
  await reserve(tx, run);
  await reconcileOwnerAiCredits(tx, ownerId, new Date(now.getTime() + 90_000));
  await reconcileOwnerAiCredits(tx, ownerId, new Date(now.getTime() + 91_000));
  expect((await models.aiCreditAction.findUnique({ where: { runId: run.id } })).state).toBe(
    'released',
  );
  expect(await models.aiCreditEvent.count({ where: { kind: 'release' } })).toBe(1);
  expect(creditSnapshot(await resolveAiCreditPeriod(tx, ownerId, now)).availableCredits).toBe(10);
});
test('Paid renewal grants only the current monthly allowance and old settlement cannot change it', async () => {
  const { tx, models } = store();
  await models.userEntitlement.create({ data: { ownerId, planKey: 'paid', monthlyAnchorAt: now } });
  const run = { id: randomUUID(), ownerId, sessionId: randomUUID(), idempotencyKey: randomUUID() };
  await reserve(tx, run);
  const later = new Date('2026-08-31T12:34:56Z');
  const renewal = await resolveAiCreditPeriod(tx, ownerId, later);
  expect(creditSnapshot(renewal)).toMatchObject({
    allowance: 50,
    availableCredits: 50,
    usedCredits: 0,
  });
  await settleAiCredit(tx, ownerId, run.id, true, 'succeeded', later);
  expect(creditSnapshot(await resolveAiCreditPeriod(tx, ownerId, later)).availableCredits).toBe(50);
  expect(await models.aiCreditPeriod.count({ where: { ownerId } })).toBe(2);
});
test('admin resets preserve anniversary and history, replay once and reject reuse for different targets', async () => {
  const { tx, prisma, models } = store();
  await models.userEntitlement.create({ data: { ownerId, planKey: 'paid', monthlyAnchorAt: now } });
  const period = (await resolveAiCreditPeriod(tx, ownerId, now)).period;
  await models.aiCreditPeriod.update({ where: { id: period.id }, data: { used: 12 } });
  const input = {
    ownerId,
    operation: 'reset' as const,
    reason: 'Support test',
    idempotencyKey: randomUUID(),
    requestId: 'request-1',
    principal: { actorId: 'support:test', credentialId: 'support-key' },
  };
  const result = await performAdminEntitlementOperation(input, { prisma, now });
  expect(result.entitlements).toMatchObject({
    availableCredits: 50,
    usedCredits: 0,
    nextRenewalAt: '2026-02-28T12:34:56.000Z',
  });
  expect((await models.aiCreditPeriod.findUnique({ where: { id: period.id } })).used).toBe(12);
  expect(await performAdminEntitlementOperation(input, { prisma, now })).toEqual(result);
  expect(await models.adminOperationAudit.count({ where: {} })).toBe(1);
  await expect(
    performAdminEntitlementOperation({ ...input, ownerId: randomUUID() }, { prisma, now }),
  ).rejects.toMatchObject({ code: 'admin_idempotency_conflict' });
});
test('plan assignment retains Free usage and a no-op assignment does not replenish credits', async () => {
  const { tx, prisma, models } = store();
  const free = (await resolveAiCreditPeriod(tx, ownerId, now)).period;
  await models.aiCreditPeriod.update({ where: { id: free.id }, data: { used: 4 } });
  const input = {
    ownerId,
    operation: 'assign_plan' as const,
    planKey: 'paid' as const,
    reason: 'Test plan',
    idempotencyKey: randomUUID(),
    requestId: 'test',
    principal: { actorId: 'support:test', credentialId: 'key' },
  };
  expect(
    (await performAdminEntitlementOperation(input, { prisma, now })).entitlements.availableCredits,
  ).toBe(50);
  expect(
    (
      await performAdminEntitlementOperation(
        { ...input, idempotencyKey: randomUUID() },
        { prisma, now },
      )
    ).changed,
  ).toBe(false);
  expect(
    (
      await performAdminEntitlementOperation(
        { ...input, idempotencyKey: randomUUID(), planKey: 'free' },
        { prisma, now },
      )
    ).entitlements.availableCredits,
  ).toBe(6);
});

test('inactive Paid uses the existing Free balance and reactivation retains Paid usage and anchor', async () => {
  const { tx, prisma, models } = store();
  const free = (await resolveAiCreditPeriod(tx, ownerId, now)).period;
  await models.aiCreditPeriod.update({ where: { id: free.id }, data: { used: 4 } });
  await models.userEntitlement.update({
    where: { ownerId },
    data: { planKey: 'paid', monthlyAnchorAt: now },
  });
  const paid = (await resolveAiCreditPeriod(tx, ownerId, now)).period;
  await models.aiCreditPeriod.update({ where: { id: paid.id }, data: { used: 12 } });
  await models.userEntitlement.update({
    where: { ownerId },
    data: { subscriptionStatus: 'inactive' },
  });
  const fallback = await resolveAiCreditPeriod(tx, ownerId, now);
  expect(fallback).toMatchObject({
    assignedPlan: 'paid',
    status: 'inactive',
    effectivePlan: 'free',
  });
  expect(fallback.period.id).toBe(free.id);
  expect(fallback.account.monthlyAnchorAt).toEqual(now);
  expect(creditSnapshot(fallback)).toMatchObject({
    tier: 'free',
    usedCredits: 4,
    availableCredits: 6,
    maxItineraryDays: 10,
    renewalPolicy: 'lifetime',
  });
  expect(() =>
    checkAiPlannerPromptDays('Plan a 14-day trip', fallback.limits.maxItineraryDays),
  ).toThrow('itinerary_day_limit_exceeded');
  const input = {
    ownerId,
    operation: 'assign_plan' as const,
    planKey: 'paid' as const,
    reason: 'Reactivate subscription',
    idempotencyKey: randomUUID(),
    requestId: 'reactivate',
    principal: { actorId: 'support:test', credentialId: 'key' },
  };
  const result = await performAdminEntitlementOperation(input, { prisma, now });
  expect(result.changed).toBe(true);
  expect(result.entitlements).toMatchObject({
    tier: 'paid',
    usedCredits: 12,
    availableCredits: 38,
    maxItineraryDays: 20,
    periodStart: now.toISOString(),
  });
  expect((await models.userEntitlement.findUnique({ where: { ownerId } })).subscriptionStatus).toBe(
    'active',
  );
  expect((await resolveAiCreditPeriod(tx, ownerId, now)).period.id).toBe(paid.id);
  const audit = await models.adminOperationAudit.findUnique({ where: { id: result.auditId } });
  expect(audit.before).toMatchObject({
    assignedPlan: 'paid',
    subscriptionStatus: 'inactive',
    tier: 'free',
  });
  expect(await performAdminEntitlementOperation(input, { prisma, now })).toEqual(result);
  expect(Object.keys(result).sort()).toEqual(['auditId', 'changed', 'entitlements']);
});

test('resetting inactive Paid replenishes only the effective Free period', async () => {
  const { tx, prisma, models } = store();
  const free = (await resolveAiCreditPeriod(tx, ownerId, now)).period;
  await models.aiCreditPeriod.update({ where: { id: free.id }, data: { used: 4 } });
  await models.userEntitlement.update({
    where: { ownerId },
    data: { planKey: 'paid', monthlyAnchorAt: now },
  });
  const paid = (await resolveAiCreditPeriod(tx, ownerId, now)).period;
  await models.aiCreditPeriod.update({ where: { id: paid.id }, data: { used: 12 } });
  await models.userEntitlement.update({
    where: { ownerId },
    data: { subscriptionStatus: 'inactive' },
  });
  const result = await performAdminEntitlementOperation(
    {
      ownerId,
      operation: 'reset',
      reason: 'Reset effective allowance',
      idempotencyKey: randomUUID(),
      requestId: 'reset-fallback',
      principal: { actorId: 'support:test', credentialId: 'key' },
    },
    { prisma, now },
  );
  expect(result.entitlements).toMatchObject({
    tier: 'free',
    allowance: 10,
    usedCredits: 0,
    availableCredits: 10,
  });
  expect((await models.aiCreditPeriod.findUnique({ where: { id: paid.id } })).used).toBe(12);
  expect((await models.aiCreditPeriod.findUnique({ where: { id: free.id } })).used).toBe(4);
  expect(await models.userEntitlement.findUnique({ where: { ownerId } })).toMatchObject({
    planKey: 'paid',
    subscriptionStatus: 'inactive',
    monthlyAnchorAt: now,
  });
});

test('assigning Free reactivates an inactive Free assignment without replenishing credits', async () => {
  const { tx, prisma, models } = store();
  const period = (await resolveAiCreditPeriod(tx, ownerId, now)).period;
  await models.aiCreditPeriod.update({ where: { id: period.id }, data: { used: 4 } });
  await models.userEntitlement.update({
    where: { ownerId },
    data: { subscriptionStatus: 'inactive' },
  });
  const result = await performAdminEntitlementOperation(
    {
      ownerId,
      operation: 'assign_plan',
      planKey: 'free',
      reason: 'Reactivate Free',
      idempotencyKey: randomUUID(),
      requestId: 'reactivate-free',
      principal: { actorId: 'support:test', credentialId: 'key' },
    },
    { prisma, now },
  );
  expect(result).toMatchObject({ changed: true, entitlements: { availableCredits: 6 } });
  expect((await models.userEntitlement.findUnique({ where: { ownerId } })).subscriptionStatus).toBe(
    'active',
  );
});

test('existing monthly allocations retain their granted allowance until renewal', async () => {
  const { tx, models } = store();
  await models.userEntitlement.create({ data: { ownerId, planKey: 'paid', monthlyAnchorAt: now } });
  const period = (await resolveAiCreditPeriod(tx, ownerId, now)).period;
  await models.aiCreditPeriod.update({
    where: { id: period.id },
    data: { allowance: 75, used: 12 },
  });
  expect(creditSnapshot(await resolveAiCreditPeriod(tx, ownerId, now))).toMatchObject({
    allowance: 75,
    usedCredits: 12,
    availableCredits: 63,
  });
  expect(
    creditSnapshot(await resolveAiCreditPeriod(tx, ownerId, new Date('2026-02-28T12:34:56Z'))),
  ).toMatchObject({ allowance: 50, usedCredits: 0, availableCredits: 50 });
});
