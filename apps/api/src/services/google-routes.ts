import {
  RouteProviderError,
  type RouteEstimate,
  type RouteRequest,
  type RoutesProvider,
} from './routes.js';

const DEFAULT_BASE_URL = 'https://routes.googleapis.com';
const DEFAULT_TIMEOUT_MS = 8_000;

export const GOOGLE_ROUTE_FIELD_MASK = 'routes.duration,routes.distanceMeters';
export const GOOGLE_ROUTE_POLYLINE_FIELD_MASK =
  'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline';

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

type GoogleRoutesResponse = {
  routes?: Array<{
    distanceMeters?: number;
    duration?: string;
    polyline?: { encodedPolyline?: string };
  }>;
};

type GoogleErrorResponse = {
  error?: { status?: string };
};

type GoogleRoutesProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  fetcher?: Fetcher;
  requestTimeoutMs?: number;
};

function mapGoogleError(responseStatus: number, body: GoogleErrorResponse) {
  const providerStatus = body.error?.status;

  if (providerStatus === 'RESOURCE_EXHAUSTED') {
    return new RouteProviderError('quota_exceeded');
  }
  if (responseStatus === 429) {
    return new RouteProviderError('rate_limited');
  }
  if (
    responseStatus === 401 ||
    providerStatus === 'PERMISSION_DENIED' ||
    providerStatus === 'UNAUTHENTICATED'
  ) {
    return new RouteProviderError('configuration_missing');
  }
  if (responseStatus === 403) {
    return new RouteProviderError('quota_exceeded');
  }
  if (responseStatus === 400 || providerStatus === 'INVALID_ARGUMENT') {
    return new RouteProviderError('invalid_request');
  }
  return new RouteProviderError('provider_unavailable');
}

function parseDuration(value: string | undefined) {
  const match = value?.match(/^(\d+(?:\.\d+)?)s$/);
  return match ? Math.round(Number(match[1])) : null;
}

function mapRoute(response: GoogleRoutesResponse): RouteEstimate | null {
  const route = response.routes?.[0];
  const durationSeconds = parseDuration(route?.duration);

  if (!route || durationSeconds === null || !Number.isFinite(route.distanceMeters)) {
    return null;
  }

  return {
    distanceMeters: Math.max(0, Math.round(route.distanceMeters ?? 0)),
    durationSeconds: Math.max(0, durationSeconds),
    encodedPolyline: route.polyline?.encodedPolyline?.trim() || null,
  };
}

export class GoogleRoutesProvider implements RoutesProvider {
  readonly name = 'google' as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly requestTimeoutMs: number;

  constructor(options: GoogleRoutesProviderOptions) {
    this.apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.fetcher = options.fetcher ?? globalThis.fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async computeRoute(request: RouteRequest): Promise<RouteEstimate | null> {
    if (!this.apiKey) throw new RouteProviderError('configuration_missing');

    let response: Response;

    try {
      response = await this.fetcher(`${this.baseUrl}/directions/v2:computeRoutes`, {
        body: JSON.stringify({
          destination: { location: { latLng: request.destination } },
          languageCode: request.languageCode,
          origin: { location: { latLng: request.origin } },
          travelMode: request.mode.toUpperCase(),
        }),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': request.includePolyline
            ? GOOGLE_ROUTE_POLYLINE_FIELD_MASK
            : GOOGLE_ROUTE_FIELD_MASK,
        },
        method: 'POST',
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      throw new RouteProviderError('provider_unavailable', { cause: error });
    }

    const body = (await response.json().catch(() => ({}))) as GoogleRoutesResponse &
      GoogleErrorResponse;
    if (!response.ok) throw mapGoogleError(response.status, body);
    return mapRoute(body);
  }
}
