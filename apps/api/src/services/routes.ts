export const ROUTE_TRAVEL_MODES = ['drive', 'flight', 'transit', 'walk'] as const;
export type RouteTravelMode = (typeof ROUTE_TRAVEL_MODES)[number];

/**
 * Modes the routing provider can actually estimate. Flight is deliberately absent:
 * Trove does not plan flights, so a flight leg is recorded as a long-distance hop
 * with no estimate rather than being routed. Keeping it out of `RouteRequest`
 * makes sending one to the provider a type error rather than a runtime surprise.
 */
export const ROUTABLE_TRAVEL_MODES = ['drive', 'transit', 'walk'] as const;
export type RoutableTravelMode = (typeof ROUTABLE_TRAVEL_MODES)[number];

export function isRoutableTravelMode(mode: RouteTravelMode): mode is RoutableTravelMode {
  return mode !== 'flight';
}

export type RouteCoordinates = {
  latitude: number;
  longitude: number;
};

export type RouteRequest = {
  destination: RouteCoordinates;
  includePolyline?: boolean;
  languageCode?: string;
  mode: RoutableTravelMode;
  origin: RouteCoordinates;
};

export type RouteEstimate = {
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline: string | null;
};

export type RouteProviderErrorCode =
  | 'configuration_missing'
  | 'invalid_request'
  | 'provider_unavailable'
  | 'quota_exceeded'
  | 'rate_limited';

export class RouteProviderError extends Error {
  constructor(
    public readonly code: RouteProviderErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'RouteProviderError';
  }
}

export interface RoutesProvider {
  readonly name: 'google';
  computeRoute(request: RouteRequest): Promise<RouteEstimate | null>;
}

export type RouteResult =
  | {
      estimate: RouteEstimate;
      freshness: { fetchedAt: string; source: 'live' };
      provider: 'google';
      status: 'ok';
    }
  | { provider: 'google'; status: 'empty' }
  | { code: RouteProviderErrorCode; provider: 'google'; status: 'unavailable' };

export class RoutesService {
  constructor(
    private readonly provider: RoutesProvider,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async computeRoute(request: RouteRequest): Promise<RouteResult> {
    try {
      const estimate = await this.provider.computeRoute(request);

      return estimate
        ? {
            estimate,
            freshness: { fetchedAt: this.clock().toISOString(), source: 'live' },
            provider: this.provider.name,
            status: 'ok',
          }
        : { provider: this.provider.name, status: 'empty' };
    } catch (error) {
      const providerError =
        error instanceof RouteProviderError
          ? error
          : new RouteProviderError('provider_unavailable', { cause: error });

      return {
        code: providerError.code,
        provider: this.provider.name,
        status: 'unavailable',
      };
    }
  }
}
