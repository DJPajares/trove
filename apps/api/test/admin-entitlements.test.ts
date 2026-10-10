import { createHash, randomBytes, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { afterEach, expect, test, vi } from 'vitest';
import { authenticateAdmin } from '../src/services/admin-auth.js';
import { registerAdminEntitlementRoutes } from '../src/routes/admin-entitlements.js';

const token = `support-1.${randomBytes(32).toString('base64url')}`;
const credential = {
  id: 'support-1',
  actorId: 'support:alice',
  sha256: createHash('sha256').update(token).digest('hex'),
  expiresAt: '2099-01-01T00:00:00Z',
  scopes: ['ai_planner:reset'],
};
const env = { TROVE_ADMIN_CREDENTIALS: JSON.stringify([credential]) };
afterEach(() => {
  delete process.env.TROVE_ADMIN_CREDENTIALS;
});

test('admin authorization requires dedicated unexpired hashed keys with the operation scope', () => {
  expect(authenticateAdmin(`Bearer ${token}`, 'ai_planner:reset', env)).toEqual({
    status: 200,
    principal: { actorId: 'support:alice', credentialId: 'support-1' },
  });
  expect(authenticateAdmin(`Bearer ${token}`, 'entitlements:write', env)).toMatchObject({
    status: 403,
  });
  for (const authorization of [
    undefined,
    'Bearer user.jwt.signature',
    'Bearer scheduler-secret',
    `Bearer ${token}x`,
    `Bearer support-1.${'a'.repeat(43)}`,
  ])
    expect(authenticateAdmin(authorization, 'ai_planner:reset', env)).toMatchObject({
      status: 401,
    });
  expect(
    authenticateAdmin(`Bearer ${token}`, 'ai_planner:reset', env, new Date(credential.expiresAt)),
  ).toMatchObject({ status: 401 });
  expect(authenticateAdmin(`Bearer ${token}`, 'ai_planner:reset', {})).toMatchObject({
    status: 503,
  });
  expect(
    authenticateAdmin(`Bearer ${token}`, 'ai_planner:reset', { TROVE_ADMIN_CREDENTIALS: '[]' }),
  ).toMatchObject({ status: 503 });
});
test('protected routes require a single UUID target, strict body and an idempotency key before executing', async () => {
  process.env.TROVE_ADMIN_CREDENTIALS = env.TROVE_ADMIN_CREDENTIALS;
  const operate = vi.fn(async () => ({
    auditId: randomUUID(),
    changed: true,
    entitlements: {} as never,
  }));
  const app = Fastify();
  registerAdminEntitlementRoutes(app, operate);
  const headers = { authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() };
  const url = `/admin/users/${randomUUID()}/ai-planner/reset`;
  expect((await app.inject({ method: 'POST', url, payload: { reason: 'Test' } })).statusCode).toBe(
    401,
  );
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/admin/users/all/ai-planner/reset',
        headers,
        payload: { reason: 'Test' },
      })
    ).statusCode,
  ).toBe(400);
  for (const payload of [
    {},
    { reason: ' ' },
    { reason: 'Test', resetEveryone: true },
    { reason: 'a'.repeat(501) },
  ])
    expect((await app.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(400);
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: { authorization: headers.authorization },
        payload: { reason: 'Test' },
      })
    ).statusCode,
  ).toBe(400);
  expect(operate).not.toHaveBeenCalled();
  expect(
    (await app.inject({ method: 'POST', url, headers, payload: { reason: 'Support request' } }))
      .statusCode,
  ).toBe(200);
  expect(operate).toHaveBeenCalledWith(
    expect.objectContaining({
      principal: { actorId: 'support:alice', credentialId: 'support-1' },
      reason: 'Support request',
    }),
  );
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: `/admin/users/${randomUUID()}/plan`,
        headers,
        payload: { planKey: 'paid', reason: 'Support request' },
      })
    ).statusCode,
  ).toBe(403);
  await app.close();
});
