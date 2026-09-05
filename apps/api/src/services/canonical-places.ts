import { getPrismaClient } from '@trove/db';

import { hydratePlaceSnapshot, isSnapshotFresh, type PlaceSnapshotSource } from './place-data.js';
import { normalizePlaceLanguageCode } from './place-language.js';
import {
  type CanonicalPlace,
  placeProviderRefInclude,
  serializeCanonicalPlace,
} from './place-serializer.js';
import type { PlaceProviderName, ProviderPlaceIdentity } from './places.js';
import { providerTargetFingerprint, recordProviderCacheEvent } from './provider-usage.js';

export type { CanonicalPlace } from './place-serializer.js';

export type CustomPlaceLocation = {
  latitude: number;
  longitude: number;
  timeZone?: string | null;
};

export type CustomPlaceCreate = {
  location?: CustomPlaceLocation | null;
  name: string;
  note?: string | null;
};

export type CustomPlaceUpdate = {
  location?: CustomPlaceLocation | null;
  name?: string;
  note?: string | null;
};

/**
 * What the provider called a Place when it was first resolved. Kept as a last
 * resort so a Place is never nameless when the provider cannot be reached, and
 * never preferred over the details resolved live.
 */
export type ProviderPlaceLabel = {
  address?: string | null;
  name?: string | null;
};

export type CanonicalPlaceRecord = {
  customLatitude: number | null;
  customLongitude: number | null;
  customName: string | null;
  customNote: string | null;
  customTimeZone: string | null;
  id: string;
  kind: 'CUSTOM' | 'PROVIDER';
  ownerId: string | null;
  providerAddress: string | null;
  providerLabel: string | null;
  providerRefs: (PlaceSnapshotSource & {
    provider: 'GOOGLE';
  })[];
};

export interface CanonicalPlaceRepository {
  backfillProviderLabel(placeId: string, label: ProviderPlaceLabel): Promise<CanonicalPlaceRecord>;
  /** The name a Place the caller owns is known by, or null if it is not theirs. */
  findOwnedCustomPlaceName(userId: string, placeId: string): Promise<string | null>;
  createCustomPlace(userId: string, input: CustomPlaceCreate): Promise<CanonicalPlaceRecord>;
  createProviderPlace(
    provider: PlaceProviderName,
    externalPlaceId: string,
    label?: ProviderPlaceLabel,
  ): Promise<CanonicalPlaceRecord>;
  findByProviderRef(
    provider: PlaceProviderName,
    externalPlaceId: string,
  ): Promise<CanonicalPlaceRecord | null>;
  writeProviderSnapshot(
    placeId: string,
    identity: ProviderPlaceIdentity,
    languageCode: string | undefined,
    fetchedAt: Date,
  ): Promise<CanonicalPlaceRecord>;
  updateOwnedCustomPlace(
    userId: string,
    placeId: string,
    input: CustomPlaceUpdate,
  ): Promise<CanonicalPlaceRecord | null>;
}

export class CanonicalPlaceNotFoundError extends Error {
  constructor() {
    super('place_not_found');
  }
}

export class ProviderReferenceConflictError extends Error {
  constructor() {
    super('provider_reference_conflict');
  }
}

function toDatabaseProvider(provider: PlaceProviderName) {
  return provider === 'google' ? ('GOOGLE' as const) : (provider satisfies never);
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function normalizeNote(note: string | null | undefined) {
  return note?.trim() || null;
}

/**
 * The columns a custom-place edit writes, and only those.
 *
 * Pulled out of the repository because the time-zone rule is the subtle part and
 * deserves to be assertable without a database: clearing a location clears its
 * zone, but giving a place coordinates must not. A Place created without
 * coordinates can still carry a zone, and the serializer only exposes one inside
 * `location` - so it is invisible to a client that has never seen the place
 * located, and a caller repairing that place would drop a zone it never knew
 * about.
 */
export function customPlaceUpdateData(input: CustomPlaceUpdate) {
  return {
    ...(input.location !== undefined
      ? {
          customLatitude: input.location?.latitude ?? null,
          customLongitude: input.location?.longitude ?? null,
          ...(input.location === null || input.location.timeZone !== undefined
            ? { customTimeZone: input.location?.timeZone?.trim() || null }
            : {}),
        }
      : {}),
    ...(input.name !== undefined ? { customName: input.name.trim() } : {}),
    ...(input.note !== undefined ? { customNote: normalizeNote(input.note) } : {}),
  };
}

function normalizeLabel(label: ProviderPlaceLabel | undefined) {
  return {
    providerAddress: label?.address?.trim() || null,
    providerLabel: label?.name?.trim() || null,
  };
}

function serializePlace(
  place: CanonicalPlaceRecord,
  snapshot?: PlaceSnapshotSource | null,
): CanonicalPlace {
  return serializeCanonicalPlace(place, {
    snapshots: snapshot ? new Map([[snapshot.externalPlaceId, snapshot]]) : undefined,
  });
}

function toPlaceRecord(place: {
  customLatitude: { toNumber(): number } | null;
  customLongitude: { toNumber(): number } | null;
  customName: string | null;
  customNote: string | null;
  customTimeZone: string | null;
  id: string;
  kind: 'CUSTOM' | 'PROVIDER';
  ownerId: string | null;
  providerAddress: string | null;
  providerLabel: string | null;
  providerRefs: (PlaceSnapshotSource & { provider: 'GOOGLE' })[];
}): CanonicalPlaceRecord {
  return {
    ...place,
    customLatitude: place.customLatitude?.toNumber() ?? null,
    customLongitude: place.customLongitude?.toNumber() ?? null,
  };
}

class PrismaCanonicalPlaceRepository implements CanonicalPlaceRepository {
  async findOwnedCustomPlaceName(userId: string, placeId: string) {
    const place = await getPrismaClient().place.findFirst({
      where: { id: placeId, kind: 'CUSTOM', ownerId: userId },
      select: { customName: true },
    });
    return place?.customName ?? null;
  }

  async findByProviderRef(provider: PlaceProviderName, externalPlaceId: string) {
    const reference = await getPrismaClient().placeProviderRef.findUnique({
      where: {
        provider_externalPlaceId: {
          externalPlaceId,
          provider: toDatabaseProvider(provider),
        },
      },
      include: { place: { include: placeProviderRefInclude } },
    });

    return reference ? toPlaceRecord(reference.place) : null;
  }

  async createProviderPlace(
    provider: PlaceProviderName,
    externalPlaceId: string,
    label?: ProviderPlaceLabel,
  ) {
    try {
      const reference = await getPrismaClient().placeProviderRef.create({
        data: {
          externalPlaceId,
          provider: toDatabaseProvider(provider),
          place: { create: { kind: 'PROVIDER', ...normalizeLabel(label) } },
        },
        include: { place: { include: placeProviderRefInclude } },
      });

      return toPlaceRecord(reference.place);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ProviderReferenceConflictError();
      }
      throw error;
    }
  }

  async writeProviderSnapshot(
    placeId: string,
    identity: ProviderPlaceIdentity,
    languageCode: string | undefined,
    fetchedAt: Date,
  ) {
    await getPrismaClient().placeProviderRef.updateMany({
      where: {
        externalPlaceId: identity.externalPlaceId,
        placeId,
        provider: toDatabaseProvider(identity.provider),
      },
      data: {
        cachedAt: fetchedAt,
        cachedFormattedAddress: identity.formattedAddress,
        cachedGoogleMapsUri: identity.googleMapsUri,
        cachedLanguageCode: normalizePlaceLanguageCode(languageCode),
        cachedLatitude: identity.location.latitude,
        cachedLongitude: identity.location.longitude,
        cachedName: identity.name,
        cachedPrimaryType: identity.primaryType,
        cachedTypes: identity.rawTypes,
        cachedUtcOffsetMinutes: identity.utcOffsetMinutes,
        detailsFailedAt: null,
        detailsFailureCode: null,
      },
    });

    const place = await getPrismaClient().place.findUnique({
      where: { id: placeId },
      include: placeProviderRefInclude,
    });
    if (!place) throw new CanonicalPlaceNotFoundError();
    return toPlaceRecord(place);
  }

  /**
   * Fills in a label a Place resolved before this was captured. Only ever writes
   * over a null, so the first text a Place was known by is the text it keeps.
   */
  async backfillProviderLabel(placeId: string, label: ProviderPlaceLabel) {
    const { providerAddress, providerLabel } = normalizeLabel(label);
    const place = await getPrismaClient().place.update({
      where: { id: placeId },
      data: {
        ...(providerAddress ? { providerAddress } : {}),
        ...(providerLabel ? { providerLabel } : {}),
      },
      include: placeProviderRefInclude,
    });

    return toPlaceRecord(place);
  }

  async createCustomPlace(userId: string, input: CustomPlaceCreate) {
    return getPrismaClient().$transaction(async (transaction) => {
      await transaction.profile.upsert({
        where: { id: userId },
        create: { id: userId },
        update: {},
      });

      const place = await transaction.place.create({
        data: {
          customLatitude: input.location?.latitude ?? null,
          customLongitude: input.location?.longitude ?? null,
          customName: input.name.trim(),
          customNote: normalizeNote(input.note),
          customTimeZone: input.location?.timeZone?.trim() || null,
          kind: 'CUSTOM',
          ownerId: userId,
        },
        include: placeProviderRefInclude,
      });

      return toPlaceRecord(place);
    });
  }

  async updateOwnedCustomPlace(userId: string, placeId: string, input: CustomPlaceUpdate) {
    return getPrismaClient().$transaction(async (transaction) => {
      const result = await transaction.place.updateMany({
        where: { id: placeId, kind: 'CUSTOM', ownerId: userId },
        data: customPlaceUpdateData(input),
      });

      if (result.count === 0) {
        return null;
      }

      const place = await transaction.place.findFirst({
        where: { id: placeId, kind: 'CUSTOM', ownerId: userId },
        include: placeProviderRefInclude,
      });

      return place ? toPlaceRecord(place) : null;
    });
  }
}

/** Injectable so a test can count what a resolution costs. */
export type PlaceSnapshotHydrator = (
  externalPlaceId: string,
  options?: {
    languageCode?: string;
    sessionToken?: string;
    source?: 'place-resolution';
  },
) => Promise<PlaceSnapshotSource | null>;

export class CanonicalPlacesService {
  constructor(
    private readonly repository: CanonicalPlaceRepository,
    private readonly hydrate: PlaceSnapshotHydrator = hydratePlaceSnapshot,
  ) {}

  async resolveProviderPlace(
    provider: PlaceProviderName,
    externalPlaceId: string,
    label?: ProviderPlaceLabel,
    options: { languageCode?: string; sessionToken?: string } = {},
  ) {
    const normalizedExternalPlaceId = externalPlaceId.trim();
    const place = await this.getOrCreateProviderPlace(provider, normalizedExternalPlaceId, label);
    return serializePlace(
      place,
      await this.ensureSnapshot(place, normalizedExternalPlaceId, options),
    );
  }

  /** Reuses the Text Search response as the durable snapshot, avoiding a details call. */
  async resolveProviderPlaceFromIdentity(
    identity: ProviderPlaceIdentity,
    options: { fetchedAt?: Date; languageCode?: string } = {},
  ) {
    const place = await this.getOrCreateProviderPlace(identity.provider, identity.externalPlaceId, {
      address: identity.formattedAddress,
      name: identity.name,
    });
    const snapshotted = await this.repository.writeProviderSnapshot(
      place.id,
      identity,
      options.languageCode,
      options.fetchedAt ?? new Date(),
    );
    const reference = snapshotted.providerRefs.find(
      (entry) => entry.externalPlaceId === identity.externalPlaceId && entry.provider === 'GOOGLE',
    );
    return serializePlace(snapshotted, reference);
  }

  private async getOrCreateProviderPlace(
    provider: PlaceProviderName,
    externalPlaceId: string,
    label?: ProviderPlaceLabel,
  ) {
    const existing = await this.repository.findByProviderRef(provider, externalPlaceId);
    if (existing) return this.withLabel(existing, label);

    try {
      return await this.repository.createProviderPlace(provider, externalPlaceId, label);
    } catch (error) {
      if (!(error instanceof ProviderReferenceConflictError)) throw error;
      const concurrentlyCreated = await this.repository.findByProviderRef(
        provider,
        externalPlaceId,
      );
      if (!concurrentlyCreated) throw error;
      return this.withLabel(concurrentlyCreated, label);
    }
  }

  /**
   * The one provider request a Place ever costs, paid the moment a traveller
   * picks it out of search. Every screen afterwards reads what this stored.
   *
   * It runs after the reference row exists, which is what makes it stick:
   * the snapshot write matches on the reference, so fetching before the row
   * was created bought an answer that was then silently discarded.
   *
   * A Place someone else already added — or the same Place being added to a
   * second trip — finds a usable snapshot here and costs nothing.
   */
  private async ensureSnapshot(
    place: CanonicalPlaceRecord,
    externalPlaceId: string,
    options: { languageCode?: string; sessionToken?: string },
  ) {
    const reference = place.providerRefs.find(
      (entry) => entry.externalPlaceId === externalPlaceId && entry.provider === 'GOOGLE',
    );
    if (!reference) return null;
    if (isSnapshotFresh(reference, { languageCode: options.languageCode })) {
      recordProviderCacheEvent({
        cache: 'place-details',
        kind: 'cache_hit',
        operation: 'getDetails',
        placeFingerprint: providerTargetFingerprint(externalPlaceId),
        provider: 'google',
        source: 'place-resolution',
      });
      return null;
    }

    return this.hydrate(externalPlaceId, {
      languageCode: options.languageCode,
      sessionToken: options.sessionToken,
      source: 'place-resolution',
    });
  }

  /**
   * A Place resolved before labels were captured has nothing to fall back on, so
   * the next traveller to reach it through search lends it theirs. A Place that
   * already has one is left alone rather than drifting with each search wording.
   */
  private async withLabel(place: CanonicalPlaceRecord, label: ProviderPlaceLabel | undefined) {
    const missing =
      (!place.providerLabel && label?.name?.trim()) ||
      (!place.providerAddress && label?.address?.trim());
    if (!missing) {
      return place;
    }

    return this.repository.backfillProviderLabel(place.id, {
      address: place.providerAddress ? null : label?.address,
      name: place.providerLabel ? null : label?.name,
    });
  }

  /**
   * What a Custom Place the caller owns is called, and nothing else.
   *
   * The one read behind the locate lookup: it both authorises the request and
   * supplies the wording searched when the traveller offers none.
   */
  async findOwnedCustomPlaceName(userId: string, placeId: string) {
    return this.repository.findOwnedCustomPlaceName(userId, placeId);
  }

  async createCustomPlace(userId: string, input: CustomPlaceCreate) {
    return serializePlace(
      await this.repository.createCustomPlace(userId, {
        ...input,
        name: input.name.trim(),
        note: normalizeNote(input.note),
      }),
    );
  }

  async updateCustomPlace(userId: string, placeId: string, input: CustomPlaceUpdate) {
    const place = await this.repository.updateOwnedCustomPlace(userId, placeId, {
      ...input,
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.note !== undefined ? { note: normalizeNote(input.note) } : {}),
    });

    if (!place) {
      throw new CanonicalPlaceNotFoundError();
    }

    return serializePlace(place);
  }
}

export function createCanonicalPlacesService() {
  return new CanonicalPlacesService(new PrismaCanonicalPlaceRepository());
}
