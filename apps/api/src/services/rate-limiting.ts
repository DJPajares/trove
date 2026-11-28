import { normalizeIP, type RateLimitPluginOptions } from '@fastify/rate-limit';
import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import { Redis } from 'ioredis';

type Environment = Record<string, string | undefined>;

/**
 * Every route without its own limit shares this one per caller. It sits far
 * above what a person clicking through the app produces, so it only ever stops
 * a loop or a script.
 */
export const DEFAULT_RATE_LIMIT = { max: 300, timeWindow: '1 minute' } as const;

/**
 * The address of the person making the request, not of the proxy in front of us.
 *
 * On Vercel the socket belongs to Vercel's own proxy, so `request.ip` is the same
 * for everyone. Vercel sets `x-real-ip` itself and overwrites any value a client
 * sends, which is why the header is trusted there and nowhere else: anywhere
 * else a caller could write whatever address it liked into it.
 */
export function clientAddress(request: FastifyRequest, env: Environment = process.env) {
  if (env.VERCEL) {
    const header = request.headers['x-real-ip'];
    const value = (Array.isArray(header) ? header[0] : header)?.trim();
    if (value) return value;
  }
  return request.ip;
}

/**
 * A signed-in caller is counted as themselves wherever they connect from; anyone
 * else is counted by address. The limiter runs after authentication (see
 * `hook` below), so `authUserId` is a verified user, never a claim from the
 * request.
 */
export function rateLimitKey(request: FastifyRequest, env: Environment = process.env) {
  if (request.authUserId) return `user:${request.authUserId}`;
  return `ip:${normalizeIP(clientAddress(request, env))}`;
}

let sharedRedis: Redis | null = null;

/**
 * One connection per warm instance, reused across invocations. The timeouts are
 * short on purpose: a limiter that waits on a slow Redis slows every request.
 */
function rateLimitRedis(url: string, log: FastifyBaseLogger) {
  if (!sharedRedis) {
    sharedRedis = new Redis(url, { connectTimeout: 500, maxRetriesPerRequest: 1 });
    sharedRedis.on('error', (error: Error) => {
      log.warn(
        { kind: 'rate_limit_store_error', message: error.message },
        'rate limit store error',
      );
    });
  }
  return sharedRedis;
}

/**
 * An explicit `RATE_LIMIT_REDIS_URL` wins. Otherwise the connection string that
 * Vercel's Upstash integration adds to a connected project is used as is, so
 * installing the integration is enough: nothing has to be copied by hand.
 */
export function rateLimitRedisUrl(env: Environment = process.env) {
  for (const key of ['RATE_LIMIT_REDIS_URL', 'KV_URL', 'REDIS_URL']) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return null;
}

/**
 * Counters live in Redis when a Redis URL is configured, so every instance
 * sees the same count. Without it they live in each instance's memory, which is
 * right for local development and only a per-instance backstop in production.
 *
 * A store failure lets the request through (`skipOnError`): these limits are a
 * guard against runaway clients, and an outage of the guard must not become an
 * outage of the app.
 */
export function rateLimitPluginOptions(
  log: FastifyBaseLogger,
  env: Environment = process.env,
): RateLimitPluginOptions {
  const redisUrl = rateLimitRedisUrl(env);
  if (!redisUrl && env.VERCEL_ENV === 'production') {
    log.warn(
      { kind: 'rate_limit_store_local' },
      'no Redis URL is set; rate limits are counted per instance',
    );
  }

  return {
    ...DEFAULT_RATE_LIMIT,
    global: true,
    // After the route's own preHandler, so a signed-in caller is already known.
    hook: 'preHandler',
    keyGenerator: (request) => rateLimitKey(request, env),
    skipOnError: true,
    ...(redisUrl
      ? {
          nameSpace: `trove-rate-limit:${env.VERCEL_ENV ?? 'local'}:`,
          redis: rateLimitRedis(redisUrl, log),
        }
      : {}),
  };
}
