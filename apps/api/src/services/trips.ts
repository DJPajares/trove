import type { SupabaseClient } from '@supabase/supabase-js';
import { getPrismaClient, Prisma } from '@trove/db';

import { floatingLocalTimeToInstant, formatLocalTime } from './itinerary-rules.js';
import { MEMORY_PHOTOS_BUCKET } from './memories.js';
import { placeProviderRefInclude, serializeCanonicalPlace } from './place-serializer.js';
import { createAuthenticatedSupabaseClient } from './supabase-auth.js';
import {
  calculateItineraryCoverage,
  calculateTripPreparedness,
  dayOffset,
  deriveTripLifecycle,
  enumerateDateRange,
  formatDateOnly,
  getDateRangeChanges,
  isValidIanaTimeZone,
  parseDateOnly,
  resolveCountryPrimaryTimeZone,
  resolveTripWeatherLocation,
  resolveTripTimeZone,
  shiftDateOnly,
} from './trip-rules.js';

export const TRIP_COVERS_BUCKET = 'trip-covers';

export type TripDestinationInput = { name: string };

export type TripCreate = {
  /** ISO 3166-1 alpha-2, already validated and de-duplicated by the controller. */
  countries?: string[];
  coverPhotoPath?: string | null;
  description?: string | null;
  destinations?: TripDestinationInput[];
  deviceTimeZone?: string;
  endDate: string;
  name: string;
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
  destinations: {
    include: { place: { include: placeProviderRefInclude } },
    orderBy: { position: 'asc' as const },
  },
  itineraryDays: {
    orderBy: { date: 'asc' as const },
    select: {
      // Both base columns and the reservation count are what `hasStay` reads;
      // they mirror the base-resolution chain in `itinerary-routes.ts`, so
      // preparedness and the itinerary's own routing cannot disagree.
      _count: { select: { accommodationReservations: true, items: true } },
      dailyBaseDepartureTripPlaceId: true,
      dailyBaseTripPlaceId: true,
      date: true,
    },
  },
  owner: true,
  startingPlace: true,
} as const;

type TripRecord = Awaited<ReturnType<typeof findOwnedTrip>>;

function mapReadiness(value: string) {
  return value === 'READY' ? ('ready' as const) : ('in_progress' as const);
}

/**
 * Only the two states a traveller can actually choose. `SHARED` is scaffolding
 * for named collaborators, which nothing implements yet, and reporting it as
 * anything other than private would tell the owner their trip is out in the
 * world when it is not.
 */
function mapVisibility(value: string) {
  return value === 'PUBLIC' ? ('public' as const) : ('private' as const);
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
  const effectiveStartingPlace = trip.startingPlace;
  const itineraryDays = (trip.itineraryDays ?? []).map((day) => ({
    date: day.date,
    hasStay:
      day.dailyBaseTripPlaceId !== null ||
      day.dailyBaseDepartureTripPlaceId !== null ||
      day._count.accommodationReservations > 0,
    scheduledItemCount: day._count.items,
  }));
  const itineraryCoverage = calculateItineraryCoverage(startDate, endDate, itineraryDays);
  const tripPreparedness = calculateTripPreparedness(startDate, endDate, itineraryDays);

  /**
   * One pass over the destinations, feeding both the weather location and the
   * serialized destinations.
   *
   * Their coordinates were already being resolved here for weather; the trip's
   * own screens now draw on them too, to state how far apart a trip's stops
   * are. Resolving them twice would be two passes over the same records for the
   * same answer - and the coordinates are read from the Place rows this query
   * already loaded, so neither pass reaches a provider.
   */
  const destinations = trip.destinations.map((destination) => {
    const { location } = serializeCanonicalPlace({
      ...destination.place,
      providerRefs: destination.place.providerRefs ?? [],
    });

    return {
      // Weather keeps the whole canonical location, whose own time zone is one
      // of the fallbacks it resolves a reading against. The payload below takes
      // the coordinates alone: they answer how far apart the stops are, and a
      // second copy of the zone there would be a field nothing reads.
      location,
      timeZone: destination.timeZone,
      serialized: {
        id: destination.id,
        location: location ? { latitude: location.latitude, longitude: location.longitude } : null,
        name: destination.place.customName ?? '',
        placeId: destination.placeId,
        position: destination.position,
        timeZone: destination.timeZone,
      },
    };
  });

  const weatherLocation = resolveTripWeatherLocation(
    destinations.map(({ location, timeZone }) => ({ location, timeZone })),
    trip.referenceTimeZone,
  );

  return {
    countries: trip.countries,
    coverPhotoPath: trip.coverPhotoPath,
    coverPhotoUrl: await createCoverUrl(supabase, trip.coverPhotoPath),
    createdAt: trip.createdAt.toISOString(),
    description: trip.description,
    destinations: destinations.map(({ serialized }) => serialized),
    endDate,
    experienceNote: trip.experienceNote,
    experienceRating: trip.experienceRating,
    id: trip.id,
    itineraryCoverage,
    lifecycle: deriveTripLifecycle(startDate, endDate, trip.referenceTimeZone, now),
    memoryCount: trip._count.memories,
    name: trip.name,
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
    tripPreparedness,
    updatedAt: trip.updatedAt.toISOString(),
    visibility: mapVisibility(trip.visibility),
    weatherLocation,
  };
}

async function findOwnedTrip(userId: string, tripId: string) {
  return getPrismaClient().trip.findFirst({
    where: { id: tripId, ownerId: userId },
    include: tripInclude,
  });
}

/**
 * Re-derives the absolute instant of every timed item from the day it now sits
 * on.
 *
 * `startInstant` is a materialised answer to "when, exactly" - built once from
 * the day's date, the item's local time and its zone. Move the day and the
 * stored instant still points at the old calendar date, so it has to be worked
 * out again. An item whose local time does not exist on the new date, because
 * the clocks went forward through it, has no instant to give: that is recorded
 * as nothing rather than allowed to fail the move, since the time of day the
 * traveller wrote down is still the truth.
 */
async function recomputeItemInstants(transaction: Prisma.TransactionClient, tripId: string) {
  const timedItems = await transaction.itineraryItem.findMany({
    where: { tripId, itineraryDayId: { not: null }, localStartTime: { not: null } },
    select: {
      id: true,
      localStartTime: true,
      timeZone: true,
      itineraryDay: { select: { date: true, defaultTimeZone: true } },
    },
  });

  const rows: Prisma.Sql[] = [];

  for (const item of timedItems) {
    if (!item.itineraryDay) continue;
    const localTime = formatLocalTime(item.localStartTime);
    if (!localTime) continue;

    const date = formatDateOnly(item.itineraryDay.date);
    const timeZone = item.timeZone ?? item.itineraryDay.defaultTimeZone;
    let startInstant: Date | null = null;
    try {
      startInstant = floatingLocalTimeToInstant(date, localTime, timeZone);
    } catch {
      startInstant = null;
    }

    // Postgres reads the column's type from the first tuple, and the first item
    // of a trip is as likely as any other to be the one with no instant, so
    // every row says what it is rather than leaving it to be inferred.
    rows.push(Prisma.sql`(${item.id}::uuid, ${startInstant}::timestamptz)`);
  }

  if (!rows.length) return;

  // One statement rather than one per item. Each instant was worked out above
  // and none of them depend on each other, so the only thing the old loop was
  // buying was a round trip apiece - and a fortnight of well-planned days is
  // hundreds of them, in series, inside a transaction the traveller is waiting
  // on.
  await transaction.$executeRaw(Prisma.sql`
    UPDATE "trove"."itinerary_items" AS item
    SET "start_instant" = source.instant
    FROM (VALUES ${Prisma.join(rows)}) AS source(id, instant)
    WHERE item."id" = source.id
  `);
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
  inferredTimeZone: string | null = null,
) {
  const customName = name.trim();
  const existing = await transaction.place.findFirst({
    where: {
      customName: { equals: customName, mode: 'insensitive' },
      kind: 'CUSTOM',
      ownerId: userId,
    },
  });

  if (existing) {
    // A saved custom Location or a previously resolved Place is more specific
    // than a country default. Only fill an unresolved value; never overwrite it.
    if (!existing.customTimeZone && inferredTimeZone) {
      return transaction.place.update({
        where: { id: existing.id },
        data: { customTimeZone: inferredTimeZone },
      });
    }
    return existing;
  }

  return transaction.place.create({
    data: {
      customName,
      customTimeZone: inferredTimeZone,
      kind: 'CUSTOM',
      ownerId: userId,
    },
  });
}

function toTimeZoneCandidate(place: { customTimeZone: string | null; id: string } | null) {
  return place ? { placeId: place.id, timeZone: place.customTimeZone } : null;
}

/**
 * The traveller's home as a time zone candidate. It is a country rather than a
 * place, so it names no place id - the trip records the zone without pointing
 * at a row that does not exist.
 */
function toProfileHomeCandidate(profile: { homeTimeZone: string | null }) {
  return profile.homeTimeZone ? { placeId: null, timeZone: profile.homeTimeZone } : null;
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
    });
    const destinations = await Promise.all(
      (input.destinations ?? []).map((destination) =>
        findOrCreateCustomPlace(
          transaction,
          userId,
          destination.name,
          resolveCountryPrimaryTimeZone(destination.name),
        ),
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
      profileHome: toProfileHomeCandidate(profile),
      startingLocation: toTimeZoneCandidate(startingPlace),
    });
    const trip = await transaction.trip.create({
      data: {
        countries: input.countries ?? [],
        coverPhotoPath: input.coverPhotoPath ?? null,
        creatorId: userId,
        description: input.description?.trim() || null,
        endDate: end,
        name: input.name.trim(),
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
            findOrCreateCustomPlace(
              transaction,
              userId,
              destination.name,
              resolveCountryPrimaryTimeZone(destination.name),
            ),
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
          profileHome: toProfileHomeCandidate(current.owner),
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

    // The plan is anchored to the day the trip begins: day one stays day one.
    // Re-anchoring the existing days here, before the reconciliation below,
    // turns "delete seven days and make seven more" into "the same seven days, a
    // week later" - and whatever length the trip gained or lost is then settled
    // at its end by the reconciliation, unchanged.
    //
    // Requiring both ends to move together would have been the narrower rule,
    // but it leaves a trip moved *and* lengthened in one edit matching neither
    // case, which is how "a week later, and a day longer" used to empty the
    // whole itinerary into Unscheduled. The cost of anchoring on the start is
    // that pulling the start date earlier on its own carries the plan back with
    // it and leaves the blank days at the end rather than the beginning - and
    // that only happens if both fields are edited deliberately, since choosing a
    // start date takes the end date with it.
    const offsetDays = dayOffset(formatDateOnly(current.startDate), startDate);
    const dayDates = new Map(itineraryDays.map((day) => [day.id, formatDateOnly(day.date)]));

    if (offsetDays !== 0) {
      // One day at a time, in the order that keeps every intermediate state
      // unique: a trip nudged a single day forward has its whole range overlap
      // its old one, and `@@unique([tripId, date])` is checked per row.
      const ordered = [...itineraryDays].sort((left, right) =>
        offsetDays > 0
          ? right.date.getTime() - left.date.getTime()
          : left.date.getTime() - right.date.getTime(),
      );

      for (const day of ordered) {
        const movedDate = shiftDateOnly(dayDates.get(day.id) as string, offsetDays);
        dayDates.set(day.id, movedDate);
        await transaction.itineraryDay.update({
          data: { date: parseDateOnly(movedDate) },
          where: { id: day.id },
        });
      }

      await recomputeItemInstants(transaction, tripId);
    }

    const dateChanges = getDateRangeChanges([...dayDates.values()], startDate, endDate);
    const removedDateSet = new Set(dateChanges.removedDates);
    const removedDays = itineraryDays.filter((day) =>
      removedDateSet.has(dayDates.get(day.id) as string),
    );
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

    if (shouldResolveTimeZone) {
      // Existing day defaults that still inherit the trip reference must move
      // before a later item creation snapshots that day default. Explicit daily
      // bases and location-derived defaults intentionally remain untouched.
      await transaction.itineraryDay.updateMany({
        where: { defaultTimeZoneSource: 'TRIP_REFERENCE', tripId },
        data: {
          defaultTimeZone: timeZone.timeZone,
          defaultTimeZoneResolvedAt: new Date(),
        },
      });
    }

    await transaction.trip.update({
      where: { id: tripId },
      data: {
        ...(input.countries !== undefined ? { countries: input.countries } : {}),
        ...(input.coverPhotoPath !== undefined ? { coverPhotoPath: input.coverPhotoPath } : {}),
        ...(input.description !== undefined
          ? { description: input.description?.trim() || null }
          : {}),
        endDate: end,
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
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
 * Turning a link on or off, kept off the general trip update.
 *
 * `updateTrip` normalizes dates, re-resolves time zones and can refuse on a
 * date shrink - none of which a share toggle should be able to trip over, and
 * none of which should be able to ride along with one. Publishing a trip is also
 * the one field on a trip that changes who can see it, so it is worth being able
 * to read every write of it in one place.
 */
export async function updateTripVisibility(
  userId: string,
  accessToken: string,
  tripId: string,
  visibility: 'private' | 'public',
) {
  const prisma = getPrismaClient();
  const existing = await prisma.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    select: { id: true },
  });
  if (!existing) throw new TripNotFoundError();

  await prisma.trip.update({
    where: { id: tripId },
    data: { visibility: visibility === 'public' ? 'PUBLIC' : 'PRIVATE' },
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
