import {
  canSpendEditorialImageCall,
  noteEditorialImageRateLimitHeaders,
  recordEditorialImageCall,
} from './editorial-image-budget.js';
import type {
  EditorialImageProvider,
  EditorialImageReference,
  EditorialImageSubject,
} from './editorial-images.js';
import { EditorialImageProviderError } from './editorial-images.js';
import type { TrovePlaceCategory } from './places.js';
import type { ProviderCallSource } from './provider-usage.js';
import { recordProviderCall } from './provider-usage.js';

const DEFAULT_BASE_URL = 'https://api.pexels.com';
const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * One result, landscape, large. Asking for exactly one photograph is both the
 * cheapest request and the reason resolution is repeatable: there is no ranking
 * inside the answer for Trove to choose differently between two renders.
 */
export const PEXELS_SEARCH_PARAMETERS = {
  orientation: 'landscape',
  per_page: '1',
  size: 'large',
} as const;

/**
 * A name alone is ambiguous - "Central" is a park, a station and a market - so
 * the category the traveller already told Trove about is added to the query.
 * These terms are part of the resolution key's meaning and changing one changes
 * which photograph a subject resolves to.
 */
const CATEGORY_QUERY_TERMS: Record<TrovePlaceCategory, string> = {
  destination: 'travel',
  food_and_drink: 'restaurant',
  other: '',
  shopping: 'shopping',
  stay: 'hotel',
  things_to_do: 'landmark',
  transport: 'station',
};

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

type PexelsPhotoSource = {
  large?: string;
  large2x?: string;
  medium?: string;
  original?: string;
  small?: string;
  tiny?: string;
};

type PexelsPhoto = {
  alt?: string;
  avg_color?: string;
  height?: number;
  id?: number;
  photographer?: string;
  photographer_url?: string;
  src?: PexelsPhotoSource;
  url?: string;
  width?: number;
};

type PexelsSearchResponse = {
  error?: string;
  photos?: PexelsPhoto[];
};

export type PexelsEditorialImageProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  clock?: () => Date;
  fetcher?: Fetcher;
  hourlyBudget: number;
  requestTimeoutMs?: number;
  source?: ProviderCallSource;
};

export function mapPexelsError(responseStatus: number, body: PexelsSearchResponse) {
  if (responseStatus === 429) {
    return new EditorialImageProviderError('rate_limited');
  }

  if (responseStatus === 401 || responseStatus === 403) {
    return new EditorialImageProviderError('configuration_missing');
  }

  if (responseStatus === 400) {
    return new EditorialImageProviderError('invalid_request');
  }

  return new EditorialImageProviderError('provider_unavailable', {
    cause: body.error ? new Error(body.error) : undefined,
  });
}

export function buildPexelsQuery(subject: EditorialImageSubject) {
  const categoryTerm = CATEGORY_QUERY_TERMS[subject.category ?? 'destination'];
  const name = subject.name.trim().replace(/\s+/g, ' ');

  return categoryTerm ? `${name} ${categoryTerm}` : name;
}

function cleanString(value: string | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
}

/**
 * Attribution is mandatory, so a photograph Trove cannot credit is treated as no
 * photograph at all rather than rendered uncredited.
 */
function mapPexelsPhoto(photo: PexelsPhoto): EditorialImageReference | null {
  const externalPhotoId = photo.id === undefined ? null : String(photo.id);
  const photographerName = cleanString(photo.photographer);
  const photographerUrl = cleanString(photo.photographer_url);
  const providerPageUrl = cleanString(photo.url);
  const original = cleanString(photo.src?.original);
  const small = cleanString(photo.src?.medium) ?? original;
  const medium = cleanString(photo.src?.large) ?? original;
  const large = cleanString(photo.src?.large2x) ?? medium;

  if (
    !externalPhotoId ||
    !photographerName ||
    !photographerUrl ||
    !providerPageUrl ||
    !small ||
    !medium ||
    !large
  ) {
    return null;
  }

  return {
    altText: cleanString(photo.alt),
    attribution: {
      photographerName,
      photographerUrl,
      providerName: 'pexels',
      providerPageUrl,
    },
    dominantColor: cleanString(photo.avg_color),
    externalPhotoId,
    height: photo.height ?? null,
    sources: { large, medium, small },
    width: photo.width ?? null,
  };
}

export class PexelsEditorialImageProvider implements EditorialImageProvider {
  readonly name = 'pexels' as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly clock: () => Date;
  private readonly fetcher: Fetcher;
  private readonly hourlyBudget: number;
  private readonly requestTimeoutMs: number;
  private readonly source: ProviderCallSource;

  constructor(options: PexelsEditorialImageProviderOptions) {
    this.apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.clock = options.clock ?? (() => new Date());
    this.fetcher = options.fetcher ?? globalThis.fetch;
    this.hourlyBudget = options.hourlyBudget;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.source = options.source ?? 'test';
  }

  async search(subject: EditorialImageSubject) {
    const url = new URL('/v1/search', this.baseUrl);
    url.searchParams.set('query', buildPexelsQuery(subject));

    for (const [key, value] of Object.entries(PEXELS_SEARCH_PARAMETERS)) {
      url.searchParams.set(key, value);
    }

    const body = await this.requestJson<PexelsSearchResponse>(url);
    const [photo] = body.photos ?? [];

    return photo ? mapPexelsPhoto(photo) : null;
  }

  /**
   * The guards run in the order that keeps a request from leaving the process:
   * no key, then no budget, then the usage record - which is written here rather
   * than in the caller so it counts requests that are actually about to be made.
   */
  private async requestJson<T>(url: URL): Promise<T> {
    if (!this.apiKey) {
      throw new EditorialImageProviderError('configuration_missing');
    }

    const now = this.clock().getTime();

    if (!canSpendEditorialImageCall({ hourlyBudget: this.hourlyBudget, now })) {
      throw new EditorialImageProviderError('rate_limited');
    }

    recordEditorialImageCall(now);
    recordProviderCall({
      endpoint: '/v1/search',
      expectedSku: 'editorial-images-free',
      operation: 'search',
      provider: 'pexels',
      source: this.source,
    });

    let response: Response;

    try {
      response = await this.fetcher(url, {
        headers: { Accept: 'application/json', Authorization: this.apiKey },
        method: 'GET',
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      throw new EditorialImageProviderError('provider_unavailable', { cause: error });
    }

    noteEditorialImageRateLimitHeaders({
      now: this.clock().getTime(),
      remaining: response.headers.get('x-ratelimit-remaining'),
      resetAt: response.headers.get('x-ratelimit-reset'),
      throttled: response.status === 429,
    });

    const body = (await response.json().catch(() => ({}))) as T & PexelsSearchResponse;

    if (!response.ok) {
      throw mapPexelsError(response.status, body);
    }

    return body;
  }
}
