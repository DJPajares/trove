import { getPrismaClient } from '@trove/db';

import {
  EditorialImagesService,
  type EditorialImageProvider,
  type EditorialImageReference,
  type EditorialImageResolveContext,
  type EditorialImageResult,
  type UniqueEditorialImageRequest,
} from './editorial-images.js';
import {
  recordProviderCacheEvent,
  type ProviderCacheMissReason,
  type ProviderCallSource,
} from './provider-usage.js';

/**
 * How long a resolved photograph stands before Trove looks again.
 *
 * Longer than the 30-day place snapshot on purpose. That rule exists because a
 * name, an address or a set of types can change under Trove's feet in a way a
 * traveller would act on. A representative photograph of Kyoto cannot go wrong
 * in that sense - it can only become a less good choice - so the window is set
 * by how often the provider's library is worth revisiting, and long enough that
 * steady-state traffic is effectively zero.
 */
export const EDITORIAL_IMAGE_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1_000;

/**
 * A subject the provider has nothing for is remembered too, or every render of
 * an obscure custom place would re-ask. Shorter than a hit, because the library
 * gaining a photograph is the outcome worth noticing.
 */
export const EDITORIAL_IMAGE_MISS_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

const NO_RESULTS = 'NO_RESULTS';

type CachedEditorialImageRow = {
  altText: string | null;
  cachedAt: Date | null;
  dominantColor: string | null;
  externalPhotoId: string | null;
  height: number | null;
  id: string;
  largeUrl: string | null;
  mediumUrl: string | null;
  missedAt: Date | null;
  photographerName: string | null;
  photographerUrl: string | null;
  providerPageUrl: string | null;
  smallUrl: string | null;
  subjectKey: string;
  width: number | null;
};

/**
 * A row only counts as a photograph when it carries everything needed to render
 * *and* credit one. A half-written row degrades to a fallback rather than to an
 * uncredited image.
 */
function toReference(row: CachedEditorialImageRow): EditorialImageReference | null {
  if (
    !row.externalPhotoId ||
    !row.photographerName ||
    !row.photographerUrl ||
    !row.providerPageUrl ||
    !row.smallUrl ||
    !row.mediumUrl ||
    !row.largeUrl
  ) {
    return null;
  }

  return {
    altText: row.altText,
    attribution: {
      photographerName: row.photographerName,
      photographerUrl: row.photographerUrl,
      providerName: 'pexels',
      providerPageUrl: row.providerPageUrl,
    },
    dominantColor: row.dominantColor,
    externalPhotoId: row.externalPhotoId,
    height: row.height,
    sources: { large: row.largeUrl, medium: row.mediumUrl, small: row.smallUrl },
    width: row.width,
  };
}

/**
 * Resolves through the `editorial_images` table first, and only reaches the
 * provider for a subject that has no fresh answer.
 *
 * Every read is one query for the whole batch, so a Trips list costs a single
 * round trip whatever its length, and cached subjects cost no provider call at
 * all. The uncached remainder is the only thing that fans out, bounded by the
 * shared provider concurrency limit in the base class.
 */
export class CachedEditorialImagesService extends EditorialImagesService {
  private readonly now: () => Date;
  private readonly source: ProviderCallSource;

  constructor(
    provider: EditorialImageProvider,
    clock: () => Date = () => new Date(),
    logger?: ConstructorParameters<typeof EditorialImagesService>[2],
    source: ProviderCallSource = 'test',
  ) {
    super(provider, clock, logger);
    this.now = clock;
    this.source = source;
  }

  protected override async resolveUnique(
    requests: UniqueEditorialImageRequest[],
    context: EditorialImageResolveContext,
  ): Promise<EditorialImageResult[]> {
    const rows = await this.readRows(requests.map((request) => request.subjectKey));
    const pending: UniqueEditorialImageRequest[] = [];
    const results = new Map<string, EditorialImageResult>();
    const pins: Promise<void>[] = [];

    for (const request of requests) {
      const row = rows.get(request.subjectKey);
      const cached = this.readCache(row);

      if (cached.kind === 'hit') {
        recordProviderCacheEvent({
          cache: 'editorial-image',
          kind: 'cache_hit',
          operation: 'search',
          provider: 'pexels',
          source: this.source,
        });
        results.set(request.subjectKey, {
          image: cached.image,
          status: 'ok',
          subjectKey: request.subjectKey,
        });
        pins.push(this.pin(request, row?.id, context));
        continue;
      }

      if (cached.kind === 'negative') {
        recordProviderCacheEvent({
          cache: 'editorial-image',
          kind: 'negative_cache_hit',
          operation: 'search',
          provider: 'pexels',
          source: this.source,
        });
        results.set(request.subjectKey, { status: 'empty', subjectKey: request.subjectKey });
        continue;
      }

      pending.push(request);
    }

    const resolved = await super.resolveUnique(pending, context);

    await Promise.all(
      resolved.map(async (result, index) => {
        const request = pending[index] as UniqueEditorialImageRequest;

        results.set(
          request.subjectKey,
          await this.persist(request, result, rows.get(request.subjectKey), context, pins),
        );
      }),
    );

    await Promise.all(pins);

    return requests.map(
      (request) =>
        results.get(request.subjectKey) ?? {
          status: 'empty',
          subjectKey: request.subjectKey,
        },
    );
  }

  private async readRows(subjectKeys: string[]) {
    try {
      const rows = await getPrismaClient().editorialImage.findMany({
        where: { subjectKey: { in: subjectKeys } },
      });

      return new Map(rows.map((row) => [row.subjectKey, row as CachedEditorialImageRow]));
    } catch {
      // A cache that cannot be read is a slow path, never a failed request.
      return new Map<string, CachedEditorialImageRow>();
    }
  }

  private readCache(
    row: CachedEditorialImageRow | undefined,
  ):
    | { image: EditorialImageReference; kind: 'hit' }
    | { kind: 'negative' }
    | { kind: 'miss'; reason: ProviderCacheMissReason } {
    if (!row) {
      return { kind: 'miss', reason: 'missing_editorial_image' };
    }

    const now = this.now().getTime();
    const reference = toReference(row);

    if (reference && row.cachedAt && now - row.cachedAt.getTime() <= EDITORIAL_IMAGE_CACHE_TTL_MS) {
      return { image: reference, kind: 'hit' };
    }

    if (!reference && row.missedAt && now - row.missedAt.getTime() <= EDITORIAL_IMAGE_MISS_TTL_MS) {
      return { kind: 'negative' };
    }

    return {
      kind: 'miss',
      reason: row.cachedAt ? 'stale_editorial_image' : 'missing_editorial_image',
    };
  }

  /**
   * Writes the provider's answer, and decides what a non-answer means.
   *
   * A photograph already on the row outlives a later empty or unavailable one:
   * the traveller keeps the image they have seen before, which is both the
   * better picture and the stabler one. An empty answer still refreshes the
   * dating so the next render does not re-ask.
   */
  private async persist(
    request: UniqueEditorialImageRequest,
    result: EditorialImageResult,
    row: CachedEditorialImageRow | undefined,
    context: EditorialImageResolveContext,
    pins: Promise<void>[],
  ): Promise<EditorialImageResult> {
    const existing = row ? toReference(row) : null;

    if (result.status === 'unavailable') {
      if (!existing) {
        return result;
      }

      pins.push(this.pin(request, row?.id, context));

      return { image: existing, status: 'ok', subjectKey: request.subjectKey };
    }

    const now = this.now();
    const image = result.status === 'ok' ? result.image : existing;

    const data = image
      ? {
          altText: image.altText,
          cachedAt: now,
          dominantColor: image.dominantColor,
          externalPhotoId: image.externalPhotoId,
          height: image.height,
          largeUrl: image.sources.large,
          mediumUrl: image.sources.medium,
          missCode: null,
          missedAt: null,
          photographerName: image.attribution.photographerName,
          photographerUrl: image.attribution.photographerUrl,
          provider: 'PEXELS' as const,
          providerPageUrl: image.attribution.providerPageUrl,
          smallUrl: image.sources.small,
          width: image.width,
        }
      : { cachedAt: null, missCode: NO_RESULTS, missedAt: now };

    let imageId = row?.id;

    try {
      const saved = await getPrismaClient().editorialImage.upsert({
        create: { subjectKey: request.subjectKey, ...data },
        select: { id: true },
        update: data,
        where: { subjectKey: request.subjectKey },
      });

      imageId = saved.id;
    } catch {
      // A cache that cannot be written still answers this request.
    }

    if (!image) {
      return { status: 'empty', subjectKey: request.subjectKey };
    }

    pins.push(this.pin(request, imageId, context));

    return { image, status: 'ok', subjectKey: request.subjectKey };
  }

  /**
   * Points the rows that asked at the photograph they got.
   *
   * Both updates are scoped so a request can only pin rows its caller may write:
   * their own trips, and places that are either shared provider places or their
   * own custom ones.
   */
  private async pin(
    request: UniqueEditorialImageRequest,
    editorialImageId: string | undefined,
    context: EditorialImageResolveContext,
  ) {
    if (!editorialImageId) {
      return;
    }

    const prisma = getPrismaClient();

    try {
      if (request.tripIds.length > 0) {
        await prisma.trip.updateMany({
          data: { editorialImageId },
          where: { id: { in: request.tripIds }, ownerId: context.ownerId },
        });
      }

      if (request.placeIds.length > 0) {
        await prisma.place.updateMany({
          data: { editorialImageId },
          where: {
            id: { in: request.placeIds },
            OR: [{ ownerId: null }, { ownerId: context.ownerId }],
          },
        });
      }
    } catch {
      // Pinning is an optimisation for the next render, never this one.
    }
  }
}
