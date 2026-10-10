import { getPrismaClient } from '@trove/db';

import {
  type CanonicalPlace,
  type CanonicalPlacesService,
  createCanonicalPlacesService,
  type ProviderPlaceLabel,
} from './canonical-places.js';
import { refreshDayDefaultTimeZone } from './itineraries.js';
import { hydratePlaceSnapshots } from './place-data.js';
import {
  placeProviderRefInclude,
  type PlaceSerializerOptions,
  serializeCanonicalPlace as serializePlace,
} from './place-serializer.js';

export type TripPlacePriority = 'interested' | 'maybe' | 'must_go';

export type TripPlace = {
  createdAt: string;
  /** What the traveller calls this Place on this trip, if they renamed it. */
  customName: string | null;
  id: string;
  isSaved: boolean;
  note: string | null;
  place: CanonicalPlace;
  priority: TripPlacePriority | null;
  referenceCount: number;
};

export class TripPlaceNotFoundError extends Error {
  constructor() {
    super('trip_place_not_found');
  }
}

export class TripPlaceReferencedError extends Error {
  constructor(public readonly referenceCount: number) {
    super('trip_place_referenced');
  }
}

export class TripPlaceSourceNotFoundError extends Error {
  constructor() {
    super('trip_place_source_not_found');
  }
}

export class TripPlaceTripNotFoundError extends Error {
  constructor() {
    super('trip_not_found');
  }
}

function mapPriority(
  priority: 'INTERESTED' | 'MAYBE' | 'MUST_GO' | null,
): TripPlacePriority | null {
  if (priority === 'MUST_GO') return 'must_go';
  if (priority === 'INTERESTED') return 'interested';
  if (priority === 'MAYBE') return 'maybe';
  return null;
}

function mapPriorityInput(priority: TripPlacePriority | null) {
  if (priority === 'must_go') return 'MUST_GO' as const;
  if (priority === 'interested') return 'INTERESTED' as const;
  if (priority === 'maybe') return 'MAYBE' as const;
  return null;
}

/**
 * Only scheduled itinerary items hold a Place in the trip. A Daily Base or a
 * day's timezone source is a day setting that re-resolves once the Place goes,
 * so neither is counted here or allowed to block removal.
 */
const tripPlaceInclude = {
  _count: { select: { itineraryItems: true } },
  place: { include: { ...placeProviderRefInclude, savedPlaces: { select: { id: true } } } },
} as const;

function serializeTripPlace(
  tripPlace: {
    _count: { itineraryItems: number };
    createdAt: Date;
    customName: string | null;
    id: string;
    note: string | null;
    place: Parameters<typeof serializePlace>[0] & { savedPlaces: Array<{ id: string }> };
    priority: 'INTERESTED' | 'MAYBE' | 'MUST_GO' | null;
  },
  options: PlaceSerializerOptions = {},
): TripPlace {
  return {
    createdAt: tripPlace.createdAt.toISOString(),
    customName: tripPlace.customName,
    id: tripPlace.id,
    isSaved: tripPlace.place.savedPlaces.length > 0,
    note: tripPlace.note,
    place: serializePlace(tripPlace.place, options),
    priority: mapPriority(tripPlace.priority),
    referenceCount: tripPlace._count.itineraryItems,
  };
}

async function assertOwnedTrip(userId: string, tripId: string) {
  const trip = await getPrismaClient().trip.findFirst({
    where: { id: tripId, ownerId: userId },
    select: { id: true, name: true },
  });
  if (!trip) throw new TripPlaceTripNotFoundError();
  return trip;
}

export async function listTripPlaces(userId: string, tripId: string, languageCode?: string) {
  const trip = await assertOwnedTrip(userId, tripId);
  const tripPlaces = await getPrismaClient().tripPlace.findMany({
    where: { tripId },
    include: {
      ...tripPlaceInclude,
      place: {
        include: {
          ...placeProviderRefInclude,
          savedPlaces: { where: { ownerId: userId }, select: { id: true } },
        },
      },
    },
    orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
  });

  // Opening a supporting collection must never acquire provider data. Explicit
  // additions and opened details handle resolution; this read keeps its age.
  const snapshots = await hydratePlaceSnapshots(
    tripPlaces.flatMap((tripPlace) =>
      tripPlace.place.providerRefs.map((reference) => reference.externalPlaceId),
    ),
    { languageCode, placesService: null, source: 'trip-places' },
  );

  return {
    trip,
    tripPlaces: tripPlaces.map((tripPlace) => serializeTripPlace(tripPlace, { snapshots })),
  };
}

export async function addTripPlace(
  userId: string,
  tripId: string,
  placeId: string,
  input: { customName?: string | null } = {},
) {
  await assertOwnedTrip(userId, tripId);
  const prisma = getPrismaClient();
  const place = await prisma.place.findFirst({
    where: { id: placeId, OR: [{ kind: 'PROVIDER' }, { kind: 'CUSTOM', ownerId: userId }] },
    select: { id: true },
  });
  if (!place) throw new TripPlaceSourceNotFoundError();

  const customName = input.customName?.trim() || null;

  const tripPlace = await prisma.tripPlace.upsert({
    where: { tripId_placeId: { placeId: place.id, tripId } },
    create: { customName, placeId: place.id, tripId },
    // Adding a Place already on the trip stays idempotent, but a name offered
    // this time is still worth keeping.
    update: customName ? { customName } : {},
    include: {
      ...tripPlaceInclude,
      place: {
        include: {
          providerRefs: true,
          savedPlaces: { where: { ownerId: userId }, select: { id: true } },
        },
      },
    },
  });
  return serializeTripPlace(tripPlace);
}

export async function updateTripPlace(
  userId: string,
  tripId: string,
  tripPlaceId: string,
  input: { customName?: string | null; note?: string | null; priority?: TripPlacePriority | null },
) {
  await assertOwnedTrip(userId, tripId);
  const result = await getPrismaClient().tripPlace.updateMany({
    where: { id: tripPlaceId, tripId },
    data: {
      // An empty name is how the traveller gives the Place back its provider name.
      ...(input.customName !== undefined ? { customName: input.customName?.trim() || null } : {}),
      ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
      ...(input.priority !== undefined ? { priority: mapPriorityInput(input.priority) } : {}),
    },
  });
  if (!result.count) throw new TripPlaceNotFoundError();

  const tripPlace = await getPrismaClient().tripPlace.findFirst({
    where: { id: tripPlaceId, tripId },
    include: {
      ...tripPlaceInclude,
      place: {
        include: {
          providerRefs: true,
          savedPlaces: { where: { ownerId: userId }, select: { id: true } },
        },
      },
    },
  });
  if (!tripPlace) throw new TripPlaceNotFoundError();
  return serializeTripPlace(tripPlace);
}

/**
 * Everything a Place gathered around it during the trip — expenses, reservations,
 * Memories — outlives the Place itself, the same way those records already outlive
 * a removed day. Each is detached first so removing a Place from the trip's
 * collection never destroys the traveller's own work, and never leaves a dangling
 * reference for the database to refuse.
 *
 * Scheduled itinerary items are the exception: an item's Place is its identity, so
 * removal is refused while the itinerary still schedules it.
 */
export async function removeTripPlace(userId: string, tripId: string, tripPlaceId: string) {
  await assertOwnedTrip(userId, tripId);
  const prisma = getPrismaClient();
  const tripPlace = await prisma.tripPlace.findFirst({
    where: { id: tripPlaceId, tripId },
    select: { _count: { select: { itineraryItems: true } } },
  });
  if (!tripPlace) throw new TripPlaceNotFoundError();
  if (tripPlace._count.itineraryItems) {
    throw new TripPlaceReferencedError(tripPlace._count.itineraryItems);
  }

  await prisma.$transaction(async (transaction) => {
    const detached = { data: { tripPlaceId: null }, where: { tripId, tripPlaceId } } as const;
    await transaction.memory.updateMany(detached);
    await transaction.expense.updateMany(detached);
    await transaction.reservation.updateMany(detached);

    // A day that leaned on this Place for its Daily Base or timezone falls back to
    // whatever else it holds, rather than keeping the Place alive to serve a default.
    const affectedDays = await transaction.itineraryDay.findMany({
      where: {
        tripId,
        OR: [
          { dailyBaseTripPlaceId: tripPlaceId },
          { dailyBaseDepartureTripPlaceId: tripPlaceId },
          { defaultTimeZoneSourceTripPlaceId: tripPlaceId },
        ],
      },
      select: { id: true },
    });
    await transaction.itineraryDay.updateMany({
      where: { tripId, dailyBaseTripPlaceId: tripPlaceId },
      data: { dailyBaseTripPlaceId: null },
    });
    await transaction.itineraryDay.updateMany({
      where: { tripId, dailyBaseDepartureTripPlaceId: tripPlaceId },
      data: { dailyBaseDepartureTripPlaceId: null },
    });
    await transaction.itineraryDay.updateMany({
      where: { tripId, defaultTimeZoneSourceTripPlaceId: tripPlaceId },
      data: { defaultTimeZoneSourceTripPlaceId: null },
    });

    await transaction.tripPlace.delete({ where: { id: tripPlaceId } });

    for (const day of affectedDays) {
      await refreshDayDefaultTimeZone(transaction, tripId, day.id);
    }
  });
}

/** Days whose default timezone can rest on this Trip Place, directly or through a stop. */
const tripPlaceChildDays = (tripPlaceId: string) => ({
  OR: [
    { dailyBaseTripPlaceId: tripPlaceId },
    { dailyBaseDepartureTripPlaceId: tripPlaceId },
    { defaultTimeZoneSourceTripPlaceId: tripPlaceId },
    { items: { some: { tripPlaceId } } },
  ],
});

/**
 * Links a Custom Place on this trip to the Google Place the traveller picked
 * while locating it, so the stop gains the provider's address, photos, rating
 * and hours rather than only its coordinates.
 *
 * A Custom Place cannot become a provider Place in place: the two are different
 * shapes, and a provider Place is shared by everyone who uses it. So the trip's
 * own Trip Place is pointed at the provider Place instead. Every itinerary item,
 * reservation, expense, Memory and day setting holds the Trip Place rather than
 * the Place, so all of it follows. Saved Places and other trips are not this
 * trip's to change; they keep the Custom Place.
 *
 * The provider Place is resolved the way an itinerary selection is (PRD 29.5):
 * identity and reusable evidence in one Details request. It happens before the
 * transaction so a slow provider never holds rows locked.
 */
export async function linkTripPlaceToProvider(
  userId: string,
  tripId: string,
  tripPlaceId: string,
  input: { externalPlaceId: string; label?: ProviderPlaceLabel; languageCode?: string },
  canonicalPlaces: Pick<
    CanonicalPlacesService,
    'resolveProviderPlace'
  > = createCanonicalPlacesService(),
) {
  await assertOwnedTrip(userId, tripId);
  const prisma = getPrismaClient();
  const tripPlace = await prisma.tripPlace.findFirst({
    where: { id: tripPlaceId, tripId, place: { kind: 'CUSTOM', ownerId: userId } },
    select: { id: true, note: true, place: { select: { customNote: true, id: true } } },
  });
  if (!tripPlace) throw new TripPlaceNotFoundError();
  const customPlaceId = tripPlace.place.id;

  const providerPlace = await canonicalPlaces.resolveProviderPlace(
    'google',
    input.externalPlaceId,
    input.label,
    { languageCode: input.languageCode, purpose: 'itinerary' },
  );

  const linkedTripPlaceId = await prisma.$transaction(async (transaction) => {
    const existing = await transaction.tripPlace.findFirst({
      where: { tripId, placeId: providerPlace.id },
      select: { id: true, note: true },
    });
    const affectedDays = await transaction.itineraryDay.findMany({
      where: { tripId, ...tripPlaceChildDays(tripPlaceId) },
      select: { id: true },
    });
    // A note the traveller wrote on the Custom Place itself would otherwise
    // stay behind with it.
    const carriedNote = tripPlace.place.customNote?.trim() || null;

    let targetId = tripPlaceId;
    if (existing) {
      // The trip already holds this Google Place, and a trip holds a Place
      // once, so the located stop folds into it.
      targetId = existing.id;
      const moved = { data: { tripPlaceId: existing.id }, where: { tripId, tripPlaceId } } as const;
      await transaction.itineraryItem.updateMany(moved);
      await transaction.memory.updateMany(moved);
      await transaction.expense.updateMany(moved);
      await transaction.reservation.updateMany(moved);
      await transaction.itineraryDay.updateMany({
        where: { tripId, dailyBaseTripPlaceId: tripPlaceId },
        data: { dailyBaseTripPlaceId: existing.id },
      });
      await transaction.itineraryDay.updateMany({
        where: { tripId, dailyBaseDepartureTripPlaceId: tripPlaceId },
        data: { dailyBaseDepartureTripPlaceId: existing.id },
      });
      await transaction.itineraryDay.updateMany({
        where: { tripId, defaultTimeZoneSourceTripPlaceId: tripPlaceId },
        data: { defaultTimeZoneSourceTripPlaceId: existing.id },
      });
      const note = existing.note ?? tripPlace.note ?? carriedNote;
      if (note !== existing.note) {
        await transaction.tripPlace.update({ where: { id: existing.id }, data: { note } });
      }
      await transaction.tripPlace.delete({ where: { id: tripPlaceId } });
    } else {
      await transaction.tripPlace.update({
        where: { id: tripPlaceId },
        data: {
          placeId: providerPlace.id,
          ...(tripPlace.note === null && carriedNote ? { note: carriedNote } : {}),
        },
      });
    }

    // The trip's own references to the Custom Place move with it. A destination
    // the trip already holds as the Google Place is left as it is.
    const destinationTaken = await transaction.tripDestination.findFirst({
      where: { tripId, placeId: providerPlace.id },
      select: { id: true },
    });
    if (!destinationTaken) {
      await transaction.tripDestination.updateMany({
        where: { tripId, placeId: customPlaceId },
        data: { placeId: providerPlace.id },
      });
    }
    await transaction.trip.updateMany({
      where: { id: tripId, startingPlaceId: customPlaceId },
      data: { startingPlaceId: providerPlace.id },
    });
    await transaction.trip.updateMany({
      where: { id: tripId, referenceTimeZoneSourcePlaceId: customPlaceId },
      data: { referenceTimeZoneSourcePlaceId: providerPlace.id },
    });

    // The location may have moved, so any day that leans on this Place for its
    // timezone re-resolves it.
    for (const day of affectedDays) {
      await refreshDayDefaultTimeZone(transaction, tripId, day.id);
    }
    return targetId;
  });

  const linked = await prisma.tripPlace.findFirst({
    where: { id: linkedTripPlaceId, tripId },
    include: {
      ...tripPlaceInclude,
      place: {
        include: {
          ...placeProviderRefInclude,
          savedPlaces: { where: { ownerId: userId }, select: { id: true } },
        },
      },
    },
  });
  if (!linked) throw new TripPlaceNotFoundError();
  return serializeTripPlace(linked);
}
