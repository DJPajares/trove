import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { expect, test } from 'vitest';

const run = promisify(execFile);

test('the real API entrypoint initializes in a fresh native ESM process', async () => {
  // Vitest transforms imports and can mask ESM initialization-order failures.
  // Load the same entrypoint as tsx dev and Vercel, without test mocks or a DB.
  const { stdout } = await run(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      `
        import assert from 'node:assert/strict';
        const { default: app } = await import('./src/server.ts');
        try {
          const health = await app.inject({ method: 'GET', url: '/health' });
          assert.equal(health.statusCode, 200);
          assert.equal(health.json().status, 'ok');
          assert.match(health.json().version, /^\\d+\\.\\d+\\.\\d+$/);
          for (const request of [
            { method: 'GET', url: '/trips' },
            { method: 'GET', url: '/trips/00000000-0000-4000-8000-000000000001/itinerary' },
            { method: 'POST', url: '/trips/00000000-0000-4000-8000-000000000001/itinerary/movements/preview', payload: {} },
          ]) {
            const response = await app.inject(request);
            assert.equal(response.statusCode, 401);
          }
          console.log('API startup verified');
        } finally {
          await app.close();
        }
      `,
    ],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, VERCEL: '1' },
      timeout: 15_000,
    },
  );
  expect(stdout).toContain('API startup verified');
}, 20_000);
