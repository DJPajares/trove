import { getPrismaClient, type Prisma } from '@trove/db';

import { derivedPlanInstant } from './itinerary-local-timing.js';
import { formatLocalTime } from './itinerary-rules.js';
import { PublicTripNotFoundError } from './public-itinerary.js';
import { findOrCreateOwnedCustomPlace, getTrip, TripValidationError } from './trips.js';
import { formatDateOnly, isValidIanaTimeZone, parseDateOnly } from './trip-rules.js';

/**
 * Saving a copy of a shared trip (PRD 8.1).
 *
 * The copy is a new private trip owned by whoever saved it. It carries the
 * shared plan and nothing else - the same allowlist the share link shows
 * (`listPublicItinerary`) - plus the time zones and Google Place links that
 * make that plan work as a trip of its own. Everything private about the
 * original stays where it was.
 *
 * Planning is a pure function (`planTripCopy`) so the rules about what crosses
 * over can be tested without a database; `copySharedTrip` only writes the plan.
 */

const placeSelect = {
  customName: true,
  customTimeZone: true,
  id: true,
  kind: true,
  ownerId: true,
} as const;

export const sharedTripCopySelect = {
  countries: true,
  creator: { select: { displayName: true } },
  creatorId: true,
  description: true,
  destinations: {
    orderBy: { position: 'asc' as const },
    select: { place: { select: placeSelect }, timeZone: true },
  },
  endDate: true,
  id: true,
  itineraryDays: {
    orderBy: { date: 'asc' as const },
    select: {
      date: true,
      defaultTimeZone: true,
      defaultTimeZoneSource: true,
      defaultTimeZoneSourceItemId: true,
      items: {
        orderBy: { position: 'asc' as const },
        select: {
          blockType: true,
          customLabel: true,
          customLocation: true,
          customLocationTimeZone: true,
          dayPart: true,
          durationMinutes: true,
          durationProvenance: true,
          id: true,
          localEndTime: true,
          localStartTime: true,
          notes: true,
          startInstant: true,
          timeProvenance: true,
          timeZone: true,
          timeZoneSource: true,
          timingFlexibility: true,
          travelModeToNext: true,
          tripPlace: { select: { customName: true, place: { select: placeSelect } } },
        },
      },
      name: true,
      notes: true,
      routeStartTravelMode: true,
    },
  },
  name: true,
  ownerId: true,
  referenceTimeZone: true,
  referenceTimeZoneSource: true,
  referenceTimeZoneSourcePlaceId: true,
  sourceAttribution: true,
  startDate: true,
} satisfies Prisma.TripSelect;

export type SharedTripSource = Prisma.TripGetPayload<{ select: typeof sharedTripCopySelect }>;
type SourcePlace = SharedTripSource['destinations'][number]['place'];
type SourceItem = SharedTripSource['itineraryDays'][number]['items'][number];

export type TripCopyInput = { name: string; startDate: string };

/** Where a copied stop or destination points: the same Google Place, or one of the copier's own. */
export type CopiedPlace =
  { kind: 'shared'; placeId: string } | { kind: 'custom'; name: string; timeZone: string | null };

type CopiedItem = {
  data: Omit<
    Prisma.ItineraryItemUncheckedCreateInput,
    'itineraryDayId' | 'position' | 'tripId' | 'tripPlaceId'
  >;
  place: CopiedPlace | null;
  tripPlaceName: string | null;
};

export type TripCopyPlan = {
  credit: { creatorId: string | null; name: string | null };
  days: Array<{
    date: Date;
    defaultTimeZone: string;
    firstLocatedIndex: number | null;
    items: CopiedItem[];
    name: string | null;
    notes: string | null;
    routeStartTravelMode: SharedTripSource['itineraryDays'][number]['routeStartTravelMode'];
  }>;
  destinations: Array<{ place: CopiedPlace; timeZone: string | null }>;
  trip: {
    countries: string[];
    description: string | null;
    endDate: Date;
    name: string;
    referenceTimeZone: string;
    referenceTimeZoneSource: 'COUNTRY' | 'EXPLICIT';
    referenceTimeZoneSourceDestination: CopiedPlace | null;
    sourceTripId: string;
    startDate: Date;
  };
};

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * A Google Place is shared by everyone, so the copy may point at the very same
 * row: no provider request, nothing new to pay for. Any other Place belongs to
 * the original owner, and the copy never links to it. The copier gets a Place of
 * their own built from the name the link already shows - not its coordinates,
 * and not the owner's note.
 */
export function copiedPlace(place: SourcePlace, sharedName: string | null): CopiedPlace | null {
  if (place.kind === 'PROVIDER' && place.ownerId === null) {
    return { kind: 'shared', placeId: place.id };
  }
  const name = sharedName?.trim() || place.customName?.trim();
  return name ? { kind: 'custom', name, timeZone: place.customTimeZone } : null;
}

/** The credit a copy carries: the trip's first creator, never just whoever shared it last. */
export function copyCredit(source: SharedTripSource) {
  return {
    // A copy already names its first creator. Only an original, which has no
    // recorded credit of its own, falls back to the person who shared it.
    creatorId: source.creatorId ?? (source.sourceAttribution ? null : source.ownerId),
    // The name is recorded now, so the credit outlives a rename or a deleted
    // original. A copy of a copy keeps the name its own save recorded when the
    // creator's profile no longer offers one.
    name: source.creator?.displayName?.trim() || source.sourceAttribution || null,
  };
}

function shiftDate(value: Date, offsetDays: number) {
  return new Date(value.getTime() + offsetDays * DAY_MS);
}

function copiedItem(item: SourceItem, date: string, dayTimeZone: string, now: Date): CopiedItem {
  const place = item.tripPlace
    ? copiedPlace(item.tripPlace.place, item.tripPlace.customName)
    : null;
  // A stop whose Place could not come along keeps its own label and time zone,
  // which now follows the day rather than a Place it no longer has.
  const timeZone = item.timeZone ?? (item.localStartTime ? dayTimeZone : null);
  const timeZoneSource = !timeZone
    ? null
    : item.timeZoneSource === 'PLACE' && !place
      ? ('DAY_DEFAULT' as const)
      : (item.timeZoneSource ?? ('DAY_DEFAULT' as const));
  const localStart = formatLocalTime(item.localStartTime);
  // The clock time is what the plan says; the instant is only derived from it,
  // so it is worked out again for the new date. A booking-backed instant does
  // not exist in the copy, so every timed stop becomes a floating local time.
  const startInstant =
    localStart && timeZone ? derivedPlanInstant(date, localStart, timeZone) : null;
  const keepsTime = Boolean(localStart && timeZone && startInstant);

  return {
    place,
    tripPlaceName: item.tripPlace?.customName?.trim() || null,
    data: {
      blockType: item.blockType,
      customLabel: item.customLabel,
      customLocation: item.customLocation,
      customLocationTimeZone: item.customLocationTimeZone,
      // A daypart and a clock time cannot both be set, so a stop whose time did
      // not survive the move falls back to its daypart, if it had one.
      dayPart: keepsTime ? null : item.dayPart,
      durationMinutes: item.durationMinutes,
      durationProvenance: item.durationProvenance,
      localEndTime: keepsTime ? item.localEndTime : null,
      localStartTime: keepsTime ? item.localStartTime : null,
      notes: item.notes,
      startInstant: keepsTime ? startInstant : null,
      timeProvenance: keepsTime ? item.timeProvenance : null,
      timeSemantics: keepsTime ? ('FLOATING_LOCAL' as const) : null,
      timeZone,
      timeZoneResolvedAt: timeZone ? now : null,
      timeZoneSource,
      timingFlexibility: item.timingFlexibility,
      travelModeToNext: item.travelModeToNext,
    },
  };
}

/**
 * Everything the copy will contain, worked out before anything is written.
 *
 * What is absent here is the point as much as what is present: no unscheduled
 * items, priorities, costs, travel progress, bases, stays, bookings, tasks,
 * expenses, trip info, memories, ratings, cover photo, planning preferences or
 * share setting.
 */
export function planTripCopy(
  source: SharedTripSource,
  input: TripCopyInput,
  now: Date,
): TripCopyPlan {
  // The controller has already refused a blank name.
  const name = input.name.trim();
  let start: Date;
  try {
    start = parseDateOnly(input.startDate);
  } catch {
    throw new TripValidationError('invalid_date');
  }
  const offsetDays = Math.round((start.getTime() - source.startDate.getTime()) / DAY_MS);
  const referenceTimeZone = isValidIanaTimeZone(source.referenceTimeZone)
    ? source.referenceTimeZone
    : 'UTC';

  const destinations = source.destinations.flatMap((destination) => {
    const place = copiedPlace(destination.place, null);
    return place ? [{ place, timeZone: destination.timeZone }] : [];
  });
  const sourceDestination = source.destinations.find(
    (destination) => destination.place.id === source.referenceTimeZoneSourcePlaceId,
  );

  return {
    credit: copyCredit(source),
    destinations,
    trip: {
      countries: source.countries,
      description: source.description,
      endDate: shiftDate(source.endDate, offsetDays),
      name,
      // The original's zone is what its clock times mean, so it comes along. A
      // zone the original owed to its owner's home or device becomes a fixed one,
      // rather than being re-derived from the copier's.
      referenceTimeZone,
      referenceTimeZoneSource:
        source.referenceTimeZoneSource === 'COUNTRY' ? ('COUNTRY' as const) : ('EXPLICIT' as const),
      referenceTimeZoneSourceDestination:
        source.referenceTimeZoneSource === 'DESTINATION' && sourceDestination
          ? copiedPlace(sourceDestination.place, null)
          : null,
      sourceTripId: source.id,
      startDate: start,
    },
    days: source.itineraryDays.map((day) => {
      const date = shiftDate(day.date, offsetDays);
      const dateText = formatDateOnly(date);
      const firstLocatedIndex =
        day.defaultTimeZoneSource === 'FIRST_LOCATED_ITEM'
          ? day.items.findIndex((item) => item.id === day.defaultTimeZoneSourceItemId)
          : -1;
      return {
        date,
        defaultTimeZone: day.defaultTimeZone,
        // Bases and stays stay behind, so a day zone that came from one is kept
        // as a value under the trip's reference rather than pointing at nothing.
        firstLocatedIndex: firstLocatedIndex >= 0 ? firstLocatedIndex : null,
        items: day.items.map((item) => copiedItem(item, dateText, day.defaultTimeZone, now)),
        name: day.name,
        notes: day.notes,
        routeStartTravelMode: day.routeStartTravelMode,
      };
    }),
  };
}

export async function copySharedTrip(
  userId: string,
  accessToken: string,
  tripId: string,
  input: TripCopyInput,
  options: { now?: Date } = {},
) {
  const prisma = getPrismaClient();
  const now = options.now ?? new Date();
  const source = await prisma.trip.findFirst({
    // The same authorization the share link uses: a trip nobody shared is one
    // nobody can copy, and it fails exactly as a missing trip does.
    where: { id: tripId, visibility: 'PUBLIC' },
    select: sharedTripCopySelect,
  });
  if (!source) throw new PublicTripNotFoundError();
  const plan = planTripCopy(source, input, now);

  await prisma.profile.upsert({ where: { id: userId }, create: { id: userId }, update: {} });

  const copyId = await prisma.$transaction(async (transaction) => {
    const placeIds = new Map<string, string>();
    const resolvePlace = async (place: CopiedPlace) => {
      if (place.kind === 'shared') return place.placeId;
      const key = `custom:${place.name.toLowerCase()}`;
      const known = placeIds.get(key);
      if (known) return known;
      const created = await findOrCreateOwnedCustomPlace(
        transaction,
        userId,
        place.name,
        place.timeZone,
      );
      placeIds.set(key, created.id);
      return created.id;
    };

    // Two destinations can land on one Place of the copier's; keep the first.
    const destinations = new Map<string, string | null>();
    for (const destination of plan.destinations) {
      const placeId = await resolvePlace(destination.place);
      if (!destinations.has(placeId)) destinations.set(placeId, destination.timeZone);
    }
    const referencePlaceId = plan.trip.referenceTimeZoneSourceDestination
      ? await resolvePlace(plan.trip.referenceTimeZoneSourceDestination)
      : null;

    const trip = await transaction.trip.create({
      data: {
        countries: plan.trip.countries,
        creatorId: plan.credit.creatorId,
        description: plan.trip.description,
        endDate: plan.trip.endDate,
        name: plan.trip.name,
        ownerId: userId,
        planningReadiness: 'IN_PROGRESS',
        referenceTimeZone: plan.trip.referenceTimeZone,
        referenceTimeZoneSource: referencePlaceId
          ? 'DESTINATION'
          : plan.trip.referenceTimeZoneSource,
        referenceTimeZoneSourcePlaceId: referencePlaceId,
        sourceAttribution: plan.credit.name,
        sourceTripId: plan.trip.sourceTripId,
        startDate: plan.trip.startDate,
      },
      select: { id: true },
    });

    if (destinations.size) {
      await transaction.tripDestination.createMany({
        data: [...destinations].map(([placeId, timeZone], position) => ({
          placeId,
          position,
          timeZone,
          timeZoneResolvedAt: timeZone ? now : null,
          tripId: trip.id,
        })),
      });
    }

    const tripPlaceIds = new Map<string, string>();
    for (const day of plan.days) {
      const createdDay = await transaction.itineraryDay.create({
        data: {
          date: day.date,
          defaultTimeZone: day.defaultTimeZone,
          defaultTimeZoneResolvedAt: now,
          defaultTimeZoneSource: 'TRIP_REFERENCE',
          name: day.name,
          notes: day.notes,
          routeStartTravelMode: day.routeStartTravelMode,
          tripId: trip.id,
        },
        select: { id: true },
      });

      for (const [position, item] of day.items.entries()) {
        let tripPlaceId: string | null = null;
        if (item.place) {
          const placeId = await resolvePlace(item.place);
          tripPlaceId = tripPlaceIds.get(placeId) ?? null;
          if (!tripPlaceId) {
            const created = await transaction.tripPlace.create({
              data: { customName: item.tripPlaceName, placeId, tripId: trip.id },
              select: { id: true },
            });
            tripPlaceId = created.id;
            tripPlaceIds.set(placeId, tripPlaceId);
          }
        }

        const createdItem = await transaction.itineraryItem.create({
          data: {
            ...item.data,
            itineraryDayId: createdDay.id,
            position,
            tripId: trip.id,
            tripPlaceId,
          },
          select: { id: true },
        });
        // `itinerary_days_time_zone_source_context` needs the item to exist
        // before a day can name it, so the source is promoted afterwards.
        if (day.firstLocatedIndex === position) {
          await transaction.itineraryDay.update({
            where: { id: createdDay.id },
            data: {
              defaultTimeZoneSource: 'FIRST_LOCATED_ITEM',
              defaultTimeZoneSourceItemId: createdItem.id,
            },
          });
        }
      }
    }

    return trip.id;
  });

  return getTrip(userId, accessToken, copyId);
}
