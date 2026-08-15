import type { SupabaseClient } from '@supabase/supabase-js';
import { getPrismaClient, type Prisma } from '@trove/db';

import { MEMORY_PHOTOS_BUCKET } from './memories.js';
import { createAuthenticatedSupabaseClient } from './supabase-auth.js';
import {
  deriveTripLifecycle,
  enumerateDateRange,
  formatDateOnly,
  getDateRangeChanges,
  isValidIanaTimeZone,
  parseDateOnly,
  resolveTripTimeZone,
} from './trip-rules.js';

export const TRIP_COVERS_BUCKET = 'trip-covers';

export type TripDestinationInput = { name: string };

export type TripCreate = {
  coverPhotoPath?: string | null;
  destinations?: TripDestinationInput[];
  deviceTimeZone?: string;
  endDate: string;
  name: string;
  notes?: string | null;
  partySize?: number;
  planningReadiness?: 'in_progress' | 'ready';
  referenceTimeZone?: string | null;
  startDate: string;
  startingLocation?: string | null;
};

export type TripUpdate = Partial<TripCreate> & { confirmDateShrink?: boolean };

export class TripNotFoundError extends Error {
  constructor() {
    super('trip_not_found');
  }
}

export class TripValidationError extends Error {
  constructor(public readonly code: 'invalid_date' | 'invalid_date_range' | 'invalid_time_zone') {
    super(code);
  }
}

export class TripDateShrinkConfirmationError extends Error {
  constructor(public readonly affectedItemCount: number) {
    super('trip_date_shrink_confirmation_required');
  }
}

const tripInclude = {
  // Lets completed-trip surfaces offer Memories only when there are some to open.
  _count: { select: { memories: true } },
  destinations: { include: { place: true }, orderBy: { position: 'asc' as const } },
  owner: { include: { homePlace: true } },
  startingPlace: true,
} as const;

type TripRecord = Awaited<ReturnType<typeof findOwnedTrip>>;

function mapReadiness(value: string) {
  return value === 'READY' ? ('ready' as const) : ('in_progress' as const);
}

function mapTimeZoneSource(value: string) {
  const values: Record<string, string> = {
    DESTINATION: 'destination',
    DEVICE_FALLBACK: 'device_fallback',
    EXPLICIT: 'explicit',
    PROFILE_HOME: 'profile_home',
    STARTING_LOCATION: 'starting_location',
  };

  return values[value] ?? 'device_fallback';
}

async function createCoverUrl(supabase: SupabaseClient | null, coverPhotoPath: string | null) {
  if (!supabase || !coverPhotoPath) return null;

  const { data, error } = await supabase.storage
    .from(TRIP_COVERS_BUCKET)
    .createSignedUrl(coverPhotoPath, 60 * 60);

  return error ? null : data.signedUrl;
}

async function serializeTrip(
  trip: NonNullable<TripRecord>,
  supabase: SupabaseClient | null,
  now = new Date(),
) {
  const startDate = formatDateOnly(trip.startDate);
  const endDate = formatDateOnly(trip.endDate);
  const effectiveStartingPlace = trip.startingPlace ?? trip.owner.homePlace;

  return {
    coverPhotoPath: trip.coverPhotoPath,
    coverPhotoUrl: await createCoverUrl(supabase, trip.coverPhotoPath),
    createdAt: trip.createdAt.toISOString(),
    destinations: trip.destinations.map((destination) => ({
      id: destination.id,
      name: destination.place.customName ?? '',
      placeId: destination.placeId,
      position: destination.position,
      timeZone: destination.timeZone,
    })),
    endDate,
    experienceNote: trip.experienceNote,
    experienceRating: trip.experienceRating,
    id: trip.id,
    lifecycle: deriveTripLifecycle(startDate, endDate, trip.referenceTimeZone, now),
    memoryCount: trip._count.memories,
    name: trip.name,
    notes: trip.notes,
    partySize: trip.partySize,
    planningReadiness: mapReadiness(trip.planningReadiness),
    referenceTimeZone: trip.referenceTimeZone,
    referenceTimeZoneSource: mapTimeZoneSource(trip.referenceTimeZoneSource),
    startDate,
    startingLocation: effectiveStartingPlace
      ? {
          isOverride: Boolean(trip.startingPlace),
          name: effectiveStartingPlace.customName ?? '',
          placeId: effectiveStartingPlace.id,
        }
      : null,
    startingLocationOverride: trip.startingPlace?.customName ?? null,
    updatedAt: trip.updatedAt.toISOString(),
  };
}

async function findOwnedTrip(userId: string, tripId: string) {
  return getPrismaClient().trip.findFirst({
    where: { id: tripId, ownerId: userId },
    include: tripInclude,
  });
}

function normalizeTripDates(startDate: string, endDate: string) {
  try {
    const start = parseDateOnly(startDate);
    const end = parseDateOnly(endDate);

    if (end < start) throw new TripValidationError('invalid_date_range');
    return { end, start };
  } catch (error) {
    if (error instanceof TripValidationError) throw error;
    throw new TripValidationError('invalid_date');
  }
}

function assertTimeZone(timeZone: string | null | undefined) {
  if (timeZone === undefined || timeZone === null) return;
  if (!isValidIanaTimeZone(timeZone)) throw new TripValidationError('invalid_time_zone');
}

async function findOrCreateCustomPlace(
  transaction: Prisma.TransactionClient,
  userId: string,
  name: string,
) {
  const customName = name.trim();
  const existing = await transaction.place.findFirst({
    where: {
      customName: { equals: customName, mode: 'insensitive' },
      kind: 'CUSTOM',
      ownerId: userId,
    },
  });

  return (
    existing ??
    (await transaction.place.create({
      data: { customName, kind: 'CUSTOM', ownerId: userId },
    }))
  );
}

function toTimeZoneCandidate(place: { customTimeZone: string | null; id: string } | null) {
  return place ? { placeId: place.id, timeZone: place.customTimeZone } : null;
}

export async function listTrips(userId: string, accessToken: string) {
  const trips = await getPrismaClient().trip.findMany({
    where: { ownerId: userId },
    include: tripInclude,
    orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
  });
  const supabase = createAuthenticatedSupabaseClient(accessToken);

  return Promise.all(trips.map((trip) => serializeTrip(trip, supabase)));
}

export async function getTrip(userId: string, accessToken: string, tripId: string) {
  const trip = await findOwnedTrip(userId, tripId);
  if (!trip) throw new TripNotFoundError();

  return serializeTrip(trip, createAuthenticatedSupabaseClient(accessToken));
}

export async function createTrip(userId: string, accessToken: string, input: TripCreate) {
  const prisma = getPrismaClient();
  const { end, start } = normalizeTripDates(input.startDate, input.endDate);
  assertTimeZone(input.referenceTimeZone);

  await prisma.profile.upsert({ where: { id: userId }, create: { id: userId }, update: {} });

  const tripId = await prisma.$transaction(async (transaction) => {
    const profile = await transaction.profile.findUniqueOrThrow({
      where: { id: userId },
      include: { homePlace: true },
    });
    const destinations = await Promise.all(
      (input.destinations ?? []).map((destination) =>
        findOrCreateCustomPlace(transaction, userId, destination.name),
      ),
    );
    const startingPlace = input.startingLocation?.trim()
      ? await findOrCreateCustomPlace(transaction, userId, input.startingLocation)
      : null;
    const timeZone = resolveTripTimeZone({
      destinations: destinations.map((place) => ({
        placeId: place.id,
        timeZone: place.customTimeZone,
      })),
      deviceTimeZone: input.deviceTimeZone ?? 'UTC',
      explicitTimeZone: input.referenceTimeZone,
      profileHome: toTimeZoneCandidate(profile.homePlace),
      startingLocation: toTimeZoneCandidate(startingPlace),
    });
    const trip = await transaction.trip.create({
      data: {
        coverPhotoPath: input.coverPhotoPath ?? null,
        creatorId: userId,
        endDate: end,
        name: input.name.trim(),
        notes: input.notes?.trim() || null,
        ownerId: userId,
        partySize: input.partySize ?? 1,
        planningReadiness: input.planningReadiness === 'ready' ? 'READY' : 'IN_PROGRESS',
        referenceTimeZone: timeZone.timeZone,
        referenceTimeZoneSource: timeZone.source,
        referenceTimeZoneSourcePlaceId: timeZone.sourcePlaceId,
        startDate: start,
        startingPlaceId: startingPlace?.id ?? null,
      },
    });

    if (destinations.length) {
      await transaction.tripDestination.createMany({
        data: destinations.map((place, position) => ({
          placeId: place.id,
          position,
          timeZone: place.customTimeZone,
          timeZoneResolvedAt: place.customTimeZone ? new Date() : null,
          tripId: trip.id,
        })),
      });
    }

    await transaction.itineraryDay.createMany({
      data: enumerateDateRange(input.startDate, input.endDate).map((date) => ({
        date: parseDateOnly(date),
        defaultTimeZone: timeZone.timeZone,
        defaultTimeZoneSource: 'TRIP_REFERENCE',
        tripId: trip.id,
      })),
    });

    return trip.id;
  });

  return getTrip(userId, accessToken, tripId);
}

export async function updateTrip(
  userId: string,
  accessToken: string,
  tripId: string,
  input: TripUpdate,
) {
  const prisma = getPrismaClient();
  assertTimeZone(input.referenceTimeZone);

  await prisma.$transaction(async (transaction) => {
    const current = await transaction.trip.findFirst({
      where: { id: tripId, ownerId: userId },
      include: tripInclude,
    });
    if (!current) throw new TripNotFoundError();

    const startDate = input.startDate ?? formatDateOnly(current.startDate);
    const endDate = input.endDate ?? formatDateOnly(current.endDate);
    const { end, start } = normalizeTripDates(startDate, endDate);
    const destinations = input.destinations
      ? await Promise.all(
          input.destinations.map((destination) =>
            findOrCreateCustomPlace(transaction, userId, destination.name),
          ),
        )
      : current.destinations.map((destination) => destination.place);
    const startingPlace =
      input.startingLocation === undefined
        ? current.startingPlace
        : input.startingLocation?.trim()
          ? await findOrCreateCustomPlace(transaction, userId, input.startingLocation)
          : null;
    const shouldResolveTimeZone =
      input.destinations !== undefined ||
      input.startingLocation !== undefined ||
      input.referenceTimeZone !== undefined;
    const timeZone = shouldResolveTimeZone
      ? resolveTripTimeZone({
          destinations: destinations.map((place) => ({
            placeId: place.id,
            timeZone: place.customTimeZone,
          })),
          deviceTimeZone:
            current.referenceTimeZoneSource === 'DEVICE_FALLBACK'
              ? current.referenceTimeZone
              : (input.deviceTimeZone ?? current.referenceTimeZone),
          explicitTimeZone: input.referenceTimeZone,
          profileHome: toTimeZoneCandidate(current.owner.homePlace),
          startingLocation: toTimeZoneCandidate(startingPlace),
        })
      : {
          source: current.referenceTimeZoneSource,
          sourcePlaceId: current.referenceTimeZoneSourcePlaceId,
          timeZone: current.referenceTimeZone,
        };

    const itineraryDays = await transaction.itineraryDay.findMany({
      where: { tripId },
      select: { id: true, date: true, _count: { select: { items: true } } },
    });
    const dateChanges = getDateRangeChanges(
      itineraryDays.map((day) => formatDateOnly(day.date)),
      startDate,
      endDate,
    );
    const removedDateSet = new Set(dateChanges.removedDates);
    const removedDays = itineraryDays.filter((day) => removedDateSet.has(formatDateOnly(day.date)));
    const affectedItemCount = removedDays.reduce((count, day) => count + day._count.items, 0);

    if (affectedItemCount > 0 && !input.confirmDateShrink) {
      throw new TripDateShrinkConfirmationError(affectedItemCount);
    }

    const removedDayIds = removedDays.map((day) => day.id);
    if (removedDayIds.length) {
      if (affectedItemCount > 0) {
        const [removedItems, unscheduledPositions] = await Promise.all([
          transaction.itineraryItem.findMany({
            where: { tripId, itineraryDayId: { in: removedDayIds } },
            select: { id: true, itineraryDay: { select: { date: true } }, position: true },
            orderBy: [{ itineraryDay: { date: 'asc' } }, { position: 'asc' }],
          }),
          transaction.itineraryItem.aggregate({
            where: { tripId, itineraryDayId: null },
            _max: { position: true },
          }),
        ]);
        const firstUnscheduledPosition = (unscheduledPositions._max.position ?? -1) + 1;

        for (const [index, item] of removedItems.entries()) {
          await transaction.itineraryItem.update({
            where: { id: item.id },
            data: {
              itineraryDayId: null,
              position: firstUnscheduledPosition + index,
            },
          });
        }
      }
      // Memories, tasks, and expenses outlive the day they were filed against;
      // detach before removal so a shorter trip never discards them.
      const detached = {
        data: { itineraryDayId: null },
        where: { itineraryDayId: { in: removedDayIds }, tripId },
      } as const;
      await transaction.memory.updateMany(detached);
      await transaction.task.updateMany(detached);
      await transaction.expense.updateMany(detached);
      await transaction.itineraryDay.deleteMany({ where: { id: { in: removedDayIds }, tripId } });
    }

    if (dateChanges.missingDates.length) {
      await transaction.itineraryDay.createMany({
        data: dateChanges.missingDates.map((date) => ({
          date: parseDateOnly(date),
          defaultTimeZone: timeZone.timeZone,
          defaultTimeZoneSource: 'TRIP_REFERENCE',
          tripId,
        })),
      });
    }

    if (input.destinations !== undefined) {
      await transaction.tripDestination.deleteMany({ where: { tripId } });
      if (destinations.length) {
        await transaction.tripDestination.createMany({
          data: destinations.map((place, position) => ({
            placeId: place.id,
            position,
            timeZone: place.customTimeZone,
            timeZoneResolvedAt: place.customTimeZone ? new Date() : null,
            tripId,
          })),
        });
      }
    }

    await transaction.trip.update({
      where: { id: tripId },
      data: {
        ...(input.coverPhotoPath !== undefined ? { coverPhotoPath: input.coverPhotoPath } : {}),
        endDate: end,
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
        ...(input.partySize !== undefined ? { partySize: input.partySize } : {}),
        ...(input.planningReadiness !== undefined
          ? { planningReadiness: input.planningReadiness === 'ready' ? 'READY' : 'IN_PROGRESS' }
          : {}),
        ...(shouldResolveTimeZone
          ? {
              referenceTimeZone: timeZone.timeZone,
              referenceTimeZoneResolvedAt: new Date(),
              referenceTimeZoneSource: timeZone.source,
              referenceTimeZoneSourcePlaceId: timeZone.sourcePlaceId,
            }
          : {}),
        startDate: start,
        ...(input.startingLocation !== undefined
          ? { startingPlaceId: startingPlace?.id ?? null }
          : {}),
      },
    });
  });

  return getTrip(userId, accessToken, tripId);
}

/**
 * Experience Rating is the traveller's own private reflection on how the trip
 * felt, entered independently of Plan Score's computed planning-quality signal
 * and of any provider/public Place rating (PRD section 30). The overall trip
 * rating is never derived from day ratings; each is set and cleared on its own.
 */
export async function updateTripExperienceRating(
  userId: string,
  accessToken: string,
  tripId: string,
  rating: number | null,
  note: string | null | undefined,
) {
  const prisma = getPrismaClient();
  const existing = await prisma.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    select: { id: true },
  });
  if (!existing) throw new TripNotFoundError();

  await prisma.trip.update({
    where: { id: tripId },
    data: {
      experienceRating: rating,
      ...(note === undefined ? {} : { experienceNote: note?.trim() || null }),
    },
  });

  return getTrip(userId, accessToken, tripId);
}

/** Storage removes a bounded number of objects per request. */
const STORAGE_REMOVE_BATCH = 100;

export async function deleteTrip(userId: string, accessToken: string, tripId: string) {
  const prisma = getPrismaClient();
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    select: {
      coverPhotoPath: true,
      // Deleting the trip cascades its Memories away; the traveller's own photos
      // must leave private storage with them rather than outliving the trip.
      memories: { select: { photos: { select: { path: true } } } },
    },
  });
  if (!trip) throw new TripNotFoundError();

  await prisma.trip.delete({ where: { id: tripId } });

  const memoryPhotoPaths = trip.memories.flatMap((memory) =>
    memory.photos.map((photo) => photo.path),
  );
  if (!trip.coverPhotoPath && !memoryPhotoPaths.length) return;

  const supabase = createAuthenticatedSupabaseClient(accessToken);
  if (!supabase) return;
  if (trip.coverPhotoPath) {
    await supabase.storage.from(TRIP_COVERS_BUCKET).remove([trip.coverPhotoPath]);
  }
  for (let index = 0; index < memoryPhotoPaths.length; index += STORAGE_REMOVE_BATCH) {
    await supabase.storage
      .from(MEMORY_PHOTOS_BUCKET)
      .remove(memoryPhotoPaths.slice(index, index + STORAGE_REMOVE_BATCH));
  }
}
