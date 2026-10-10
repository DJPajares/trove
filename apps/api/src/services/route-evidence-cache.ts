import { getPrismaClient, type Prisma } from '@trove/db';
import type { ProviderCacheMissReason } from './provider-usage.js';
import type { RouteCoordinates, RouteRequest, RouteResult, RoutableTravelMode } from './routes.js';

/**
 * The accepted application retention ceiling; reuse never resets original age.
 */
export const TRAVEL_LEG_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

/**
 * The stored columns are `DECIMAL(9, 6)`, so the key is rounded to the same
 * precision before it is written or looked up. Otherwise a coordinate that
 * differs only past the sixth decimal would write a second row that could never
 * be read back by the value that produced it. Six decimals is about 0.1 m.
 */
const COORDINATE_PRECISION = 1e6;

function round(value: number) {
  return Math.round(value * COORDINATE_PRECISION) / COORDINATE_PRECISION;
}

function databaseMode(mode: RoutableTravelMode) {
  const modes = { drive: 'DRIVE', transit: 'TRANSIT', walk: 'WALK' } as const;
  return modes[mode];
}

export function routeCacheKey(
  origin: RouteCoordinates,
  destination: RouteCoordinates,
  mode: RoutableTravelMode,
) {
  return {
    destinationLatitude: round(destination.latitude),
    destinationLongitude: round(destination.longitude),
    mode: databaseMode(mode),
    originLatitude: round(origin.latitude),
    originLongitude: round(origin.longitude),
  };
}

export async function readCachedRoute(
  request: RouteRequest,
  now = new Date(),
  client: Pick<Prisma.TransactionClient, 'travelLegCache'> = getPrismaClient(),
): Promise<
  { kind: 'hit'; result: RouteResult } | { kind: 'miss'; reason: ProviderCacheMissReason }
> {
  let leg;

  try {
    leg = await client.travelLegCache.findUnique({
      where: {
        travel_leg_cache_leg: routeCacheKey(request.origin, request.destination, request.mode),
      },
    });
  } catch {
    // A cache that cannot be read is a slow path, never a failed request.
    return { kind: 'miss', reason: 'cache_read_failed' };
  }

  if (!leg) return { kind: 'miss', reason: 'missing_leg' };
  // A miss stays unknown for readers. Normal route acquisition may refresh it.
  const maxAge = TRAVEL_LEG_CACHE_TTL_MS;
  const age = now.getTime() - leg.fetchedAt.getTime();
  if (age < 0 || age >= maxAge) {
    return { kind: 'miss', reason: 'stale_leg' };
  }

  // A leg first computed for a list view has no polyline. Serving it to the
  // map would silently drop the drawn route, so that case re-asks and the
  // richer answer replaces the thinner one.
  if (request.includePolyline && leg.encodedPolyline === null) {
    return { kind: 'miss', reason: 'polyline_missing' };
  }

  return {
    kind: 'hit',
    result: {
      estimate: {
        distanceMeters: leg.distanceMeters,
        durationSeconds: leg.durationSeconds,
        encodedPolyline: request.includePolyline ? leg.encodedPolyline : null,
      },
      freshness: { fetchedAt: leg.fetchedAt.toISOString(), source: 'cache' },
      provider: 'google',
      status: 'ok',
    },
  };
}
