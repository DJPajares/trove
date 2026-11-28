import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { afterEach, expect, test } from 'vitest';

import { PROVIDER_SEARCH_RATE_LIMIT } from '../src/routes/rate-limits.js';
import { registerCurrencyRoutes } from '../src/routes/currency.js';
import { DEFAULT_RATE_LIMIT, rateLimitPluginOptions } from '../src/services/rate-limiting.js';

const apps: Array<{ close: () => Promise<unknown> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

/** Stands in for `requireAuthenticatedUser`: a verified user, or a 401. */
async function fakeAuth(request: FastifyRequest, reply: FastifyReply) {
  const user = request.headers['x-test-user'];
  if (typeof user !== 'string') return reply.code(401).send({ code: 'unauthorized' });
  request.authUserId = user;
}

async function buildLimitedApp(env: Record<string, string | undefined>) {
  const app = Fastify();
  apps.push(app);
  app.decorateRequest('authUserId', undefined);
  await app.register(async (instance) => {
    await instance.register(rateLimit, rateLimitPluginOptions(app.log, env));
    instance.get(
      '/costly',
      { config: { rateLimit: { max: 2, timeWindow: '1 minute' } }, preHandler: fakeAuth },
      async () => ({ ok: true }),
    );
    instance.get(
      '/public',
      { config: { rateLimit: { max: 2, timeWindow: '1 minute' } } },
      async () => ({
        ok: true,
      }),
    );
    instance.get('/plain', async () => ({ ok: true }));
  });
  return app;
}

async function statuses(
  app: Awaited<ReturnType<typeof buildLimitedApp>>,
  url: string,
  headers: Record<string, string>,
  count: number,
) {
  const result: number[] = [];
  for (let index = 0; index < count; index += 1) {
    result.push((await app.inject({ headers, url })).statusCode);
  }
  return result;
}

test('signed-in callers sharing one address are counted separately', async () => {
  const app = await buildLimitedApp({});

  expect(await statuses(app, '/costly', { 'x-test-user': 'ana' }, 3)).toStrictEqual([
    200, 200, 429,
  ]);
  // Same address as Ana (every inject comes from 127.0.0.1), but a different person.
  expect(await statuses(app, '/costly', { 'x-test-user': 'ben' }, 2)).toStrictEqual([200, 200]);
});

test('a signed-in caller keeps their count when their address changes', async () => {
  const app = await buildLimitedApp({ VERCEL: '1' });

  await statuses(app, '/costly', { 'x-real-ip': '203.0.113.1', 'x-test-user': 'ana' }, 2);
  expect(
    (
      await app.inject({
        headers: { 'x-real-ip': '198.51.100.7', 'x-test-user': 'ana' },
        url: '/costly',
      })
    ).statusCode,
  ).toBe(429);
});

test('a rejected sign-in is refused before it is counted', async () => {
  const app = await buildLimitedApp({});

  expect(await statuses(app, '/costly', {}, 3)).toStrictEqual([401, 401, 401]);
  expect(await statuses(app, '/costly', { 'x-test-user': 'ana' }, 2)).toStrictEqual([200, 200]);
});

test('on Vercel anonymous callers are counted by the client address Vercel reports', async () => {
  const app = await buildLimitedApp({ VERCEL: '1' });

  expect(await statuses(app, '/public', { 'x-real-ip': '203.0.113.1' }, 3)).toStrictEqual([
    200, 200, 429,
  ]);
  expect(await statuses(app, '/public', { 'x-real-ip': '198.51.100.7' }, 2)).toStrictEqual([
    200, 200,
  ]);
});

test('off Vercel a client-supplied address header is ignored', async () => {
  const app = await buildLimitedApp({});

  await statuses(app, '/public', { 'x-real-ip': '203.0.113.1' }, 2);
  expect(
    (await app.inject({ headers: { 'x-real-ip': '198.51.100.7' }, url: '/public' })).statusCode,
  ).toBe(429);
});

test('a route without its own limit gets the default one', async () => {
  const app = await buildLimitedApp({});

  const response = await app.inject({ url: '/plain' });
  expect(response.statusCode).toBe(200);
  expect(response.headers['x-ratelimit-limit']).toBe(String(DEFAULT_RATE_LIMIT.max));
});

test('the currency routes carry their provider limit rather than the default', async () => {
  const app = Fastify();
  apps.push(app);
  const configs: unknown[] = [];
  app.addHook('onRoute', (route) => {
    if (route.method === 'GET' && route.url.startsWith('/currency/')) configs.push(route.config);
  });
  registerCurrencyRoutes(app);
  await app.ready();

  // The plugin only reads `config.rateLimit`; a limit spread into the route's
  // options is silently ignored and leaves the route on the default.
  expect(configs).toHaveLength(3);
  for (const config of configs) {
    expect(config).toMatchObject({ rateLimit: PROVIDER_SEARCH_RATE_LIMIT.rateLimit });
  }
});
