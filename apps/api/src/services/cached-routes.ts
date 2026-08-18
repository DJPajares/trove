import { getPrismaClient } from '@trove/db';

import {
  RoutesService,
  type RoutableTravelMode,
  type RouteCoordinates,
  type RouteEstimate,
  type RouteRequest,
  type RouteResult,
  type RoutesProvider,
} from './routes.js';

/**
 * Matches the place snapshot ceiling, which is what Google's terms allow.
 */
const TRAVEL_LEG_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

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

function legKey(origin: RouteCoordinates, destination: RouteCoordinates, mode: RoutableTravelMode) {
  return {
    destinationLatitude: round(destination.latitude),
    destinationLongitude: round(destination.longitude),
    mode: databaseMode(mode),
    originLatitude: round(origin.latitude),
    originLongitude: round(origin.longitude),
  };
}

/**
 * Trove asks for routes without a departure time, so an estimate does not depend
 * on when it was requested: the same leg answers identically until the road
 * network itself changes. Before this, opening a day's itinerary cost one Routes
 * call per leg, every time, forever.
 */
export class CachedRoutesService extends RoutesService {
  private readonly providerName: RoutesProvider['name'];
  private readonly now: () => Date;

  constructor(provider: RoutesProvider, clock: () => Date = () => new Date()) {
    super(provider, clock);
    this.providerName = provider.name;
    this.now = clock;
  }

  override async computeRoute(request: RouteRequest): Promise<RouteResult> {
    const cached = await this.readLeg(request);
    if (cached) return cached;

    const result = await super.computeRoute(request);
    if (result.status === 'ok') await this.writeLeg(request, result.estimate);

    return result;
  }

  private async readLeg(request: RouteRequest): Promise<RouteResult | null> {
    let leg;

    try {
      leg = await getPrismaClient().travelLegCache.findUnique({
        where: { travel_leg_cache_leg: legKey(request.origin, request.destination, request.mode) },
      });
    } catch {
      // A cache that cannot be read is a slow path, never a failed request.
      return null;
    }

    if (!leg || this.now().getTime() - leg.fetchedAt.getTime() > TRAVEL_LEG_CACHE_TTL_MS) {
      return null;
    }

    // A leg first computed for a list view has no polyline. Serving it to the
    // map would silently drop the drawn route, so that case re-asks and the
    // richer answer replaces the thinner one.
    if (request.includePolyline && leg.encodedPolyline === null) return null;

    return {
      estimate: {
        distanceMeters: leg.distanceMeters,
        durationSeconds: leg.durationSeconds,
        encodedPolyline: request.includePolyline ? leg.encodedPolyline : null,
      },
      freshness: { fetchedAt: leg.fetchedAt.toISOString(), source: 'cache' },
      provider: this.providerName,
      status: 'ok',
    };
  }

  private async writeLeg(request: RouteRequest, estimate: RouteEstimate) {
    const key = legKey(request.origin, request.destination, request.mode);
    const value = {
      distanceMeters: estimate.distanceMeters,
      durationSeconds: estimate.durationSeconds,
      encodedPolyline: estimate.encodedPolyline,
      fetchedAt: this.now(),
    };

    try {
      await getPrismaClient().travelLegCache.upsert({
        create: { ...key, ...value },
        update: value,
        where: { travel_leg_cache_leg: key },
      });
    } catch {
      // Failing to cache must never fail the request that produced the data.
    }
  }
}
