import Fastify from 'fastify';
import { afterEach, expect, test, vi } from 'vitest';

import { registerMaintenanceRoutes } from '../src/routes/maintenance.js';

const SECRET = 'a-long-scheduler-secret-value';

vi.mock('../src/services/ai-planning-retention.js', () => ({
  cleanupAiPlanningRetention: vi.fn(async () => ({
    deletedGenerationRuns: 3,
    expiredSessions: 2,
    scrubbedTerminalSessions: 1,
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

afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.SUPABASE_SECRET_KEY;
});

async function inject(
  headers: Record<string, string> = {},
  path = '/maintenance/ai-planning-retention',
) {
  const app = Fastify();
  registerMaintenanceRoutes(app);
  const response = await app.inject({
    headers,
    method: 'GET',
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

  // Three counts, and nothing that describes what was removed.
  expect(accepted.json()).toStrictEqual({
    deletedGenerationRuns: 3,
    expiredSessions: 2,
    scrubbedTerminalSessions: 1,
  });
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
