import { getPrismaClient } from '@trove/db';

import type { CanonicalPlace } from './canonical-places.js';
import {
  placeProviderRefInclude,
  serializeCanonicalPlace as serializePlace,
} from './place-serializer.js';
import { removeOwnedSavedPlace } from './saved-place-removal.js';

export type SavedPlace = {
  collections: Array<{ id: string; name: string }>;
  createdAt: string;
  id: string;
  note: string | null;
  place: CanonicalPlace;
};

export type SavedCollection = {
  id: string;
  name: string;
  placeCount: number;
};

export class SavedPlaceNotFoundError extends Error {
  constructor() {
    super('saved_place_not_found');
  }
}

export class SavedCollectionNameConflictError extends Error {
  constructor() {
    super('saved_collection_name_conflict');
  }
}

export class SavedCollectionNotFoundError extends Error {
  constructor() {
    super('saved_collection_not_found');
  }
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function normalizeNote(note: string | null | undefined) {
  return note?.trim() || null;
}

function serializeSavedPlace(savedPlace: {
  collectionLinks: Array<{ collection: { id: string; name: string } }>;
  createdAt: Date;
  id: string;
  note: string | null;
  place: Parameters<typeof serializePlace>[0];
}): SavedPlace {
  return {
    collections: savedPlace.collectionLinks
      .map((link) => link.collection)
      .toSorted((left, right) => left.name.localeCompare(right.name)),
    createdAt: savedPlace.createdAt.toISOString(),
    id: savedPlace.id,
    note: savedPlace.note,
    place: serializePlace(savedPlace.place),
  };
}

async function ensureProfile(userId: string) {
  await getPrismaClient().profile.upsert({
    where: { id: userId },
    create: { id: userId },
    update: {},
  });
}

const savedPlaceInclude = {
  collectionLinks: { include: { collection: true } },
  place: { include: placeProviderRefInclude },
} as const;

export async function listSavedPlaces(userId: string) {
  const [savedPlaces, collections] = await Promise.all([
    getPrismaClient().savedPlace.findMany({
      where: { ownerId: userId },
      include: savedPlaceInclude,
      orderBy: { createdAt: 'desc' },
    }),
    getPrismaClient().savedCollection.findMany({
      where: { ownerId: userId },
      include: { _count: { select: { places: true } } },
      orderBy: { name: 'asc' },
    }),
  ]);

  return {
    collections: collections.map((collection) => ({
      id: collection.id,
      name: collection.name,
      placeCount: collection._count.places,
    })),
    savedPlaces: savedPlaces.map(serializeSavedPlace),
  };
}

export async function savePlace(userId: string, placeId: string) {
  const prisma = getPrismaClient();
  await ensureProfile(userId);

  const place = await prisma.place.findFirst({
    where: {
      id: placeId,
      OR: [{ kind: 'PROVIDER' }, { kind: 'CUSTOM', ownerId: userId }],
    },
    select: { id: true },
  });

  if (!place) {
    throw new SavedPlaceNotFoundError();
  }

  const savedPlace = await prisma.savedPlace.upsert({
    where: { ownerId_placeId: { ownerId: userId, placeId: place.id } },
    create: { ownerId: userId, placeId: place.id },
    update: {},
    include: savedPlaceInclude,
  });

  return serializeSavedPlace(savedPlace);
}

export async function updateSavedPlaceNote(
  userId: string,
  savedPlaceId: string,
  note: string | null,
) {
  const prisma = getPrismaClient();
  const result = await prisma.savedPlace.updateMany({
    where: { id: savedPlaceId, ownerId: userId },
    data: { note: normalizeNote(note) },
  });

  if (result.count === 0) {
    throw new SavedPlaceNotFoundError();
  }

  const savedPlace = await prisma.savedPlace.findFirst({
    where: { id: savedPlaceId, ownerId: userId },
    include: savedPlaceInclude,
  });

  if (!savedPlace) {
    throw new SavedPlaceNotFoundError();
  }

  return serializeSavedPlace(savedPlace);
}

export async function unsavePlace(userId: string, savedPlaceId: string) {
  const removed = await removeOwnedSavedPlace(getPrismaClient().savedPlace, userId, savedPlaceId);

  if (!removed) {
    throw new SavedPlaceNotFoundError();
  }
}

export async function createSavedCollection(userId: string, name: string) {
  await ensureProfile(userId);

  try {
    const collection = await getPrismaClient().savedCollection.create({
      data: { name: name.trim(), ownerId: userId },
      include: { _count: { select: { places: true } } },
    });

    return { id: collection.id, name: collection.name, placeCount: collection._count.places };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new SavedCollectionNameConflictError();
    }
    throw error;
  }
}

export async function renameSavedCollection(userId: string, collectionId: string, name: string) {
  try {
    const result = await getPrismaClient().savedCollection.updateMany({
      where: { id: collectionId, ownerId: userId },
      data: { name: name.trim() },
    });

    if (result.count === 0) {
      throw new SavedCollectionNotFoundError();
    }

    const collection = await getPrismaClient().savedCollection.findFirst({
      where: { id: collectionId, ownerId: userId },
      include: { _count: { select: { places: true } } },
    });

    if (!collection) {
      throw new SavedCollectionNotFoundError();
    }

    return { id: collection.id, name: collection.name, placeCount: collection._count.places };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new SavedCollectionNameConflictError();
    }
    throw error;
  }
}

export async function removeSavedCollection(userId: string, collectionId: string) {
  const result = await getPrismaClient().savedCollection.deleteMany({
    where: { id: collectionId, ownerId: userId },
  });

  if (result.count === 0) {
    throw new SavedCollectionNotFoundError();
  }
}

async function ensureCollectionLinkTargets(
  userId: string,
  savedPlaceId: string,
  collectionId: string,
) {
  const prisma = getPrismaClient();
  const [savedPlace, collection] = await Promise.all([
    prisma.savedPlace.findFirst({
      where: { id: savedPlaceId, ownerId: userId },
      select: { id: true },
    }),
    prisma.savedCollection.findFirst({
      where: { id: collectionId, ownerId: userId },
      select: { id: true },
    }),
  ]);

  if (!savedPlace) {
    throw new SavedPlaceNotFoundError();
  }
  if (!collection) {
    throw new SavedCollectionNotFoundError();
  }
}

export async function addSavedPlaceToCollection(
  userId: string,
  savedPlaceId: string,
  collectionId: string,
) {
  await ensureCollectionLinkTargets(userId, savedPlaceId, collectionId);
  await getPrismaClient().savedCollectionPlace.upsert({
    where: { collectionId_savedPlaceId: { collectionId, savedPlaceId } },
    create: { collectionId, ownerId: userId, savedPlaceId },
    update: {},
  });
}

export async function removeSavedPlaceFromCollection(
  userId: string,
  savedPlaceId: string,
  collectionId: string,
) {
  await ensureCollectionLinkTargets(userId, savedPlaceId, collectionId);
  await getPrismaClient().savedCollectionPlace.deleteMany({
    where: { collectionId, ownerId: userId, savedPlaceId },
  });
}
