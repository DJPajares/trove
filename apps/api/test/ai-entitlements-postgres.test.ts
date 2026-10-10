import { randomUUID } from 'node:crypto';
import { createPrismaClient, Prisma } from '@trove/db';
import { expect, test } from 'vitest';
import {
  lockAiCreditOwner,
  reserveAiCredit,
  settleAiCredit,
  resolveAiCreditPeriod,
  creditSnapshot,
} from '../src/services/ai-planner-credits.js';
import { performAdminEntitlementOperation } from '../src/services/admin-entitlements.js';

// Opt-in isolated PostgreSQL test. Never use the application's configured production database.
const testUrl = process.env.TROVE_ENTITLEMENTS_TEST_DATABASE_URL;
test.skipIf(!testUrl)(
  'PostgreSQL serializes credit races, keeps durable idempotency and preserves audit/reset history',
  async () => {
    const url = new URL(testUrl!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || !/entitlements/.test(url.pathname))
      throw new Error('Expected an isolated local entitlements test database');
    process.env.DATABASE_URL = testUrl;
    const clients = [createPrismaClient(), createPrismaClient()];
    const ownerId = randomUUID();
    const now = new Date();
    const environment = { TROVE_FREE_AI_PLANNER_CREDITS: '1' };
    const runs = Array.from({ length: 2 }, () => ({
      id: randomUUID(),
      ownerId,
      sessionId: randomUUID(),
      idempotencyKey: randomUUID(),
    }));
    try {
      await clients[0]!.$executeRaw(
        Prisma.sql`INSERT INTO auth.users (id) VALUES (${ownerId}::uuid)`,
      );
      const results = await Promise.allSettled(
        runs.map((run, i) =>
          clients[i]!.$transaction(async (tx) => {
            await lockAiCreditOwner(tx, ownerId);
            return reserveAiCredit(tx, run, new Date(now.getTime() + 90_000), now, environment);
          }),
        ),
      );
      expect(
        results.filter((r) => r.status === 'fulfilled'),
        results
          .filter((r) => r.status === 'rejected')
          .map((r) => String(r.reason))
          .join('\n'),
      ).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: { code: 'quota_exceeded' },
      });
      const action = await clients[0]!.aiCreditAction.findFirstOrThrow({ where: { ownerId } });
      await expect(
        performAdminEntitlementOperation(
          {
            ownerId,
            operation: 'reset',
            reason: 'Active run test',
            idempotencyKey: randomUUID(),
            requestId: 'active-test',
            principal: { actorId: 'test:active', credentialId: 'key' },
          },
          { prisma: clients[0], now, environment },
        ),
      ).rejects.toMatchObject({ code: 'ai_generation_active' });
      expect(await clients[0]!.adminOperationAudit.count({ where: { ownerId } })).toBe(0);
      await expect(
        performAdminEntitlementOperation(
          {
            ownerId: randomUUID(),
            operation: 'reset',
            reason: 'Missing user test',
            idempotencyKey: randomUUID(),
            requestId: 'missing-test',
            principal: { actorId: 'test:missing', credentialId: 'key' },
          },
          { prisma: clients[0], now, environment },
        ),
      ).rejects.toMatchObject({ code: 'user_not_found' });
      await Promise.all(
        clients.map((client) =>
          client.$transaction(async (tx) => {
            await lockAiCreditOwner(tx, ownerId);
            await settleAiCredit(tx, ownerId, action.runId, true, 'succeeded', now);
          }),
        ),
      );
      expect(await clients[0]!.aiCreditEvent.count({ where: { ownerId, kind: 'consume' } })).toBe(
        1,
      );
      const snapshot = await clients[0]!.$transaction(async (tx) =>
        creditSnapshot(await resolveAiCreditPeriod(tx, ownerId, now, environment)),
      );
      expect(snapshot).toMatchObject({ usedCredits: 1, reservedCredits: 0, availableCredits: 0 });
      // The action survives absent generation/session telemetry by design.
      expect(await clients[0]!.aiGenerationRun.count({ where: { ownerId } })).toBe(0);
      await expect(
        clients[0]!.aiCreditPeriod.updateMany({ where: { ownerId }, data: { reserved: 1 } }),
      ).rejects.toThrow();
      const input = {
        ownerId,
        operation: 'reset' as const,
        reason: 'Concurrency validation',
        idempotencyKey: randomUUID(),
        requestId: 'postgres-test',
        principal: { actorId: `test:${ownerId}`, credentialId: 'test-credential' },
      };
      const resets = await Promise.all(
        clients.map((prisma) =>
          performAdminEntitlementOperation(input, { prisma, now, environment }),
        ),
      );
      expect(resets[0]).toEqual(resets[1]);
      expect(resets[0]!.entitlements.availableCredits).toBe(1);
      expect(await clients[0]!.aiCreditPeriod.count({ where: { ownerId } })).toBe(2);
      expect(await clients[0]!.adminOperationAudit.count({ where: { ownerId } })).toBe(1);
      await expect(
        performAdminEntitlementOperation(
          { ...input, reason: 'Different request' },
          { prisma: clients[0], now, environment },
        ),
      ).rejects.toMatchObject({ code: 'admin_idempotency_conflict' });
      const rls = await clients[0]!.$queryRaw<Array<{ relname: string; relrowsecurity: boolean }>>(
        Prisma.sql`SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = 'trove'::regnamespace AND relname IN ('user_entitlements','ai_credit_periods','ai_credit_actions','ai_credit_events','admin_operation_audits')`,
      );
      expect(rls).toHaveLength(5);
      expect(rls.every((table) => table.relrowsecurity)).toBe(true);
    } finally {
      await clients[0]!.$executeRaw(Prisma.sql`DELETE FROM auth.users WHERE id = ${ownerId}::uuid`);
      await Promise.all(clients.map((client) => client.$disconnect()));
    }
  },
);
