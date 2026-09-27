import Fastify from 'fastify';
import { afterEach, expect, test, vi } from 'vitest';

import { registerMaintenanceRoutes } from '../src/routes/maintenance.js';
import { cleanupAiPlanningRetention } from '../src/services/ai-planning-retention.js';
import { dispatchNotifications } from '../src/services/web-push.js';

const SECRET = 'a-long-scheduler-secret-value';

vi.mock('../src/services/ai-planning-retention.js', () => ({
  cleanupAiPlanningRetention: vi.fn(async () => ({
    deletedGenerationRuns: 3,
    expiredSessions: 2,
    scrubbedTerminalSessions: 1,
    overdueSessionsAtStart: 2,
    oldestOverdueAgeSeconds: 60,
    remainingOverdueSessions: 0,
  })),
}));

vi.mock('../src/services/trip-media-cleanup.js', () => ({
  createStorageCleanupClient: vi.fn(() => (process.env.SUPABASE_SECRET_KEY ? {} : null)),
  processTripMediaCleanup: vi.fn(async () => ({
    attempted: 2,
    removed: 1,
    pending: 1,
    oldestPendingAgeSeconds: 3600,
  })),
}));

vi.mock('../src/services/web-push.js', () => ({
  getPushEnvironment: vi.fn(() => (process.env.TROVE_VAPID_PRIVATE_KEY ? {} : null)),
  dispatchNotifications: vi.fn(async () => ({
    accepted: 1,
    attempted: 1,
    deadSubscriptions: 0,
    dueSources: 1,
    rateLimited: 0,
    skipped: 0,
    pending: 0,
    oldestPendingAgeSeconds: null,
  })),
}));

afterEach(() => {
  vi.mocked(cleanupAiPlanningRetention).mockReset();
  vi.mocked(cleanupAiPlanningRetention).mockResolvedValue({
    deletedGenerationRuns: 3,
    expiredSessions: 2,
    scrubbedTerminalSessions: 1,
    overdueSessionsAtStart: 2,
    oldestOverdueAgeSeconds: 60,
    remainingOverdueSessions: 0,
  });
  delete process.env.CRON_SECRET;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.TROVE_NOTIFICATION_DISPATCH_SECRET;
  delete process.env.TROVE_VAPID_PRIVATE_KEY;
});

async function inject(
  headers: Record<string, string> = {},
  path = '/maintenance/ai-planning-retention',
  method: 'GET' | 'POST' = 'GET',
) {
  const app = Fastify();
  registerMaintenanceRoutes(app);
  const response = await app.inject({
    headers,
    method,
    url: path,
  });
  await app.close();
  return response;
}

test('retention cleanup runs only for the scheduler and stays closed without a secret', async () => {
  // A deployment that forgot the secret must not expose maintenance to anyone.
  const unconfigured = await inject({ authorization: `Bearer ${SECRET}` });
  expect(unconfigured.statusCode).toBe(503);
  expect(unconfigured.json()).toStrictEqual({ code: 'configuration_missing' });

  process.env.CRON_SECRET = SECRET;

  const rejectedHeaders: Record<string, string>[] = [
    {},
    { authorization: 'Bearer ' },
    { authorization: `Bearer ${SECRET}x` },
    { authorization: `Bearer ${SECRET.toUpperCase()}` },
    { authorization: SECRET },
  ];

  for (const headers of rejectedHeaders) {
    const rejected = await inject(headers);
    expect(rejected.statusCode, JSON.stringify(headers)).toBe(401);
    expect(rejected.json()).toStrictEqual({ code: 'unauthorized' });
  }

  const accepted = await inject({ authorization: `Bearer ${SECRET}` });
  expect(accepted.statusCode).toBe(200);

  // Counts and age only; nothing that describes what was removed.
  expect(accepted.json()).toStrictEqual({
    deletedGenerationRuns: 3,
    expiredSessions: 2,
    scrubbedTerminalSessions: 1,
    overdueSessionsAtStart: 2,
    oldestOverdueAgeSeconds: 60,
    remainingOverdueSessions: 0,
  });
});

test('push dispatch requires its own secret and configured VAPID credentials', async () => {
  const path = '/maintenance/notification-dispatch';
  const headers = { authorization: `Bearer ${SECRET}` };
  expect((await inject(headers, path, 'POST')).statusCode).toBe(503);
  process.env.CRON_SECRET = SECRET;
  process.env.TROVE_NOTIFICATION_DISPATCH_SECRET = 'different-dispatch-secret';
  process.env.TROVE_VAPID_PRIVATE_KEY = 'configured';
  expect((await inject(headers, path, 'POST')).statusCode).toBe(401);
  const accepted = await inject(
    { authorization: 'Bearer different-dispatch-secret' },
    path,
    'POST',
  );
  expect(accepted.statusCode).toBe(200);
  expect(accepted.json()).toMatchObject({ accepted: 1, pending: 0 });
  expect(dispatchNotifications).toHaveBeenCalledTimes(1);
});

test('retention failures and remaining overdue content fail visibly without exposing content', async () => {
  process.env.CRON_SECRET = SECRET;
  vi.mocked(cleanupAiPlanningRetention).mockRejectedValueOnce(new Error('private prompt'));
  const failed = await inject({ authorization: `Bearer ${SECRET}` });
  expect(failed.statusCode).toBe(503);
  expect(failed.json()).toStrictEqual({ code: 'retention_failed' });
  expect(failed.body).not.toContain('private prompt');

  vi.mocked(cleanupAiPlanningRetention).mockResolvedValueOnce({
    deletedGenerationRuns: 0,
    expiredSessions: 0,
    scrubbedTerminalSessions: 0,
    overdueSessionsAtStart: 1,
    oldestOverdueAgeSeconds: 3600,
    remainingOverdueSessions: 1,
  });
  const incomplete = await inject({ authorization: `Bearer ${SECRET}` });
  expect(incomplete.statusCode).toBe(503);
  expect(incomplete.json().remainingOverdueSessions).toBe(1);
});

test('media cleanup requires scheduler auth and a server-only Storage key', async () => {
  const path = '/maintenance/trip-media-cleanup';
  expect((await inject({ authorization: `Bearer ${SECRET}` }, path)).statusCode).toBe(503);
  process.env.CRON_SECRET = SECRET;
  expect((await inject({}, path)).statusCode).toBe(401);
  expect((await inject({ authorization: `Bearer ${SECRET}` }, path)).json()).toStrictEqual({
    code: 'storage_cleanup_configuration_missing',
  });
  process.env.SUPABASE_SECRET_KEY = 'test-only-secret';
  const accepted = await inject({ authorization: `Bearer ${SECRET}` }, path);
  expect(accepted.statusCode).toBe(200);
  expect(accepted.json()).toStrictEqual({
    attempted: 2,
    removed: 1,
    pending: 1,
    oldestPendingAgeSeconds: 3600,
  });
});
