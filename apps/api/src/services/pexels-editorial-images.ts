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
import {
  buildEditorialSearchQuery,
  editorialMatchScore,
  supportedEditorialLocale,
} from './editorial-image-matching.js';
import type { ProviderCallSource } from './provider-usage.js';
import { recordProviderCall } from './provider-usage.js';

const DEFAULT_BASE_URL = 'https://api.pexels.com';
const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * An exact request asks for enough landscape candidates to verify the venue;
 * a generic request asks for only three. At most three verified references are
 * retained, with provider order breaking score ties for stable cached media.
 */
export const PEXELS_SEARCH_PARAMETERS = {
  orientation: 'landscape',
  size: 'large',
} as const;

const EXACT_CANDIDATE_COUNT = '15';
const GENERIC_CANDIDATE_COUNT = '3';

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
  beforeRequest?: () => Promise<void>;
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
  return buildEditorialSearchQuery(subject);
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
  const sourceUrl = cleanString(photo.src?.original);

  if (!externalPhotoId || !photographerName || !photographerUrl || !providerPageUrl || !sourceUrl) {
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
    sourceUrl,
    width: photo.width ?? null,
  };
}

export class PexelsEditorialImageProvider implements EditorialImageProvider {
  readonly name = 'pexels' as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly beforeRequest: (() => Promise<void>) | undefined;
  private readonly clock: () => Date;
  private readonly fetcher: Fetcher;
  private readonly hourlyBudget: number;
  private readonly requestTimeoutMs: number;
  private readonly source: ProviderCallSource;

  constructor(options: PexelsEditorialImageProviderOptions) {
    this.apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.beforeRequest = options.beforeRequest;
    this.clock = options.clock ?? (() => new Date());
    this.fetcher = options.fetcher ?? globalThis.fetch;
    this.hourlyBudget = options.hourlyBudget;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.source = options.source ?? 'test';
  }

  async search(subject: EditorialImageSubject) {
    const url = new URL('/v1/search', this.baseUrl);
    url.searchParams.set('query', buildPexelsQuery(subject));
    url.searchParams.set(
      'per_page',
      subject.kind === 'generic' ? GENERIC_CANDIDATE_COUNT : EXACT_CANDIDATE_COUNT,
    );

    const locale = supportedEditorialLocale(subject.languageCode);
    if (locale) url.searchParams.set('locale', locale);

    for (const [key, value] of Object.entries(PEXELS_SEARCH_PARAMETERS)) {
      url.searchParams.set(key, value);
    }

    const body = await this.requestJson<PexelsSearchResponse>(url);
    const seenIds = new Set<string>();
    const seenUrls = new Set<string>();

    return (body.photos ?? [])
      .flatMap((photo, position) => {
        const reference = mapPexelsPhoto(photo);
        const score = reference
          ? editorialMatchScore(subject, {
              altText: reference.altText,
              providerPageUrl: reference.attribution.providerPageUrl,
            })
          : 0;
        if (
          !reference ||
          score === 0 ||
          seenIds.has(reference.externalPhotoId) ||
          seenUrls.has(reference.sourceUrl)
        ) {
          return [];
        }
        seenIds.add(reference.externalPhotoId);
        seenUrls.add(reference.sourceUrl);
        return [{ position, reference, score }];
      })
      .toSorted((left, right) => right.score - left.score || left.position - right.position)
      .map(({ reference }) => reference)
      .slice(0, 3);
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

    if (
      !canSpendEditorialImageCall({ hourlyBudget: this.hourlyBudget, now: this.clock().getTime() })
    ) {
      throw new EditorialImageProviderError('rate_limited');
    }

    if (this.beforeRequest) await this.beforeRequest();

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
