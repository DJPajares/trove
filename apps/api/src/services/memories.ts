import type { SupabaseClient } from '@supabase/supabase-js';
import { getPrismaClient, type Prisma } from '@trove/db';

import { floatingLocalTimeToInstant, formatLocalTime, parseLocalTime } from './itinerary-rules.js';
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
  /** A same-timezone correction: the captured wall time, resolved with the Memory's timezone. */
  capturedLocalDate?: string;
  capturedLocalTime?: string;
  isHighlight?: boolean;
  note?: string | null;
};

const memoryInclude = {
  itineraryDay: { select: { date: true, id: true } },
  itineraryItem: { select: { customLabel: true, id: true } },
  photos: { orderBy: { position: 'asc' } },
  tripPlace: {
    select: {
      id: true,
      place: {
        select: {
          customName: true,
          id: true,
          kind: true,
          providerRefs: { select: { externalPlaceId: true, provider: true } },
        },
      },
    },
  },
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

/** A same-timezone correction: `date`/`time` must arrive together or not at all. */
function parseLocalCorrection(input: Pick<MemoryInput, 'capturedLocalDate' | 'capturedLocalTime'>) {
  const has = input.capturedLocalDate !== undefined || input.capturedLocalTime !== undefined;
  if (!has) return undefined;
  if (!input.capturedLocalDate || !input.capturedLocalTime) {
    throw new MemoryValidationError('invalid_memory');
  }
  return { date: input.capturedLocalDate, time: input.capturedLocalTime };
}

function resolveCapturedInstant(
  local: { date: string; time: string } | undefined,
  timeZone: string,
  fallback: Date,
) {
  if (!local) return fallback;
  try {
    return floatingLocalTimeToInstant(local.date, local.time, timeZone);
  } catch {
    throw new MemoryValidationError('invalid_memory');
  }
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
    highlightPosition: memory.highlightPosition,
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
    // Provider names stay provider-owned: only the reference travels, so a story
    // can resolve the current name on demand rather than storing a stale copy.
    tripPlace: memory.tripPlace
      ? {
          id: memory.tripPlace.id,
          kind:
            memory.tripPlace.place.kind === 'CUSTOM' ? ('custom' as const) : ('provider' as const),
          name: memory.tripPlace.place.customName,
          placeId: memory.tripPlace.place.id,
          providerRefs: memory.tripPlace.place.providerRefs.map((reference) => ({
            externalPlaceId: reference.externalPlaceId,
            provider: 'google' as const,
          })),
        }
      : null,
    updatedAt: memory.updatedAt.toISOString(),
  };
}

async function serializeStoryCover(
  trip: { storyCoverPhoto: { id: string; path: string } | null },
  supabase: SupabaseClient | null,
) {
  if (!trip.storyCoverPhoto) return null;
  return {
    photoId: trip.storyCoverPhoto.id,
    url: await createPhotoUrl(supabase, trip.storyCoverPhoto.path),
  };
}

export async function listMemories(userId: string, tripId: string, accessToken: string | null) {
  const prisma = getPrismaClient();
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    select: { id: true, storyCoverPhoto: { select: { id: true, path: true } } },
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
    storyCover: await serializeStoryCover(trip, supabase),
  };
}

/**
 * A capture queued offline replays with the id it was given on the device, so a
 * retried or interrupted sync resolves to the same Memory instead of a second one.
 */
export async function createMemory(
  userId: string,
  tripId: string,
  input: MemoryInput,
  accessToken: string | null,
  clientMemoryId?: string,
) {
  const note = parseNote(input.note);
  const explicitInstant = parseCapturedAt(input.capturedAt);
  const localCorrection = parseLocalCorrection(input);
  const prisma = getPrismaClient();

  const created = await prisma.$transaction(async (transaction) => {
    const trip = await findOwnedTrip(transaction, userId, tripId);
    if (clientMemoryId) {
      const existing = await transaction.memory.findFirst({
        where: { id: clientMemoryId, tripId },
        include: memoryInclude,
      });
      if (existing) return existing;
    }
    const timeZone = await resolveContext(transaction, tripId, trip.referenceTimeZone, {
      itineraryDayId: input.itineraryDayId ?? null,
      itineraryItemId: input.itineraryItemId ?? null,
      tripPlaceId: input.tripPlaceId ?? null,
    });
    // A missing Memory added after travel can be dated to when it actually
    // happened; live capture leaves both unset and simply uses now.
    const capturedInstant = resolveCapturedInstant(
      localCorrection,
      timeZone.timeZone,
      explicitInstant ?? new Date(),
    );
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
        ...(clientMemoryId ? { id: clientMemoryId } : {}),
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
  const localCorrection = parseLocalCorrection(input);
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
      capturedInstant !== undefined ||
      localCorrection !== undefined;

    const timeZone = contextCorrected
      ? await resolveContext(transaction, tripId, trip.referenceTimeZone, context)
      : { source: current.timeZoneSource, timeZone: current.timeZone };

    // A local-time correction is resolved in whichever timezone applies after any
    // day/item/Place correction above, so both can be fixed in the same save.
    const instant = resolveCapturedInstant(
      localCorrection,
      timeZone.timeZone,
      capturedInstant ?? current.capturedInstant,
    );

    const change = describeCapturedLocalChange(
      instant,
      { timeZone: current.timeZone },
      { timeZone: timeZone.timeZone },
    );
    const local = deriveCapturedLocal(instant, timeZone.timeZone);

    // Newly marked highlights join at the end of the curated order; removing a
    // Memory from Highlights drops its position so it does not linger unseen.
    let highlightPosition: number | null | undefined;
    if (input.isHighlight === true && !current.isHighlight) {
      const last = await transaction.memory.aggregate({
        where: { tripId, isHighlight: true },
        _max: { highlightPosition: true },
      });
      highlightPosition = (last._max.highlightPosition ?? -1) + 1;
    } else if (input.isHighlight === false && current.isHighlight) {
      highlightPosition = null;
    }

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
        ...(highlightPosition === undefined ? {} : { highlightPosition }),
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

    // A retried upload re-registers the same stored object rather than a duplicate.
    const existing = await transaction.memoryPhoto.findFirst({
      where: { memoryId, path: input.path },
    });
    if (existing) return existing;

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

/**
 * The Highlights view can carry its own curated order, distinct from the
 * chronological order Days always uses. The caller supplies the complete
 * highlighted set so the result is unambiguous; a partial or stale list is
 * rejected rather than silently dropping a Memory from Highlights.
 */
export async function reorderHighlights(
  userId: string,
  tripId: string,
  order: string[],
  accessToken: string | null,
) {
  if (new Set(order).size !== order.length) throw new MemoryValidationError('invalid_memory');

  const prisma = getPrismaClient();
  await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    const current = await transaction.memory.findMany({
      where: { tripId, isHighlight: true },
      select: { id: true },
    });
    const currentIds = new Set(current.map((memory) => memory.id));
    if (currentIds.size !== order.length || order.some((id) => !currentIds.has(id))) {
      throw new MemoryValidationError('invalid_memory');
    }
    await Promise.all(
      order.map((id, position) =>
        transaction.memory.update({ where: { id }, data: { highlightPosition: position } }),
      ),
    );
  });

  return listMemories(userId, tripId, accessToken);
}

/** Reorders one Memory's own photos; every other Memory's photos are untouched. */
export async function reorderMemoryPhotos(
  userId: string,
  tripId: string,
  memoryId: string,
  order: string[],
  accessToken: string | null,
) {
  if (new Set(order).size !== order.length) throw new MemoryValidationError('invalid_memory_photo');

  const prisma = getPrismaClient();
  const memory = await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    const current = await transaction.memory.findFirst({
      where: { id: memoryId, tripId },
      include: { photos: { select: { id: true } } },
    });
    if (!current) throw new MemoryNotFoundError('memory_not_found');
    const currentIds = new Set(current.photos.map((photo) => photo.id));
    if (currentIds.size !== order.length || order.some((id) => !currentIds.has(id))) {
      throw new MemoryValidationError('invalid_memory_photo');
    }
    await Promise.all(
      order.map((id, position) =>
        transaction.memoryPhoto.update({ where: { id }, data: { position } }),
      ),
    );
    return transaction.memory.findFirstOrThrow({ where: { id: memoryId }, include: memoryInclude });
  });

  const supabase = accessToken ? createAuthenticatedSupabaseClient(accessToken) : null;
  return serializeMemory(memory, supabase);
}

/**
 * The Trip Story cover is chosen from the traveller's own Memory photos, never
 * uploaded separately. Clearing it (`null`) removes the story's cover without
 * touching the Memory or photo it pointed at.
 */
export async function setStoryCoverPhoto(
  userId: string,
  tripId: string,
  memoryPhotoId: string | null,
  accessToken: string | null,
) {
  const prisma = getPrismaClient();
  const trip = await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    if (memoryPhotoId) {
      const photo = await transaction.memoryPhoto.findFirst({
        where: { id: memoryPhotoId, memory: { tripId } },
      });
      if (!photo) throw new MemoryNotFoundError('memory_photo_not_found');
    }
    return transaction.trip.update({
      where: { id: tripId },
      data: { storyCoverMemoryPhotoId: memoryPhotoId },
      select: { storyCoverPhoto: { select: { id: true, path: true } } },
    });
  });

  const supabase = accessToken ? createAuthenticatedSupabaseClient(accessToken) : null;
  return serializeStoryCover(trip, supabase);
}
