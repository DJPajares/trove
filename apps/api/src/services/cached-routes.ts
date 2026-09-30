import { getPrismaClient } from '@trove/db';
import { readCachedRoute, routeCacheKey } from './route-evidence-cache.js';
import { singleFlight } from './single-flight.js';

import { recordProviderCacheEvent, type ProviderCallSource } from './provider-usage.js';
import {
  RoutesService,
  type RouteEstimate,
  type RouteRequest,
  type RouteResult,
  type RoutesProvider,
} from './routes.js';

/**
 * Trove asks for routes without a departure time, so an estimate does not depend
 * on when it was requested: the same leg answers identically until the road
 * network itself changes. Before this, opening a day's itinerary cost one Routes
 * call per leg, every time, forever.
 */
export class CachedRoutesService extends RoutesService {
  private readonly providerName: RoutesProvider['name'];
  private readonly now: () => Date;
  private readonly source: ProviderCallSource;

  constructor(
    provider: RoutesProvider,
    clock: () => Date = () => new Date(),
    source: ProviderCallSource = 'test',
  ) {
    super(provider, clock);
    this.providerName = provider.name;
    this.now = clock;
    this.source = source;
  }

  override async computeRoute(request: RouteRequest): Promise<RouteResult> {
    const cached = await readCachedRoute(request, this.now());
    if (cached.kind === 'hit') {
      recordProviderCacheEvent({
        cache: 'route',
        includePolyline: request.includePolyline ?? false,
        kind: 'cache_hit',
        operation: 'computeRoute',
        provider: 'google',
        routeMode: request.mode,
        source: this.source,
      });
      return cached.result;
    }

    // Whether the polyline is asked for does not change what Google bills - the
    // SKU follows the routing features used - so every purchase includes it. A
    // leg bought for a list is then already complete the day a map wants it,
    // rather than being bought a second time.
    const result = await singleFlight(
      `route:${JSON.stringify(routeCacheKey(request.origin, request.destination, request.mode))}:${request.languageCode ?? ''}`,
      async () => {
        const bought = await super.computeRoute({
          ...request,
          cacheMissReason: cached.reason,
          includePolyline: true,
        });
        if (bought.status === 'ok')
          await this.writeLeg(request, bought.estimate, new Date(bought.freshness.fetchedAt));
        return bought;
      },
    );

    // Callers get what they asked for: a list never receives the drawn line.
    return result.status === 'ok' && !request.includePolyline
      ? { ...result, estimate: { ...result.estimate, encodedPolyline: null } }
      : result;
  }

  private async writeLeg(request: RouteRequest, estimate: RouteEstimate, fetchedAt: Date) {
    const key = routeCacheKey(request.origin, request.destination, request.mode);
    const value = {
      distanceMeters: estimate.distanceMeters,
      durationSeconds: estimate.durationSeconds,
      encodedPolyline: estimate.encodedPolyline,
      fetchedAt,
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
