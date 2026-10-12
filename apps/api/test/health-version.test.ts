import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import { buildApp } from '../src/app.js';

test('the public health check reports the deployed API version', async () => {
  const { version } = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  const app = buildApp();
  try {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.json()).toEqual({ status: 'ok', version });
  } finally {
    await app.close();
  }
});
