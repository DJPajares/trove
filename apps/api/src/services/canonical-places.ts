import { getPrismaClient } from '@trove/db';

import type { PlaceProviderName } from './places.js';

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

export type CanonicalPlace = {
  id: string;
  kind: 'custom' | 'provider';
  location: {
    latitude: number;
    longitude: number;
    timeZone: string | null;
  } | null;
  name: string | null;
  note: string | null;
  providerAddress: string | null;
  providerLabel: string | null;
  providerRefs: {
    externalPlaceId: string;
    provider: PlaceProviderName;
  }[];
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
  providerRefs: {
    externalPlaceId: string;
    provider: 'GOOGLE';
  }[];
};

export interface CanonicalPlaceRepository {
  backfillProviderLabel(placeId: string, label: ProviderPlaceLabel): Promise<CanonicalPlaceRecord>;
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

function fromDatabaseProvider(provider: CanonicalPlaceRecord['providerRefs'][number]['provider']) {
  return provider === 'GOOGLE' ? ('google' as const) : (provider satisfies never);
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function normalizeNote(note: string | null | undefined) {
  return note?.trim() || null;
}

function normalizeLabel(label: ProviderPlaceLabel | undefined) {
  return {
    providerAddress: label?.address?.trim() || null,
    providerLabel: label?.name?.trim() || null,
  };
}

function serializePlace(place: CanonicalPlaceRecord): CanonicalPlace {
  return {
    id: place.id,
    kind: place.kind === 'CUSTOM' ? 'custom' : 'provider',
    location:
      place.customLatitude === null || place.customLongitude === null
        ? null
        : {
            latitude: place.customLatitude,
            longitude: place.customLongitude,
            timeZone: place.customTimeZone,
          },
    name: place.customName,
    note: place.customNote,
    providerAddress: place.providerAddress,
    providerLabel: place.providerLabel,
    providerRefs: place.providerRefs.map((reference) => ({
      externalPlaceId: reference.externalPlaceId,
      provider: fromDatabaseProvider(reference.provider),
    })),
  };
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
  providerRefs: { externalPlaceId: string; provider: 'GOOGLE' }[];
}): CanonicalPlaceRecord {
  return {
    ...place,
    customLatitude: place.customLatitude?.toNumber() ?? null,
    customLongitude: place.customLongitude?.toNumber() ?? null,
  };
}

class PrismaCanonicalPlaceRepository implements CanonicalPlaceRepository {
  async findByProviderRef(provider: PlaceProviderName, externalPlaceId: string) {
    const reference = await getPrismaClient().placeProviderRef.findUnique({
      where: {
        provider_externalPlaceId: {
          externalPlaceId,
          provider: toDatabaseProvider(provider),
        },
      },
      include: { place: { include: { providerRefs: true } } },
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
        include: { place: { include: { providerRefs: true } } },
      });

      return toPlaceRecord(reference.place);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ProviderReferenceConflictError();
      }
      throw error;
    }
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
      include: { providerRefs: true },
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
        include: { providerRefs: true },
      });

      return toPlaceRecord(place);
    });
  }

  async updateOwnedCustomPlace(userId: string, placeId: string, input: CustomPlaceUpdate) {
    return getPrismaClient().$transaction(async (transaction) => {
      const result = await transaction.place.updateMany({
        where: { id: placeId, kind: 'CUSTOM', ownerId: userId },
        data: {
          ...(input.location !== undefined
            ? {
                customLatitude: input.location?.latitude ?? null,
                customLongitude: input.location?.longitude ?? null,
                customTimeZone: input.location?.timeZone?.trim() || null,
              }
            : {}),
          ...(input.name !== undefined ? { customName: input.name.trim() } : {}),
          ...(input.note !== undefined ? { customNote: normalizeNote(input.note) } : {}),
        },
      });

      if (result.count === 0) {
        return null;
      }

      const place = await transaction.place.findFirst({
        where: { id: placeId, kind: 'CUSTOM', ownerId: userId },
        include: { providerRefs: true },
      });

      return place ? toPlaceRecord(place) : null;
    });
  }
}

export class CanonicalPlacesService {
  constructor(private readonly repository: CanonicalPlaceRepository) {}

  async resolveProviderPlace(
    provider: PlaceProviderName,
    externalPlaceId: string,
    label?: ProviderPlaceLabel,
  ) {
    const normalizedExternalPlaceId = externalPlaceId.trim();
    const existing = await this.repository.findByProviderRef(provider, normalizedExternalPlaceId);

    if (existing) {
      return serializePlace(await this.withLabel(existing, label));
    }

    try {
      const created = await this.repository.createProviderPlace(
        provider,
        normalizedExternalPlaceId,
        label,
      );
      return serializePlace(created);
    } catch (error) {
      if (!(error instanceof ProviderReferenceConflictError)) {
        throw error;
      }

      const concurrentlyCreated = await this.repository.findByProviderRef(
        provider,
        normalizedExternalPlaceId,
      );
      if (!concurrentlyCreated) {
        throw error;
      }
      return serializePlace(await this.withLabel(concurrentlyCreated, label));
    }
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
