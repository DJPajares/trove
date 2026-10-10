import { expect, test, vi } from 'vitest';

import { buildApp, SERVED_AT_HEADER } from '../src/app.js';

test('the deployed CORS allowlist accepts Trove origins and rejects unrelated hosts', async () => {
  vi.stubEnv(
    'WEB_ORIGINS',
    'https://trove.wndrhive.com,https://trove-git-*-djpajares-projects.vercel.app',
  );
  const app = buildApp();
  try {
    for (const origin of [
      'https://trove.wndrhive.com',
      'https://trove-git-env-prefix-cleanup-djpajares-projects.vercel.app',
    ]) {
      const response = await app.inject({ method: 'GET', url: '/health', headers: { origin } });
      expect(response.headers['access-control-allow-origin']).toBe(origin);
    }
    for (const origin of [
      'https://unrelated.vercel.app',
      'https://trove-git-test-djpajares-projects.vercel.app.attacker.test',
      'http://trove.wndrhive.com',
      'http://localhost:3000',
    ]) {
      const response = await app.inject({ method: 'GET', url: '/health', headers: { origin } });
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    }
  } finally {
    await app.close();
    vi.unstubAllEnvs();
  }
});

test('every response says when the server sent it, readable cross-origin', async () => {
  const app = buildApp();
  const before = Date.now();
  const response = await app.inject({
    method: 'GET',
    url: '/health',
    headers: { origin: 'http://localhost:3000' },
  });
  const servedAt = Date.parse(String(response.headers[SERVED_AT_HEADER]));
  expect(servedAt).toBeGreaterThanOrEqual(before);
  expect(servedAt).toBeLessThanOrEqual(Date.now());
  // Browsers only let the web app read it when CORS exposes it.
  expect(String(response.headers['access-control-expose-headers'])).toContain(SERVED_AT_HEADER);
  await app.close();
});
