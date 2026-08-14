import type { SupabaseClient } from '@supabase/supabase-js';
import { getPrismaClient, type Prisma } from '@trove/db';

import { formatLocalTime, parseLocalTime } from './itinerary-rules.js';
import {
  describeCapturedLocalChange,
  deriveCapturedLocal,
  resolveMemoryTimeZone,
} from './memories-rules.js';
import { createAuthenticatedSupabaseClient } from './supabase-auth.js';
import { formatDateOnly } from './trip-rules.js';

/**
 * Memories are private and user-owned (PRD section 31).
 *
 * Photos live in a dedicated Supabase Storage bucket keyed by owner, trip, and
 * Memory. Provider imagery is never copied here: Google photos stay provider
 * references resolved on demand, and only files the traveller uploaded become
 * Memory media.
 */
export const MEMORY_PHOTOS_BUCKET = 'memory-photos';

const allowedPhotoTypes = new Set(['image/heic', 'image/jpeg', 'image/png', 'image/webp']);
const maxPhotoSize = 15 * 1024 * 1024;
const maxNoteLength = 2000;

export class MemoryNotFoundError extends Error {
  constructor(
    public readonly code:
      | 'itinerary_day_not_found'
      | 'itinerary_item_not_found'
      | 'memory_not_found'
      | 'memory_photo_not_found'
      | 'trip_not_found'
      | 'trip_place_not_found',
  ) {
    super(code);
  }
}

export class MemoryValidationError extends Error {
  constructor(public readonly code: 'invalid_memory' | 'invalid_memory_photo') {
    super(code);
  }
}

export type MemoryContextInput = {
  itineraryDayId?: string | null;
  itineraryItemId?: string | null;
  tripPlaceId?: string | null;
};

export type MemoryInput = MemoryContextInput & {
  capturedAt?: string;
  isHighlight?: boolean;
  note?: string | null;
};

const memoryInclude = {
  itineraryDay: { select: { date: true, id: true } },
  itineraryItem: { select: { customLabel: true, id: true } },
  photos: { orderBy: { position: 'asc' } },
  tripPlace: { select: { id: true, place: { select: { customName: true, id: true } } } },
} as const;

type MemoryRecord = Prisma.MemoryGetPayload<{ include: typeof memoryInclude }>;

function memoryPhotoPath(userId: string, tripId: string, memoryId: string) {
  return `${userId}/${tripId}/${memoryId}/`;
}

function mapTimeZoneSource(value: string) {
  const values: Record<string, string> = {
    ITINERARY_DAY: 'itinerary_day',
    ITINERARY_ITEM: 'itinerary_item',
    TRIP_PLACE: 'trip_place',
    TRIP_REFERENCE: 'trip_reference',
  };
  return values[value] ?? 'trip_reference';
}

async function findOwnedTrip(
  transaction: Prisma.TransactionClient,
  userId: string,
  tripId: string,
) {
  const trip = await transaction.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    select: { id: true, referenceTimeZone: true },
  });
  if (!trip) throw new MemoryNotFoundError('trip_not_found');
  return trip;
}

/**
 * Resolves the optional day, item, and Place references and the timezone they
 * imply. Each reference must belong to the same trip, so a Memory can never
 * point at another trip's context.
 */
async function resolveContext(
  transaction: Prisma.TransactionClient,
  tripId: string,
  tripTimeZone: string,
  context: Required<MemoryContextInput>,
) {
  const [day, item, tripPlace] = await Promise.all([
    context.itineraryDayId
      ? transaction.itineraryDay.findFirst({
          where: { id: context.itineraryDayId, tripId },
          select: { defaultTimeZone: true, id: true },
        })
      : null,
    context.itineraryItemId
      ? transaction.itineraryItem.findFirst({
          where: { id: context.itineraryItemId, tripId },
          select: { id: true, timeZone: true },
        })
      : null,
    context.tripPlaceId
      ? transaction.tripPlace.findFirst({
          where: { id: context.tripPlaceId, tripId },
          select: { id: true, place: { select: { customTimeZone: true } } },
        })
      : null,
  ]);

  if (context.itineraryDayId && !day) throw new MemoryNotFoundError('itinerary_day_not_found');
  if (context.itineraryItemId && !item) throw new MemoryNotFoundError('itinerary_item_not_found');
  if (context.tripPlaceId && !tripPlace) throw new MemoryNotFoundError('trip_place_not_found');

  return resolveMemoryTimeZone({
    itineraryDayTimeZone: day?.defaultTimeZone ?? null,
    itineraryItemTimeZone: item?.timeZone ?? null,
    tripPlaceTimeZone: tripPlace?.place.customTimeZone ?? null,
    tripTimeZone,
  });
}

function parseNote(note: string | null | undefined) {
  if (note === undefined) return undefined;
  const trimmed = note?.trim() ?? '';
  if (trimmed.length > maxNoteLength) throw new MemoryValidationError('invalid_memory');
  return trimmed ? trimmed : null;
}

function parseCapturedAt(value: string | undefined) {
  if (value === undefined) return undefined;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new MemoryValidationError('invalid_memory');
  return instant;
}

async function createPhotoUrl(supabase: SupabaseClient | null, path: string) {
  if (!supabase) return null;
  const { data, error } = await supabase.storage
    .from(MEMORY_PHOTOS_BUCKET)
    .createSignedUrl(path, 60 * 60);
  return error ? null : data.signedUrl;
}

async function serializeMemory(memory: MemoryRecord, supabase: SupabaseClient | null) {
  return {
    capturedAt: memory.capturedInstant.toISOString(),
    capturedLocalDate: formatDateOnly(memory.capturedLocalDate),
    capturedLocalTime: formatLocalTime(memory.capturedLocalTime),
    createdAt: memory.createdAt.toISOString(),
    id: memory.id,
    isHighlight: memory.isHighlight,
    itineraryDay: memory.itineraryDay
      ? { date: formatDateOnly(memory.itineraryDay.date), id: memory.itineraryDay.id }
      : null,
    itineraryItem: memory.itineraryItem
      ? { id: memory.itineraryItem.id, label: memory.itineraryItem.customLabel }
      : null,
    note: memory.note,
    photos: await Promise.all(
      memory.photos.map(async (photo) => ({
        contentType: photo.contentType,
        createdAt: photo.createdAt.toISOString(),
        fileName: photo.fileName,
        id: photo.id,
        position: photo.position,
        sizeBytes: photo.sizeBytes,
        url: await createPhotoUrl(supabase, photo.path),
      })),
    ),
    timeZone: memory.timeZone,
    timeZoneSource: mapTimeZoneSource(memory.timeZoneSource),
    tripPlace: memory.tripPlace
      ? { id: memory.tripPlace.id, name: memory.tripPlace.place.customName }
      : null,
    updatedAt: memory.updatedAt.toISOString(),
  };
}

export async function listMemories(userId: string, tripId: string, accessToken: string | null) {
  const prisma = getPrismaClient();
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    select: { id: true },
  });
  if (!trip) throw new MemoryNotFoundError('trip_not_found');

  const memories = await prisma.memory.findMany({
    where: { tripId },
    include: memoryInclude,
    orderBy: [{ capturedInstant: 'asc' }, { createdAt: 'asc' }],
  });
  const supabase = accessToken ? createAuthenticatedSupabaseClient(accessToken) : null;

  return {
    memories: await Promise.all(memories.map((memory) => serializeMemory(memory, supabase))),
  };
}

export async function createMemory(
  userId: string,
  tripId: string,
  input: MemoryInput,
  accessToken: string | null,
) {
  const note = parseNote(input.note);
  const capturedInstant = parseCapturedAt(input.capturedAt) ?? new Date();
  const prisma = getPrismaClient();

  const created = await prisma.$transaction(async (transaction) => {
    const trip = await findOwnedTrip(transaction, userId, tripId);
    const timeZone = await resolveContext(transaction, tripId, trip.referenceTimeZone, {
      itineraryDayId: input.itineraryDayId ?? null,
      itineraryItemId: input.itineraryItemId ?? null,
      tripPlaceId: input.tripPlaceId ?? null,
    });
    const local = deriveCapturedLocal(capturedInstant, timeZone.timeZone);

    return transaction.memory.create({
      data: {
        capturedInstant,
        capturedLocalDate: new Date(`${local.date}T00:00:00.000Z`),
        capturedLocalTime: parseLocalTime(local.time),
        isHighlight: input.isHighlight ?? false,
        itineraryDayId: input.itineraryDayId ?? null,
        itineraryItemId: input.itineraryItemId ?? null,
        note: note ?? null,
        timeZone: timeZone.timeZone,
        timeZoneSource: timeZone.source,
        tripId,
        tripPlaceId: input.tripPlaceId ?? null,
      },
      include: memoryInclude,
    });
  });

  const supabase = accessToken ? createAuthenticatedSupabaseClient(accessToken) : null;
  return serializeMemory(created, supabase);
}

/**
 * Only an explicit correction of the Memory's own time, day, item, or Place
 * re-resolves its timezone. When that correction moves the Memory to another
 * calendar day the result says so, rather than letting it move silently.
 */
export async function updateMemory(
  userId: string,
  tripId: string,
  memoryId: string,
  input: MemoryInput,
  accessToken: string | null,
) {
  const note = parseNote(input.note);
  const capturedInstant = parseCapturedAt(input.capturedAt);
  const prisma = getPrismaClient();

  const result = await prisma.$transaction(async (transaction) => {
    const trip = await findOwnedTrip(transaction, userId, tripId);
    const current = await transaction.memory.findFirst({ where: { id: memoryId, tripId } });
    if (!current) throw new MemoryNotFoundError('memory_not_found');

    const context = {
      itineraryDayId:
        input.itineraryDayId === undefined ? current.itineraryDayId : input.itineraryDayId,
      itineraryItemId:
        input.itineraryItemId === undefined ? current.itineraryItemId : input.itineraryItemId,
      tripPlaceId: input.tripPlaceId === undefined ? current.tripPlaceId : input.tripPlaceId,
    };
    const contextCorrected =
      context.itineraryDayId !== current.itineraryDayId ||
      context.itineraryItemId !== current.itineraryItemId ||
      context.tripPlaceId !== current.tripPlaceId ||
      capturedInstant !== undefined;

    const timeZone = contextCorrected
      ? await resolveContext(transaction, tripId, trip.referenceTimeZone, context)
      : { source: current.timeZoneSource, timeZone: current.timeZone };
    const instant = capturedInstant ?? current.capturedInstant;
    const change = describeCapturedLocalChange(
      instant,
      { timeZone: current.timeZone },
      { timeZone: timeZone.timeZone },
    );
    const local = deriveCapturedLocal(instant, timeZone.timeZone);

    const memory = await transaction.memory.update({
      where: { id: current.id },
      data: {
        ...(contextCorrected
          ? {
              capturedInstant: instant,
              capturedLocalDate: new Date(`${local.date}T00:00:00.000Z`),
              capturedLocalTime: parseLocalTime(local.time),
              itineraryDayId: context.itineraryDayId,
              itineraryItemId: context.itineraryItemId,
              timeZone: timeZone.timeZone,
              timeZoneSource: timeZone.source,
              tripPlaceId: context.tripPlaceId,
            }
          : {}),
        ...(input.isHighlight === undefined ? {} : { isHighlight: input.isHighlight }),
        ...(note === undefined ? {} : { note }),
      },
      include: memoryInclude,
    });

    return { localDateChanged: contextCorrected && change.localDateChanged, memory };
  });

  const supabase = accessToken ? createAuthenticatedSupabaseClient(accessToken) : null;
  return {
    localDateChanged: result.localDateChanged,
    memory: await serializeMemory(result.memory, supabase),
  };
}

/** Removes the Memory and its own media only; trip, day, item, and Place remain. */
export async function deleteMemory(
  userId: string,
  tripId: string,
  memoryId: string,
  accessToken: string | null,
) {
  const prisma = getPrismaClient();
  const paths = await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    const memory = await transaction.memory.findFirst({
      where: { id: memoryId, tripId },
      include: { photos: { select: { path: true } } },
    });
    if (!memory) throw new MemoryNotFoundError('memory_not_found');
    await transaction.memory.delete({ where: { id: memory.id } });
    return memory.photos.map((photo) => photo.path);
  });

  const supabase = accessToken ? createAuthenticatedSupabaseClient(accessToken) : null;
  if (supabase && paths.length) await supabase.storage.from(MEMORY_PHOTOS_BUCKET).remove(paths);
}

export async function addMemoryPhoto(
  userId: string,
  tripId: string,
  memoryId: string,
  input: { contentType: string; fileName: string; path: string; sizeBytes: number },
  accessToken: string | null,
) {
  if (
    !allowedPhotoTypes.has(input.contentType) ||
    input.sizeBytes < 0 ||
    input.sizeBytes > maxPhotoSize ||
    !input.fileName.trim() ||
    input.path.includes('..') ||
    !input.path.startsWith(memoryPhotoPath(userId, tripId, memoryId))
  ) {
    throw new MemoryValidationError('invalid_memory_photo');
  }

  const prisma = getPrismaClient();
  const photo = await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    const memory = await transaction.memory.findFirst({ where: { id: memoryId, tripId } });
    if (!memory) throw new MemoryNotFoundError('memory_not_found');

    const last = await transaction.memoryPhoto.aggregate({
      where: { memoryId },
      _max: { position: true },
    });

    return transaction.memoryPhoto.create({
      data: {
        contentType: input.contentType,
        fileName: input.fileName.trim(),
        memoryId,
        path: input.path,
        position: (last._max.position ?? -1) + 1,
        sizeBytes: input.sizeBytes,
      },
    });
  });

  const supabase = accessToken ? createAuthenticatedSupabaseClient(accessToken) : null;
  return {
    contentType: photo.contentType,
    createdAt: photo.createdAt.toISOString(),
    fileName: photo.fileName,
    id: photo.id,
    position: photo.position,
    sizeBytes: photo.sizeBytes,
    url: await createPhotoUrl(supabase, photo.path),
  };
}

/** Deleting one photo leaves the Memory and every other record untouched. */
export async function deleteMemoryPhoto(
  userId: string,
  tripId: string,
  memoryId: string,
  photoId: string,
  accessToken: string | null,
) {
  const prisma = getPrismaClient();
  const path = await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    const photo = await transaction.memoryPhoto.findFirst({
      where: { id: photoId, memory: { id: memoryId, tripId } },
    });
    if (!photo) throw new MemoryNotFoundError('memory_photo_not_found');
    await transaction.memoryPhoto.delete({ where: { id: photo.id } });
    return photo.path;
  });

  const supabase = accessToken ? createAuthenticatedSupabaseClient(accessToken) : null;
  if (supabase) await supabase.storage.from(MEMORY_PHOTOS_BUCKET).remove([path]);
}
