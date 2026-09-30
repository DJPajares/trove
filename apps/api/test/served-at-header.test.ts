import { expect, test } from 'vitest';

import { buildApp, SERVED_AT_HEADER } from '../src/app.js';

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
