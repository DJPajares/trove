import { getPrismaClient } from '@trove/db';

import {
  EDITORIAL_IMAGE_RESOLUTION_VERSION,
  editorialSubjectKey,
  EditorialImagesService,
  type EditorialImageProvider,
  type EditorialImageReference,
  type EditorialImageResolveContext,
  type EditorialImageResult,
  type UniqueEditorialImageRequest,
} from './editorial-images.js';
import { genericEditorialSubject } from './editorial-image-matching.js';
import { categorizePlaceTypes } from './place-categories.js';
import {
  recordProviderCacheEvent,
  type ProviderCacheMissReason,
  type ProviderCallSource,
} from './provider-usage.js';

/** A representative editorial collection is stable for ninety days. */
export const EDITORIAL_IMAGE_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1_000;

/** A definitive empty result is retried after seven days. */
export const EDITORIAL_IMAGE_MISS_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

const NO_RESULTS = 'NO_RESULTS';
const NO_VERIFIED_MATCH = 'NO_VERIFIED_MATCH';
const MAX_IMAGES_PER_SUBJECT = 3;

type CachedEditorialImageRow = {
  altText: string | null;
  dominantColor: string | null;
  externalPhotoId: string;
  height: number | null;
  id: string;
  photographerName: string;
  photographerUrl: string;
  position: number;
  providerPageUrl: string;
  sourceUrl: string;
  width: number | null;
};

type CachedEditorialImageSetRow = {
  cachedAt: Date | null;
  id: string;
  images: CachedEditorialImageRow[];
  missCode?: string | null;
  missedAt: Date | null;
  resolutionVersion?: number;
  subjectKey: string;
};

type CachedPlaceRow = {
  id: string;
  providerAddress: string | null;
  providerLabel: string | null;
  providerRefs: Array<{
    cachedFormattedAddress: string | null;
    cachedLanguageCode: string | null;
    cachedName: string | null;
    cachedPrimaryType: string | null;
    cachedTypes: string[];
    provider: 'GOOGLE';
  }>;
};

function toReference(row: CachedEditorialImageRow): EditorialImageReference | null {
  if (
    !row.externalPhotoId ||
    !row.photographerName ||
    !row.photographerUrl ||
    !row.providerPageUrl ||
    !row.sourceUrl
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
    sourceUrl: row.sourceUrl,
    width: row.width,
  };
}

function toReferences(row: CachedEditorialImageSetRow) {
  return row.images
    .toSorted((left, right) => left.position - right.position)
    .map(toReference)
    .filter((image): image is EditorialImageReference => image !== null)
    .slice(0, row.subjectKey.startsWith('generic:') ? 1 : MAX_IMAGES_PER_SUBJECT);
}

/**
 * Resolves a screen batch from PostgreSQL first. Only missing or stale subjects
 * reach Pexels, and each distinct subject still costs at most one search call.
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
    const enriched = await this.enrichRequests(requests, context);
    const rows = await this.readRows(enriched.map((request) => request.subjectKey));
    const pending: UniqueEditorialImageRequest[] = [];
    const fallback: UniqueEditorialImageRequest[] = [];
    const results = new Map<string, EditorialImageResult>();
    const pins: Promise<void>[] = [];

    for (const request of enriched) {
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
          images: cached.images,
          matchKind: request.subject.kind === 'generic' ? 'generic' : 'exact',
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
        if (cached.verifiedMiss) {
          fallback.push(request);
        } else {
          results.set(request.subjectKey, { status: 'empty', subjectKey: request.subjectKey });
        }
        continue;
      }

      pending.push(request);
    }

    const resolved = await super.resolveUnique(pending, context);

    await Promise.all(
      resolved.map(async (result, index) => {
        const request = pending[index] as UniqueEditorialImageRequest;

        if (result.status === 'empty') {
          await this.persistVerifiedMiss(request);
          fallback.push(request);
          return;
        }

        results.set(
          request.subjectKey,
          await this.persist(request, result, rows.get(request.subjectKey), context, pins),
        );
      }),
    );

    if (fallback.length > 0) {
      const fallbackResults = await this.resolveFallbacks(fallback, context, pins);

      for (const request of fallback) {
        const result = fallbackResults.get(
          editorialSubjectKey(genericEditorialSubject(request.subject)),
        );

        if (!result || result.status === 'empty') {
          results.set(request.subjectKey, { status: 'empty', subjectKey: request.subjectKey });
          continue;
        }

        results.set(request.subjectKey, { ...result, subjectKey: request.subjectKey });
      }
    }

    await Promise.all(pins);

    return requests.map(
      (request) =>
        results.get(request.subjectKey) ?? {
          status: 'empty',
          subjectKey: request.subjectKey,
        },
    );
  }

  private async enrichRequests(
    requests: UniqueEditorialImageRequest[],
    context: EditorialImageResolveContext,
  ) {
    const placeIds = requests.flatMap((request) => request.placeIds);
    if (placeIds.length === 0) return requests;

    let places: CachedPlaceRow[];

    try {
      places = (await getPrismaClient().place.findMany({
        include: { providerRefs: { where: { provider: 'GOOGLE' } } },
        where: {
          id: { in: [...new Set(placeIds)] },
          kind: 'PROVIDER',
          OR: [{ ownerId: null }, { ownerId: context.ownerId }],
        },
      })) as CachedPlaceRow[];
    } catch {
      // A database unavailable for enrichment must not take photographs down.
      return requests;
    }

    const byId = new Map(places.map((place) => [place.id, place]));

    return requests.flatMap((request) => {
      if (request.placeIds.length === 0) return [request];

      const place = byId.get(request.placeIds[0] ?? '');
      if (!place) return [];

      const reference = place.providerRefs[0];
      const types = reference?.cachedTypes ?? [];
      const category =
        reference && (types.length > 0 || reference.cachedPrimaryType)
          ? categorizePlaceTypes(types, reference.cachedPrimaryType)
          : (request.subject.category ?? 'other');

      return [
        {
          ...request,
          subject: {
            ...request.subject,
            address: reference?.cachedFormattedAddress ?? place.providerAddress,
            category,
            languageCode: reference?.cachedLanguageCode,
            name: reference?.cachedName ?? place.providerLabel ?? request.subject.name,
            placeId: place.id,
            primaryType: reference?.cachedPrimaryType,
            rawTypes: types,
          },
        },
      ];
    });
  }

  private async resolveFallbacks(
    requests: UniqueEditorialImageRequest[],
    context: EditorialImageResolveContext,
    pins: Promise<void>[],
  ) {
    const grouped = new Map<string, UniqueEditorialImageRequest>();

    for (const request of requests) {
      const subject = genericEditorialSubject(request.subject);
      const subjectKey = editorialSubjectKey(subject);
      const entry = grouped.get(subjectKey) ?? {
        placeIds: [],
        subject,
        subjectKey,
        tripIds: [],
      };

      for (const placeId of request.placeIds) {
        if (!entry.placeIds.includes(placeId)) entry.placeIds.push(placeId);
      }
      for (const tripId of request.tripIds) {
        if (!entry.tripIds.includes(tripId)) entry.tripIds.push(tripId);
      }

      grouped.set(subjectKey, entry);
    }

    const unique = [...grouped.values()];
    const rows = await this.readRows(unique.map((request) => request.subjectKey));
    const pending: UniqueEditorialImageRequest[] = [];
    const results = new Map<string, EditorialImageResult>();

    for (const request of unique) {
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
          images: cached.images,
          matchKind: 'generic',
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

    return results;
  }

  private async readRows(subjectKeys: string[]) {
    try {
      const rows = await getPrismaClient().editorialImageSet.findMany({
        include: { images: { orderBy: { position: 'asc' }, take: MAX_IMAGES_PER_SUBJECT } },
        where: { subjectKey: { in: subjectKeys } },
      });

      return new Map(rows.map((row) => [row.subjectKey, row as CachedEditorialImageSetRow]));
    } catch {
      return new Map<string, CachedEditorialImageSetRow>();
    }
  }

  private readCache(
    row: CachedEditorialImageSetRow | undefined,
  ):
    | { images: EditorialImageReference[]; kind: 'hit' }
    | { kind: 'negative'; verifiedMiss: boolean }
    | { kind: 'miss'; reason: ProviderCacheMissReason } {
    if (!row) return { kind: 'miss', reason: 'missing_editorial_image' };

    if (
      (row.resolutionVersion ?? EDITORIAL_IMAGE_RESOLUTION_VERSION) !==
      EDITORIAL_IMAGE_RESOLUTION_VERSION
    ) {
      return { kind: 'miss', reason: 'stale_editorial_image' };
    }

    const now = this.now().getTime();
    const images = toReferences(row);

    if (
      images.length > 0 &&
      row.cachedAt &&
      now - row.cachedAt.getTime() <= EDITORIAL_IMAGE_CACHE_TTL_MS
    ) {
      return { images, kind: 'hit' };
    }

    const verifiedMiss = row.missCode === NO_VERIFIED_MATCH;

    if ((images.length === 0 || verifiedMiss) && row.missedAt) {
      const lifetime = verifiedMiss ? EDITORIAL_IMAGE_CACHE_TTL_MS : EDITORIAL_IMAGE_MISS_TTL_MS;

      if (now - row.missedAt.getTime() <= lifetime) {
        return { kind: 'negative', verifiedMiss };
      }
    }

    return {
      kind: 'miss',
      reason: row.cachedAt ? 'stale_editorial_image' : 'missing_editorial_image',
    };
  }

  private async persistVerifiedMiss(request: UniqueEditorialImageRequest) {
    const now = this.now();

    try {
      await getPrismaClient().editorialImageSet.upsert({
        create: {
          cachedAt: null,
          missCode: NO_VERIFIED_MATCH,
          missedAt: now,
          resolutionVersion: EDITORIAL_IMAGE_RESOLUTION_VERSION,
          subjectKey: request.subjectKey,
        },
        update: {
          cachedAt: null,
          missCode: NO_VERIFIED_MATCH,
          missedAt: now,
          resolutionVersion: EDITORIAL_IMAGE_RESOLUTION_VERSION,
        },
        where: { subjectKey: request.subjectKey },
      });
    } catch {
      // A write failure must not prevent the generic fallback for this request.
    }
  }

  /** Preserve an existing collection whenever a refresh is empty or unavailable. */
  private async persist(
    request: UniqueEditorialImageRequest,
    result: EditorialImageResult,
    row: CachedEditorialImageSetRow | undefined,
    context: EditorialImageResolveContext,
    pins: Promise<void>[],
  ): Promise<EditorialImageResult> {
    const existing =
      row &&
      row.missCode !== NO_VERIFIED_MATCH &&
      (row.resolutionVersion ?? EDITORIAL_IMAGE_RESOLUTION_VERSION) ===
        EDITORIAL_IMAGE_RESOLUTION_VERSION
        ? toReferences(row)
        : [];

    if (result.status === 'unavailable') {
      if (existing.length === 0) return result;
      pins.push(this.pin(request, row?.id, context));
      return {
        images: existing,
        matchKind: request.subject.kind === 'generic' ? 'generic' : 'exact',
        status: 'ok',
        subjectKey: request.subjectKey,
      };
    }

    const now = this.now();
    const maximumImages = request.subject.kind === 'generic' ? 1 : MAX_IMAGES_PER_SUBJECT;
    const images = (result.status === 'ok' ? result.images : existing).slice(0, maximumImages);
    const setData =
      images.length > 0
        ? {
            cachedAt: now,
            missCode: null,
            missedAt: null,
            resolutionVersion: EDITORIAL_IMAGE_RESOLUTION_VERSION,
          }
        : {
            cachedAt: null,
            missCode: NO_RESULTS,
            missedAt: now,
            resolutionVersion: EDITORIAL_IMAGE_RESOLUTION_VERSION,
          };
    const imageRows = images.map((image, position) => ({
      altText: image.altText,
      dominantColor: image.dominantColor,
      externalPhotoId: image.externalPhotoId,
      height: image.height,
      photographerName: image.attribution.photographerName,
      photographerUrl: image.attribution.photographerUrl,
      position,
      provider: 'PEXELS' as const,
      providerPageUrl: image.attribution.providerPageUrl,
      sourceUrl: image.sourceUrl,
      width: image.width,
    }));

    let imageSetId = row?.id;

    try {
      const saved = await getPrismaClient().editorialImageSet.upsert({
        create: {
          subjectKey: request.subjectKey,
          ...setData,
          images: imageRows.length > 0 ? { create: imageRows } : undefined,
        },
        select: { id: true },
        update: {
          ...setData,
          images: { deleteMany: {}, ...(imageRows.length > 0 ? { create: imageRows } : {}) },
        },
        where: { subjectKey: request.subjectKey },
      });

      imageSetId = saved.id;
    } catch {
      // A cache that cannot be written still answers the current request.
    }

    if (images.length === 0) return { status: 'empty', subjectKey: request.subjectKey };

    pins.push(this.pin(request, imageSetId, context));
    return {
      images,
      matchKind: request.subject.kind === 'generic' ? 'generic' : 'exact',
      status: 'ok',
      subjectKey: request.subjectKey,
    };
  }

  /** Pin only rows the authenticated caller may update. */
  private async pin(
    request: UniqueEditorialImageRequest,
    editorialImageSetId: string | undefined,
    context: EditorialImageResolveContext,
  ) {
    if (!editorialImageSetId) return;

    const prisma = getPrismaClient();

    try {
      if (request.tripIds.length > 0) {
        await prisma.trip.updateMany({
          data: { editorialImageSetId },
          where: { id: { in: request.tripIds }, ownerId: context.ownerId },
        });
      }

      if (request.placeIds.length > 0) {
        await prisma.place.updateMany({
          data: { editorialImageSetId },
          where: {
            id: { in: request.placeIds },
            OR: [{ ownerId: null }, { ownerId: context.ownerId }],
          },
        });
      }
    } catch {
      // Pinning is an optimization for the next render, never this one.
    }
  }
}
