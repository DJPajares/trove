import { mapWithConcurrency, PROVIDER_CONCURRENCY_LIMIT } from './concurrency.js';
import type { TrovePlaceCategory } from './places.js';

export const EDITORIAL_IMAGE_PROVIDERS = ['pexels'] as const;
export type EditorialImageProviderName = (typeof EDITORIAL_IMAGE_PROVIDERS)[number];

/**
 * What Trove asks a photograph for. A trip asks by destination name; a place
 * asks by name and category, because "Central" is a park, a station or a market
 * depending on which one the traveller means.
 */
export type EditorialImageSubject = {
  category?: TrovePlaceCategory;
  name: string;
};

/**
 * Attribution is part of the image, not an optional companion to it. Every
 * provider Trove can use requires crediting the photographer and linking back,
 * so a type that lets a caller hold a URL without the means to credit it would
 * make the product's obligation depend on each surface remembering.
 */
export type EditorialImageAttribution = {
  photographerName: string;
  photographerUrl: string;
  providerName: EditorialImageProviderName;
  providerPageUrl: string;
};

/**
 * A reference to a photograph, never the photograph. `sourceUrl` is the
 * provider's unsized hotlink; surfaces derive the width they need at render
 * time. `dominantColor` is what a surface paints while one loads.
 */
export type EditorialImageReference = {
  altText: string | null;
  attribution: EditorialImageAttribution;
  dominantColor: string | null;
  externalPhotoId: string;
  height: number | null;
  sourceUrl: string;
  width: number | null;
};

export type EditorialImageProviderErrorCode =
  | 'configuration_missing'
  | 'invalid_request'
  | 'provider_unavailable'
  | 'quota_exceeded'
  | 'rate_limited';

export class EditorialImageProviderError extends Error {
  constructor(
    public readonly code: EditorialImageProviderErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'EditorialImageProviderError';
  }
}

export interface EditorialImageProvider {
  readonly name: EditorialImageProviderName;
  /** Resolves an ordered collection of up to three representative photographs. */
  search(subject: EditorialImageSubject): Promise<EditorialImageReference[]>;
}

export type EditorialImageResult =
  | {
      images: EditorialImageReference[];
      status: 'ok';
      subjectKey: string;
    }
  | {
      status: 'empty';
      subjectKey: string;
    }
  | {
      code: EditorialImageProviderErrorCode;
      status: 'unavailable';
      subjectKey: string;
    };

/**
 * One subject to resolve, plus the rows that should remember the answer.
 *
 * Pinning is what keeps a Trips list free: once a trip points at its editorial
 * cover, rendering that list reads the cover through the trip query it already
 * makes, and never asks this service anything again.
 */
export type EditorialImageResolveRequest = {
  placeId?: string;
  subject: EditorialImageSubject;
  tripId?: string;
};

/** The authenticated user, so a pin can only ever touch rows they may write. */
export type EditorialImageResolveContext = {
  ownerId: string;
};

/** One subject, with every row across the batch that asked for it. */
export type UniqueEditorialImageRequest = {
  placeIds: string[];
  subject: EditorialImageSubject;
  subjectKey: string;
  tripIds: string[];
};

/** The slice of the Fastify logger this service needs, so tests can pass a stub. */
export type EditorialImagesLogger = {
  warn: (details: Record<string, unknown>, message: string) => void;
};

/**
 * The resolution key, and the whole of what makes a photograph deterministic.
 *
 * Casing, surrounding space and accents are how the same destination arrives
 * spelled three ways, so they are normalised away before the key is formed.
 * The category is part of the key rather than a filter applied afterwards, so
 * a restaurant and a district sharing a name never collapse into one answer.
 */
export function editorialSubjectKey(subject: EditorialImageSubject) {
  const name = subject.name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

  return `${subject.category ?? 'destination'}:${name}`;
}

function getEditorialImageProviderError(error: unknown): EditorialImageProviderError {
  return error instanceof EditorialImageProviderError
    ? error
    : new EditorialImageProviderError('provider_unavailable', { cause: error });
}

/**
 * Resolves subjects to photographs, at most one provider call per subject.
 *
 * This base class always asks the provider; `CachedEditorialImagesService`
 * decides whether a subject needs asking at all. Both answer with the same
 * per-subject union, so a provider outage degrades to a branded fallback on the
 * surface rather than failing the request that asked for it.
 */
export class EditorialImagesService {
  constructor(
    protected readonly provider: EditorialImageProvider,
    protected readonly clock: () => Date = () => new Date(),
    protected readonly logger?: EditorialImagesLogger,
  ) {}

  /**
   * Collapsing the batch onto its subject keys is the whole budget guarantee: a
   * Trips list of ten trips to Tokyo is one subject, so it costs one call rather
   * than ten, and the second render costs none.
   */
  async resolveMany(
    requests: EditorialImageResolveRequest[],
    context: EditorialImageResolveContext,
  ): Promise<EditorialImageResult[]> {
    const unique = new Map<string, UniqueEditorialImageRequest>();

    for (const request of requests) {
      const subjectKey = editorialSubjectKey(request.subject);
      const entry = unique.get(subjectKey) ?? {
        placeIds: [],
        subject: request.subject,
        subjectKey,
        tripIds: [],
      };

      if (request.placeId && !entry.placeIds.includes(request.placeId)) {
        entry.placeIds.push(request.placeId);
      }
      if (request.tripId && !entry.tripIds.includes(request.tripId)) {
        entry.tripIds.push(request.tripId);
      }

      unique.set(subjectKey, entry);
    }

    const resolved = await this.resolveUnique([...unique.values()], context);
    const bySubjectKey = new Map(resolved.map((result) => [result.subjectKey, result]));

    return requests.map((request) => {
      const subjectKey = editorialSubjectKey(request.subject);

      return bySubjectKey.get(subjectKey) ?? { status: 'empty', subjectKey };
    });
  }

  /** Resolves subjects already known to be distinct. Overridden by the cache. */
  protected async resolveUnique(
    requests: UniqueEditorialImageRequest[],
    _context: EditorialImageResolveContext,
  ): Promise<EditorialImageResult[]> {
    return mapWithConcurrency(requests, PROVIDER_CONCURRENCY_LIMIT, (request) =>
      this.resolveOne(request.subject),
    );
  }

  protected async resolveOne(subject: EditorialImageSubject): Promise<EditorialImageResult> {
    const subjectKey = editorialSubjectKey(subject);

    try {
      const images = await this.provider.search(subject);

      return images.length > 0
        ? { images, status: 'ok', subjectKey }
        : { status: 'empty', subjectKey };
    } catch (error) {
      const providerError = getEditorialImageProviderError(error);

      this.logger?.warn(
        {
          causeName: providerError.cause instanceof Error ? providerError.cause.name : undefined,
          code: providerError.code,
          provider: this.provider.name,
          subjectKey,
        },
        'editorial image provider request failed',
      );

      return { code: providerError.code, status: 'unavailable', subjectKey };
    }
  }
}
