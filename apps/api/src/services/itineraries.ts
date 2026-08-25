import { getPrismaClient, type Prisma } from '@trove/db';

import { DAY_PART_WINDOWS } from './day-part-windows.js';
import {
  durationMinutesUntilLocalEnd,
  floatingLocalTimeToInstant,
  formatLocalTime,
  parseLocalTime,
  resolveDayTimeZone,
  resolveItemTimeZone,
} from './itinerary-rules.js';
import { unlinkItineraryItemReferences } from './itinerary-item-deletion.js';
import { hydratePlaceSnapshots } from './place-data.js';
import {
  placeProviderRefInclude,
  type PlaceSerializerOptions,
  serializeCanonicalPlace,
} from './place-serializer.js';
import { formatDateOnly, isValidIanaTimeZone } from './trip-rules.js';

export type ItineraryScheduleInput =
  | { kind: 'none' }
  | { dayPart: 'afternoon' | 'anytime' | 'evening' | 'morning'; kind: 'day_part' }
  | { kind: 'exact'; localTime: string };

export type ItineraryItemInput = {
  clientItemId?: string;
  customLabel?: string | null;
  customLocation?: { label: string; timeZone?: string | null } | null;
  durationMinutes?: number | null;
  itineraryDayId?: string;
  localEndTime?: string | null;
  notes?: string | null;
  plannedCost?: { amount: string; currencyCode: string } | null;
  priority?: 'interested' | 'maybe' | 'must_go' | null;
  schedule?: ItineraryScheduleInput;
  tripPlaceId?: string | null;
};

export type ItineraryDayMoveInput = {
  expectedSourceBase: ItineraryDayBase;
  expectedSourceItemIds: string[];
  expectedTargetBase: ItineraryDayBase;
  expectedTargetItemIds: string[];
  strategy: 'append' | 'swap';
  targetItineraryDayId: string;
};

export type ItineraryDayBase = {
  dailyBaseDepartureTripPlaceId: string | null;
  dailyBaseTripPlaceId: string | null;
};

export class ItineraryConflictError extends Error {
  constructor(
    code: 'itinerary_day_conflict' | 'itinerary_item_conflict' = 'itinerary_item_conflict',
  ) {
    super(code);
  }
}

export class ItineraryNotFoundError extends Error {
  constructor(code: 'itinerary_day_not_found' | 'itinerary_item_not_found' | 'trip_not_found') {
    super(code);
  }
}

export class ItineraryValidationError extends Error {
  constructor(
    public readonly code:
      | 'invalid_itinerary_item'
      | 'invalid_itinerary_day_move'
      | 'invalid_local_end_time'
      | 'invalid_local_time'
      | 'invalid_time_zone'
      | 'trip_place_not_found',
  ) {
    super(code);
  }
}

export const itineraryItemInclude = {
  itineraryDay: { select: { date: true, defaultTimeZone: true } },
  tripPlace: {
    include: {
      place: { include: placeProviderRefInclude },
    },
  },
} as const;

type ItineraryItemRecord = Prisma.ItineraryItemGetPayload<{
  include: typeof itineraryItemInclude;
}>;

function mapDayPart(value: string | null) {
  const values: Record<string, 'afternoon' | 'anytime' | 'evening' | 'morning'> = {
    AFTERNOON: 'afternoon',
    ANYTIME: 'anytime',
    EVENING: 'evening',
    MORNING: 'morning',
  };
  return value ? (values[value] ?? null) : null;
}

function mapDayPartInput(value: 'afternoon' | 'anytime' | 'evening' | 'morning') {
  const values = {
    afternoon: 'AFTERNOON',
    anytime: 'ANYTIME',
    evening: 'EVENING',
    morning: 'MORNING',
  } as const;
  return values[value];
}

function mapPriority(value: string | null) {
  const values: Record<string, 'interested' | 'maybe' | 'must_go'> = {
    INTERESTED: 'interested',
    MAYBE: 'maybe',
    MUST_GO: 'must_go',
  };
  return value ? (values[value] ?? null) : null;
}

function mapPriorityInput(value: 'interested' | 'maybe' | 'must_go' | null) {
  const values = {
    interested: 'INTERESTED',
    maybe: 'MAYBE',
    must_go: 'MUST_GO',
  } as const;
  return value ? values[value] : null;
}

function mapTravelMode(value: string) {
  if (value === 'TRANSIT') return 'transit' as const;
  if (value === 'WALK') return 'walk' as const;
  return 'drive' as const;
}

function mapTravelStatus(value: string) {
  if (value === 'COMPLETED') return 'completed' as const;
  if (value === 'SKIPPED') return 'skipped' as const;
  return 'upcoming' as const;
}

function mapDayTimeZoneSource(value: string) {
  const values: Record<string, string> = {
    ACCOMMODATION: 'accommodation',
    EXPLICIT_DAILY_BASE: 'explicit_daily_base',
    FIRST_LOCATED_ITEM: 'first_located_item',
    TRIP_REFERENCE: 'trip_reference',
  };
  return values[value] ?? 'trip_reference';
}

function mapItemTimeZoneSource(value: string | null) {
  const values: Record<string, string> = {
    DAY_DEFAULT: 'day_default',
    EXPLICIT: 'explicit',
    PLACE: 'place',
  };
  return value ? (values[value] ?? null) : null;
}

function serializeTripPlace(
  tripPlace: NonNullable<ItineraryItemRecord['tripPlace']>,
  options: PlaceSerializerOptions = {},
) {
  return {
    customName: tripPlace.customName,
    id: tripPlace.id,
    note: tripPlace.note,
    place: {
      ...serializeCanonicalPlace(tripPlace.place, options),
      // The day's local-time maths needs an IANA zone, which only a Custom
      // Place carries; a provider snapshot holds a UTC offset, not a zone.
      timeZone: tripPlace.place.customTimeZone,
    },
    priority: mapPriority(tripPlace.priority),
  };
}

export function serializeItineraryItem(
  item: ItineraryItemRecord,
  options: PlaceSerializerOptions = {},
) {
  return {
    createdAt: item.createdAt.toISOString(),
    customLabel: item.customLabel,
    customLocation: item.customLocation
      ? { label: item.customLocation, timeZone: item.customLocationTimeZone }
      : null,
    dayPart: mapDayPart(item.dayPart),
    durationMinutes: item.durationMinutes,
    id: item.id,
    itineraryDayId: item.itineraryDayId,
    localEndTime: formatLocalTime(item.localEndTime),
    localStartTime: formatLocalTime(item.localStartTime),
    notes: item.notes,
    plannedCost:
      item.plannedCostAmount && item.plannedCostCurrencyCode
        ? {
            amount: item.plannedCostAmount.toFixed(2),
            currencyCode: item.plannedCostCurrencyCode.trim(),
          }
        : null,
    position: item.position,
    priority: mapPriority(item.priority),
    startInstant: item.startInstant?.toISOString() ?? null,
    timeSemantics:
      item.timeSemantics === 'AUTHORITATIVE_INSTANT'
        ? ('authoritative_instant' as const)
        : item.timeSemantics === 'FLOATING_LOCAL'
          ? ('floating_local' as const)
          : null,
    timeZone: item.timeZone,
    timeZoneSource: mapItemTimeZoneSource(item.timeZoneSource),
    travelModeToNext: mapTravelMode(item.travelModeToNext),
    travelStatus: mapTravelStatus(item.travelStatus),
    tripPlace: item.tripPlace ? serializeTripPlace(item.tripPlace, options) : null,
    updatedAt: item.updatedAt.toISOString(),
  };
}

async function findOwnedTrip(
  transaction: Prisma.TransactionClient,
  userId: string,
  tripId: string,
) {
  const trip = await transaction.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    select: {
      endDate: true,
      id: true,
      name: true,
      referenceTimeZone: true,
      startDate: true,
    },
  });
  if (!trip) throw new ItineraryNotFoundError('trip_not_found');
  return trip;
}

async function findDay(
  transaction: Prisma.TransactionClient,
  tripId: string,
  itineraryDayId: string,
) {
  const day = await transaction.itineraryDay.findFirst({
    where: { id: itineraryDayId, tripId },
    select: {
      dailyBaseDepartureTripPlaceId: true,
      dailyBaseTripPlaceId: true,
      date: true,
      defaultTimeZone: true,
      id: true,
    },
  });
  if (!day) throw new ItineraryNotFoundError('itinerary_day_not_found');
  return day;
}

async function findTripPlace(
  transaction: Prisma.TransactionClient,
  tripId: string,
  tripPlaceId: string | null,
) {
  if (!tripPlaceId) return null;
  const tripPlace = await transaction.tripPlace.findFirst({
    where: { id: tripPlaceId, tripId },
    include: { place: true },
  });
  if (!tripPlace) throw new ItineraryValidationError('trip_place_not_found');
  return tripPlace;
}

function normalizeLocation(value: ItineraryItemInput['customLocation']) {
  if (!value) return { label: null, timeZone: null };
  const label = value.label.trim();
  const timeZone = value.timeZone?.trim() || null;
  if (!label) throw new ItineraryValidationError('invalid_itinerary_item');
  if (timeZone && !isValidIanaTimeZone(timeZone)) {
    throw new ItineraryValidationError('invalid_time_zone');
  }
  return { label, timeZone };
}

function normalizeContent(customLabel: string | null | undefined, tripPlaceId: string | null) {
  const label = customLabel?.trim() || null;
  if (!label && !tripPlaceId) throw new ItineraryValidationError('invalid_itinerary_item');
  return label;
}

function resolveItemTiming(
  input: Pick<ItineraryItemInput, 'durationMinutes' | 'localEndTime'>,
  localStartTime: Date | null,
  current?: Pick<ItineraryItemRecord, 'durationMinutes' | 'localEndTime'>,
) {
  if (input.localEndTime && input.durationMinutes) {
    throw new ItineraryValidationError('invalid_local_end_time');
  }

  const localEndTime =
    input.localEndTime !== undefined
      ? input.localEndTime
      : input.durationMinutes !== undefined
        ? null
        : formatLocalTime(current?.localEndTime ?? null);

  if (!localEndTime) {
    return {
      durationMinutes:
        input.durationMinutes !== undefined
          ? input.durationMinutes
          : input.localEndTime === null && current?.localEndTime
            ? null
            : (current?.durationMinutes ?? null),
      localEndTime: null,
    };
  }

  try {
    return {
      durationMinutes: durationMinutesUntilLocalEnd(formatLocalTime(localStartTime), localEndTime),
      localEndTime: parseLocalTime(localEndTime),
    };
  } catch {
    throw new ItineraryValidationError('invalid_local_end_time');
  }
}

function scheduleData(schedule: ItineraryScheduleInput, date: string, timeZone: string) {
  if (schedule.kind === 'none') {
    return {
      dayPart: null,
      localStartTime: null,
      startInstant: null,
      timeSemantics: null,
    };
  }
  if (schedule.kind === 'day_part') {
    return {
      dayPart: mapDayPartInput(schedule.dayPart),
      localStartTime: null,
      startInstant: null,
      timeSemantics: null,
    };
  }

  try {
    return {
      dayPart: null,
      localStartTime: parseLocalTime(schedule.localTime),
      startInstant: floatingLocalTimeToInstant(date, schedule.localTime, timeZone),
      timeSemantics: 'FLOATING_LOCAL' as const,
    };
  } catch {
    throw new ItineraryValidationError('invalid_local_time');
  }
}

export async function refreshDayDefaultTimeZone(
  transaction: Prisma.TransactionClient,
  tripId: string,
  itineraryDayId: string,
  excludeItemId?: string,
) {
  const day = await transaction.itineraryDay.findFirst({
    where: { id: itineraryDayId, tripId },
    include: {
      dailyBaseTripPlace: { include: { place: true } },
      items: {
        where: excludeItemId ? { id: { not: excludeItemId } } : undefined,
        include: { tripPlace: { include: { place: true } } },
        orderBy: { position: 'asc' },
      },
      accommodationReservations: {
        include: {
          reservation: {
            include: { tripPlace: { include: { place: true } } },
          },
        },
      },
      trip: { select: { referenceTimeZone: true } },
    },
  });
  if (!day) throw new ItineraryNotFoundError('itinerary_day_not_found');

  const resolution = resolveDayTimeZone({
    accommodations: day.accommodationReservations.map(({ reservation }) => ({
      timeZone: reservation.tripPlace?.place.customTimeZone ?? null,
      tripPlaceId: reservation.tripPlaceId,
    })),
    dailyBase: day.dailyBaseTripPlace
      ? {
          timeZone: day.dailyBaseTripPlace.place.customTimeZone,
          tripPlaceId: day.dailyBaseTripPlace.id,
        }
      : null,
    items: day.items.map((item) => ({
      customLocationTimeZone: item.customLocationTimeZone,
      id: item.id,
      tripPlaceId: item.tripPlaceId,
      tripPlaceTimeZone: item.tripPlace?.place.customTimeZone ?? null,
    })),
    tripTimeZone: day.trip.referenceTimeZone,
  });

  if (
    day.defaultTimeZone !== resolution.timeZone ||
    day.defaultTimeZoneSource !== resolution.source ||
    day.defaultTimeZoneSourceItemId !== resolution.sourceItemId ||
    day.defaultTimeZoneSourceTripPlaceId !== resolution.sourceTripPlaceId
  ) {
    await transaction.itineraryDay.update({
      where: { id: day.id },
      data: {
        defaultTimeZone: resolution.timeZone,
        defaultTimeZoneResolvedAt: new Date(),
        defaultTimeZoneSource: resolution.source,
        defaultTimeZoneSourceItemId: resolution.sourceItemId,
        defaultTimeZoneSourceTripPlaceId: resolution.sourceTripPlaceId,
      },
    });
  }
}

export async function listItinerary(userId: string, tripId: string, languageCode?: string) {
  const prisma = getPrismaClient();
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    select: {
      endDate: true,
      id: true,
      name: true,
      referenceTimeZone: true,
      startDate: true,
      itineraryDays: {
        include: {
          dailyBaseTripPlace: true,
          items: { include: itineraryItemInclude, orderBy: { position: 'asc' } },
        },
        orderBy: { date: 'asc' },
      },
      itineraryItems: {
        where: { itineraryDayId: null },
        include: itineraryItemInclude,
        orderBy: { position: 'asc' },
      },
      tripPlaces: {
        include: { place: { include: placeProviderRefInclude } },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });
  if (!trip) throw new ItineraryNotFoundError('trip_not_found');

  // Every Place the itinerary renders, resolved once from the database. This is
  // also what Trip Mode reads, so moving between its tabs re-reads Trove's own
  // data rather than re-asking Google for names it already stored.
  const snapshots = await hydratePlaceSnapshots(
    trip.tripPlaces.flatMap((tripPlace) =>
      tripPlace.place.providerRefs.map((reference) => reference.externalPlaceId),
    ),
    { languageCode, source: 'itinerary' },
  );
  const options = { snapshots };

  return {
    days: trip.itineraryDays.map((day) => ({
      date: formatDateOnly(day.date),
      defaultTimeZone: day.defaultTimeZone,
      defaultTimeZoneSource: mapDayTimeZoneSource(day.defaultTimeZoneSource),
      defaultTimeZoneSourceTripPlaceId: day.defaultTimeZoneSourceTripPlaceId,
      dailyBaseDepartureTripPlaceId: day.dailyBaseDepartureTripPlaceId,
      dailyBaseTripPlaceId: day.dailyBaseTripPlaceId,
      experienceNote: day.experienceNote,
      experienceRating: day.experienceRating,
      id: day.id,
      items: day.items.map((item) => serializeItineraryItem(item, options)),
      name: day.name,
      notes: day.notes,
      routeStartTravelMode: mapTravelMode(day.routeStartTravelMode),
    })),
    trip: {
      endDate: formatDateOnly(trip.endDate),
      id: trip.id,
      name: trip.name,
      referenceTimeZone: trip.referenceTimeZone,
      startDate: formatDateOnly(trip.startDate),
    },
    tripPlaces: trip.tripPlaces.map((tripPlace) => serializeTripPlace(tripPlace, options)),
    unscheduledItems: trip.itineraryItems.map((item) => serializeItineraryItem(item, options)),
  };
}

/**
 * The writes that land `orderedIds` on positions 0..n-1, in an order no unique
 * index can reject.
 *
 * Position is uniquely indexed per day (`itinerary_items_scheduled_position_key`,
 * and its unscheduled counterpart), so a row cannot be written straight to its
 * final slot while the row currently sitting there has yet to move — inserting
 * into the middle of a day collides on the very first write. Every row is
 * therefore parked clear of the occupied range first, which empties 0..n-1 for
 * the final pass. Parking runs above the current maximum rather than below zero
 * because a check constraint keeps positions non-negative.
 */
export function planReorderWrites(orderedIds: string[], above: number) {
  // Parking has to clear the final range too, or the second pass would collide
  // with rows still parked — which is the same bug one step later.
  const parkFrom = Math.max(above, orderedIds.length);
  return [
    ...orderedIds.map((id, index) => ({ id, position: parkFrom + index })),
    ...orderedIds.map((id, index) => ({ id, position: index })),
  ];
}

/** A schedule expressed as minutes from local midnight, or null when it implies no time. */
export type ItemSchedulePosition = {
  dayPart: string | null;
  localStartTime: Date | null;
};

/**
 * Minutes from local midnight the schedule implies, or null when it implies none.
 *
 * An exact time speaks for itself. A daypart only narrows the day to a window, so
 * it sorts at that window's start — read from the shared `DAY_PART_WINDOWS` rather
 * than restated here, so Trip Mode, Plan Score and this ordering can never disagree
 * about when Morning ends. `ANYTIME` constrains nothing and is therefore untimed.
 */
export function itemSortMinute(item: ItemSchedulePosition): number | null {
  if (item.localStartTime) {
    const value = formatLocalTime(item.localStartTime);
    if (!value) return null;
    const [hour = 0, minute = 0] = value.split(':').map(Number);
    return hour * 60 + minute;
  }

  const window = DAY_PART_WINDOWS[item.dayPart as keyof typeof DAY_PART_WINDOWS];
  return window?.startMinute ?? null;
}

/**
 * Where a timed item belongs among siblings already in position order.
 *
 * Untimed siblings are transparent: they are anchors the traveller placed
 * deliberately, so they keep whichever side of the new item they already sat on.
 * Only timed siblings decide the boundary, which is the index of the first one
 * starting strictly later — so equal times keep the incumbent first and the
 * arrival lands after it.
 */
export function timedInsertIndex(siblings: ItemSchedulePosition[], key: number) {
  const index = siblings.findIndex((sibling) => {
    const minute = itemSortMinute(sibling);
    return minute !== null && minute > key;
  });

  return index === -1 ? siblings.length : index;
}

/**
 * Moves `itemId` to where its own clock says it belongs within its day.
 *
 * A no-op for an untimed item, and for a timed one already in the right slot, so
 * callers can invoke it unconditionally after a write. The reorder goes through
 * `planReorderWrites` because position is uniquely indexed per day.
 */
async function reslotItemByTime(
  transaction: Prisma.TransactionClient,
  tripId: string,
  itineraryDayId: string,
  itemId: string,
  schedule: ItemSchedulePosition,
) {
  const key = itemSortMinute(schedule);
  if (key === null) return;

  // One read serves all three needs: the siblings that decide the boundary, the
  // order to compare against, and the highest position to park above.
  const day = await transaction.itineraryItem.findMany({
    where: { itineraryDayId, tripId },
    orderBy: { position: 'asc' },
    select: { dayPart: true, id: true, localStartTime: true, position: true },
  });
  const siblings = day.filter((candidate) => candidate.id !== itemId);
  const orderedIds = siblings.map((sibling) => sibling.id);
  orderedIds.splice(timedInsertIndex(siblings, key), 0, itemId);
  if (sameIds(day, orderedIds)) return;

  const above = (day.at(-1)?.position ?? -1) + 1;
  for (const write of planReorderWrites(orderedIds, above)) {
    await transaction.itineraryItem.update({
      where: { id: write.id },
      data: { position: write.position },
    });
  }
}

export type ItineraryDayMoveWrite = {
  id: string;
  itineraryDayId: string;
  position: number;
};

/**
 * Parks both day lists above every final slot before assigning either list.
 * This keeps each statement clear of the partial unique index on
 * (`itinerary_day_id`, `position`) for both append and swap operations.
 */
export function planItineraryDayMoveWrites(
  sourceDayId: string,
  sourceItemIds: string[],
  targetDayId: string,
  targetItemIds: string[],
  strategy: ItineraryDayMoveInput['strategy'],
) {
  const parkFrom = sourceItemIds.length + targetItemIds.length;
  const parking: ItineraryDayMoveWrite[] = [
    ...sourceItemIds.map((id, index) => ({
      id,
      itineraryDayId: sourceDayId,
      position: parkFrom + index,
    })),
    ...targetItemIds.map((id, index) => ({
      id,
      itineraryDayId: targetDayId,
      position: parkFrom + index,
    })),
  ];
  const sourceFinalIds = strategy === 'swap' ? targetItemIds : [];
  const targetFinalIds = strategy === 'swap' ? sourceItemIds : [...targetItemIds, ...sourceItemIds];
  const final: ItineraryDayMoveWrite[] = [
    ...sourceFinalIds.map((id, position) => ({ id, itineraryDayId: sourceDayId, position })),
    ...targetFinalIds.map((id, position) => ({ id, itineraryDayId: targetDayId, position })),
  ];
  return { final, parking };
}

function sameIds(actual: Array<{ id: string }>, expected: string[]) {
  return (
    actual.length === expected.length && actual.every((item, index) => item.id === expected[index])
  );
}

function dayBase(day: ItineraryDayBase): ItineraryDayBase {
  return {
    dailyBaseDepartureTripPlaceId: day.dailyBaseDepartureTripPlaceId,
    dailyBaseTripPlaceId: day.dailyBaseTripPlaceId,
  };
}

function sameDayBase(day: ItineraryDayBase, expected: ItineraryDayBase) {
  return (
    day.dailyBaseTripPlaceId === expected.dailyBaseTripPlaceId &&
    day.dailyBaseDepartureTripPlaceId === expected.dailyBaseDepartureTripPlaceId
  );
}

export async function moveItineraryDayPlan(
  userId: string,
  tripId: string,
  sourceDayId: string,
  input: ItineraryDayMoveInput,
) {
  if (sourceDayId === input.targetItineraryDayId) {
    throw new ItineraryValidationError('invalid_itinerary_day_move');
  }
  const prisma = getPrismaClient();
  try {
    await prisma.$transaction(
      async (transaction) => {
        await findOwnedTrip(transaction, userId, tripId);
        const [sourceDay, targetDay] = await Promise.all([
          findDay(transaction, tripId, sourceDayId),
          findDay(transaction, tripId, input.targetItineraryDayId),
        ]);
        const itemInclude = { tripPlace: { include: { place: true } } } as const;
        const [sourceItems, targetItems] = await Promise.all([
          transaction.itineraryItem.findMany({
            where: { itineraryDayId: sourceDay.id, tripId },
            include: itemInclude,
            orderBy: { position: 'asc' },
          }),
          transaction.itineraryItem.findMany({
            where: { itineraryDayId: targetDay.id, tripId },
            include: itemInclude,
            orderBy: { position: 'asc' },
          }),
        ]);
        if (
          !sourceItems.length ||
          !sameDayBase(sourceDay, input.expectedSourceBase) ||
          !sameDayBase(targetDay, input.expectedTargetBase) ||
          !sameIds(sourceItems, input.expectedSourceItemIds) ||
          !sameIds(targetItems, input.expectedTargetItemIds)
        ) {
          throw new ItineraryConflictError('itinerary_day_conflict');
        }

        const writes = planItineraryDayMoveWrites(
          sourceDay.id,
          sourceItems.map(({ id }) => id),
          targetDay.id,
          targetItems.map(({ id }) => id),
          input.strategy,
        );
        const sourceBase = dayBase(sourceDay);
        const targetBase = dayBase(targetDay);
        await transaction.itineraryDay.update({
          where: { id: sourceDay.id },
          data:
            input.strategy === 'swap'
              ? targetBase
              : { dailyBaseDepartureTripPlaceId: null, dailyBaseTripPlaceId: null },
        });
        await transaction.itineraryDay.update({
          where: { id: targetDay.id },
          data: sourceBase,
        });
        await refreshDayDefaultTimeZone(transaction, tripId, sourceDay.id);
        await refreshDayDefaultTimeZone(transaction, tripId, targetDay.id);
        const [refreshedSourceDay, refreshedTargetDay] = await Promise.all([
          findDay(transaction, tripId, sourceDay.id),
          findDay(transaction, tripId, targetDay.id),
        ]);
        for (const write of writes.parking) {
          await transaction.itineraryItem.update({
            where: { id: write.id },
            data: { itineraryDayId: write.itineraryDayId, position: write.position },
          });
        }

        const itemsById = new Map([...sourceItems, ...targetItems].map((item) => [item.id, item]));
        const daysById = new Map([
          [refreshedSourceDay.id, refreshedSourceDay],
          [refreshedTargetDay.id, refreshedTargetDay],
        ]);
        for (const write of writes.final) {
          const item = itemsById.get(write.id);
          const day = daysById.get(write.itineraryDayId);
          if (!item || !day) throw new ItineraryConflictError('itinerary_day_conflict');
          const movingDay = item.itineraryDayId !== day.id;
          const timeZone = movingDay
            ? resolveItemTimeZone({
                customLocationTimeZone: item.customLocationTimeZone,
                dayTimeZone: day.defaultTimeZone,
                tripPlaceTimeZone: item.tripPlace?.place.customTimeZone ?? null,
              })
            : null;
          const schedule =
            timeZone && item.localStartTime && item.timeSemantics === 'FLOATING_LOCAL'
              ? scheduleData(
                  { kind: 'exact', localTime: formatLocalTime(item.localStartTime) ?? '' },
                  formatDateOnly(day.date),
                  timeZone.timeZone,
                )
              : null;
          await transaction.itineraryItem.update({
            where: { id: write.id },
            data: {
              itineraryDayId: day.id,
              position: write.position,
              ...(timeZone
                ? {
                    startInstant: schedule?.startInstant ?? item.startInstant,
                    timeZone: timeZone.timeZone,
                    timeZoneResolvedAt: new Date(),
                    timeZoneSource: timeZone.source,
                  }
                : {}),
            },
          });
        }
        await refreshDayDefaultTimeZone(transaction, tripId, sourceDay.id);
        await refreshDayDefaultTimeZone(transaction, tripId, targetDay.id);
      },
      { isolationLevel: 'Serializable' },
    );
  } catch (error) {
    if (
      error instanceof ItineraryConflictError ||
      error instanceof ItineraryNotFoundError ||
      error instanceof ItineraryValidationError
    ) {
      throw error;
    }
    if (typeof error === 'object' && error && 'code' in error && error.code === 'P2034') {
      throw new ItineraryConflictError('itinerary_day_conflict');
    }
    throw error;
  }
}

export async function organizeItineraryItem(
  userId: string,
  tripId: string,
  itemId: string,
  input: { itineraryDayId: string | null; position: number },
  expectedUpdatedAt?: string,
) {
  const prisma = getPrismaClient();
  await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    const current = await transaction.itineraryItem.findFirst({
      where: { id: itemId, tripId },
      include: itineraryItemInclude,
    });
    if (!current) throw new ItineraryNotFoundError('itinerary_item_not_found');
    if (expectedUpdatedAt && current.updatedAt.toISOString() !== expectedUpdatedAt) {
      throw new ItineraryConflictError();
    }
    const targetDay = input.itineraryDayId
      ? await findDay(transaction, tripId, input.itineraryDayId)
      : null;
    const siblings = await transaction.itineraryItem.findMany({
      where: {
        id: { not: itemId },
        itineraryDayId: input.itineraryDayId,
        tripId,
      },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    const position = Math.min(Math.max(input.position, 0), siblings.length);
    siblings.splice(position, 0, { id: itemId });
    const highestPosition = await transaction.itineraryItem.aggregate({
      where: { itineraryDayId: input.itineraryDayId, tripId },
      _max: { position: true },
    });
    const writes = planReorderWrites(
      siblings.map((item) => item.id),
      (highestPosition._max.position ?? -1) + 1,
    );
    for (const write of writes) {
      await transaction.itineraryItem.update({
        where: { id: write.id },
        // Setting the day on every write is what moves the item being reordered onto
        // the target day, and it frees its old slot on the parking pass rather than
        // on the final one.
        data: { itineraryDayId: input.itineraryDayId, position: write.position },
      });
    }

    const movingDay = current.itineraryDayId !== input.itineraryDayId;
    const targetTripPlace = movingDay
      ? await findTripPlace(transaction, tripId, current.tripPlaceId)
      : null;
    const timeZone = targetDay
      ? resolveItemTimeZone({
          customLocationTimeZone: current.customLocationTimeZone,
          dayTimeZone: targetDay.defaultTimeZone,
          tripPlaceTimeZone: targetTripPlace?.place.customTimeZone ?? null,
        })
      : null;
    const schedule =
      targetDay && current.localStartTime && current.timeSemantics === 'FLOATING_LOCAL' && timeZone
        ? scheduleData(
            { kind: 'exact', localTime: formatLocalTime(current.localStartTime) ?? '' },
            formatDateOnly(targetDay.date),
            timeZone.timeZone,
          )
        : null;
    await transaction.itineraryItem.update({
      where: { id: itemId },
      data: {
        itineraryDayId: input.itineraryDayId,
        position,
        ...(timeZone
          ? {
              startInstant: schedule?.startInstant ?? current.startInstant,
              timeZone: timeZone.timeZone,
              timeZoneResolvedAt: new Date(),
              timeZoneSource: timeZone.source,
            }
          : {}),
      },
    });
    if (current.itineraryDayId)
      await refreshDayDefaultTimeZone(transaction, tripId, current.itineraryDayId);
    if (targetDay && targetDay.id !== current.itineraryDayId) {
      await refreshDayDefaultTimeZone(transaction, tripId, targetDay.id);
    }
  });
}

export async function duplicateItineraryItem(userId: string, tripId: string, itemId: string) {
  const prisma = getPrismaClient();
  await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    const current = await transaction.itineraryItem.findFirst({ where: { id: itemId, tripId } });
    if (!current) throw new ItineraryNotFoundError('itinerary_item_not_found');
    const maxPosition = await transaction.itineraryItem.aggregate({
      where: { itineraryDayId: current.itineraryDayId, tripId },
      _max: { position: true },
    });
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...copy } = current;
    await transaction.itineraryItem.create({
      data: {
        ...copy,
        position: (maxPosition._max.position ?? -1) + 1,
        travelStatus: 'UPCOMING',
      },
    });
  });
}

export async function setItineraryDayBase(
  userId: string,
  tripId: string,
  itineraryDayId: string,
  tripPlaceId: string | null,
  departureTripPlaceId?: string | null,
) {
  const prisma = getPrismaClient();
  await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    await findDay(transaction, tripId, itineraryDayId);
    await findTripPlace(transaction, tripId, tripPlaceId);
    if (departureTripPlaceId !== undefined) {
      await findTripPlace(transaction, tripId, departureTripPlaceId);
    }
    await transaction.itineraryDay.update({
      where: { id: itineraryDayId },
      data: {
        dailyBaseTripPlaceId: tripPlaceId,
        ...(departureTripPlaceId !== undefined
          ? { dailyBaseDepartureTripPlaceId: departureTripPlaceId }
          : {}),
      },
    });
    await refreshDayDefaultTimeZone(transaction, tripId, itineraryDayId);
  });
}

export async function updateItineraryDayNote(
  userId: string,
  tripId: string,
  itineraryDayId: string,
  note: string | null,
) {
  const prisma = getPrismaClient();
  const result = await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    const day = await findDay(transaction, tripId, itineraryDayId);
    return transaction.itineraryDay.update({
      where: { id: day.id },
      data: { notes: note?.trim() || null },
      select: { id: true, notes: true },
    });
  });
  return { id: result.id, notes: result.notes };
}

export async function updateItineraryDayName(
  userId: string,
  tripId: string,
  itineraryDayId: string,
  name: string | null,
) {
  const prisma = getPrismaClient();
  const result = await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    const day = await findDay(transaction, tripId, itineraryDayId);
    return transaction.itineraryDay.update({
      where: { id: day.id },
      data: { name: name?.trim() || null },
      select: { id: true, name: true },
    });
  });
  return { id: result.id, name: result.name };
}

/**
 * Experience Rating is the traveller's own private reflection on how the day
 * felt, separate from Plan Score's computed planning-quality signal and from
 * any provider/public Place rating (PRD section 30). It never feeds the
 * overall trip rating, which is entered and cleared independently.
 */
export async function updateItineraryDayExperienceRating(
  userId: string,
  tripId: string,
  itineraryDayId: string,
  rating: number | null,
  note: string | null | undefined,
) {
  const prisma = getPrismaClient();
  const result = await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    const day = await findDay(transaction, tripId, itineraryDayId);
    return transaction.itineraryDay.update({
      where: { id: day.id },
      data: {
        experienceRating: rating,
        ...(note === undefined ? {} : { experienceNote: note?.trim() || null }),
      },
      select: { experienceNote: true, experienceRating: true, id: true },
    });
  });
  return {
    experienceNote: result.experienceNote,
    experienceRating: result.experienceRating,
    id: result.id,
  };
}

export async function createItineraryItem(
  userId: string,
  tripId: string,
  input: ItineraryItemInput & { itineraryDayId: string; schedule: ItineraryScheduleInput },
) {
  const prisma = getPrismaClient();
  const itemId = await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    if (input.clientItemId) {
      const existing = await transaction.itineraryItem.findUnique({
        where: { id: input.clientItemId },
        select: { id: true, tripId: true },
      });
      if (existing?.tripId === tripId) return existing.id;
      if (existing) throw new ItineraryValidationError('invalid_itinerary_item');
    }
    const day = await findDay(transaction, tripId, input.itineraryDayId);
    const tripPlace = await findTripPlace(transaction, tripId, input.tripPlaceId ?? null);
    const customLabel = normalizeContent(input.customLabel, tripPlace?.id ?? null);
    const customLocation = normalizeLocation(input.customLocation);
    const timeZone = resolveItemTimeZone({
      customLocationTimeZone: customLocation.timeZone,
      dayTimeZone: day.defaultTimeZone,
      tripPlaceTimeZone: tripPlace?.place.customTimeZone ?? null,
    });
    const position =
      (
        await transaction.itineraryItem.aggregate({
          where: { itineraryDayId: day.id, tripId },
          _max: { position: true },
        })
      )._max.position ?? -1;
    const schedule = scheduleData(input.schedule, formatDateOnly(day.date), timeZone.timeZone);
    const timing = resolveItemTiming(input, schedule.localStartTime);
    const item = await transaction.itineraryItem.create({
      data: {
        ...(input.clientItemId ? { id: input.clientItemId } : {}),
        customLabel,
        customLocation: customLocation.label,
        customLocationTimeZone: customLocation.timeZone,
        dayPart: schedule.dayPart,
        durationMinutes: timing.durationMinutes,
        itineraryDayId: day.id,
        localEndTime: timing.localEndTime,
        localStartTime: schedule.localStartTime,
        notes: input.notes?.trim() || null,
        plannedCostAmount: input.plannedCost?.amount ?? null,
        plannedCostCurrencyCode: input.plannedCost?.currencyCode ?? null,
        position: position + 1,
        priority: mapPriorityInput(input.priority ?? null),
        startInstant: schedule.startInstant,
        timeSemantics: schedule.timeSemantics,
        timeZone: timeZone.timeZone,
        timeZoneResolvedAt: new Date(),
        timeZoneSource: timeZone.source,
        tripId,
        tripPlaceId: tripPlace?.id ?? null,
      },
    });
    await reslotItemByTime(transaction, tripId, day.id, item.id, schedule);
    await refreshDayDefaultTimeZone(transaction, tripId, day.id);
    return item.id;
  });

  const item = await prisma.itineraryItem.findFirst({
    where: { id: itemId, trip: { ownerId: userId }, tripId },
    include: itineraryItemInclude,
  });
  if (!item) throw new ItineraryNotFoundError('itinerary_item_not_found');
  return serializeItineraryItem(item);
}

export async function updateItineraryItem(
  userId: string,
  tripId: string,
  itemId: string,
  input: ItineraryItemInput,
  expectedUpdatedAt?: string,
) {
  const prisma = getPrismaClient();
  const result = await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    const current = await transaction.itineraryItem.findFirst({
      where: { id: itemId, tripId },
      include: itineraryItemInclude,
    });
    if (!current || !current.itineraryDayId || !current.itineraryDay) {
      throw new ItineraryNotFoundError('itinerary_item_not_found');
    }
    if (expectedUpdatedAt && current.updatedAt.toISOString() !== expectedUpdatedAt) {
      throw new ItineraryConflictError();
    }

    const tripPlaceId = input.tripPlaceId === undefined ? current.tripPlaceId : input.tripPlaceId;
    const tripPlace = await findTripPlace(transaction, tripId, tripPlaceId);
    const customLabel = normalizeContent(
      input.customLabel === undefined ? current.customLabel : input.customLabel,
      tripPlace?.id ?? null,
    );
    const customLocation =
      input.customLocation === undefined
        ? {
            label: current.customLocation,
            timeZone: current.customLocationTimeZone,
          }
        : normalizeLocation(input.customLocation);
    const previousLocalTime = formatLocalTime(current.localStartTime);
    const nextLocalTime =
      input.schedule?.kind === 'exact'
        ? input.schedule.localTime
        : input.schedule
          ? null
          : previousLocalTime;
    const shouldResolveTimeZone =
      tripPlaceId !== current.tripPlaceId ||
      customLocation.label !== current.customLocation ||
      customLocation.timeZone !== current.customLocationTimeZone ||
      nextLocalTime !== previousLocalTime;
    const timeZone = shouldResolveTimeZone
      ? resolveItemTimeZone({
          customLocationTimeZone: customLocation.timeZone,
          dayTimeZone: current.itineraryDay.defaultTimeZone,
          tripPlaceTimeZone: tripPlace?.place.customTimeZone ?? null,
        })
      : {
          source: current.timeZoneSource ?? ('DAY_DEFAULT' as const),
          timeZone: current.timeZone ?? current.itineraryDay.defaultTimeZone,
        };
    const schedule = input.schedule
      ? scheduleData(input.schedule, formatDateOnly(current.itineraryDay.date), timeZone.timeZone)
      : current.localStartTime && current.timeSemantics === 'FLOATING_LOCAL'
        ? scheduleData(
            { kind: 'exact', localTime: formatLocalTime(current.localStartTime) ?? '' },
            formatDateOnly(current.itineraryDay.date),
            timeZone.timeZone,
          )
        : {
            dayPart: current.dayPart,
            localStartTime: current.localStartTime,
            startInstant: current.startInstant,
            timeSemantics: current.timeSemantics,
          };
    const timing = resolveItemTiming(input, schedule.localStartTime, current);

    const updated = await transaction.itineraryItem.update({
      where: { id: itemId },
      data: {
        customLabel,
        customLocation: customLocation.label,
        customLocationTimeZone: customLocation.timeZone,
        dayPart: schedule.dayPart,
        durationMinutes: timing.durationMinutes,
        localEndTime: timing.localEndTime,
        localStartTime: schedule.localStartTime,
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
        ...(input.plannedCost !== undefined
          ? {
              plannedCostAmount: input.plannedCost?.amount ?? null,
              plannedCostCurrencyCode: input.plannedCost?.currencyCode ?? null,
            }
          : {}),
        ...(input.priority !== undefined ? { priority: mapPriorityInput(input.priority) } : {}),
        startInstant: schedule.startInstant,
        timeSemantics: schedule.timeSemantics,
        ...(shouldResolveTimeZone || !current.timeZone
          ? {
              timeZone: timeZone.timeZone,
              timeZoneResolvedAt: new Date(),
              timeZoneSource: timeZone.source,
            }
          : {}),
        tripPlaceId: tripPlace?.id ?? null,
      },
      include: itineraryItemInclude,
    });
    // Retiming an item should move it, but only when the clock actually changed —
    // an unrelated edit must never disturb an order the traveller arranged.
    if (itemSortMinute(current) !== itemSortMinute(updated)) {
      await reslotItemByTime(transaction, tripId, current.itineraryDayId, itemId, updated);
    }
    await refreshDayDefaultTimeZone(transaction, tripId, current.itineraryDayId);

    const previousInstant = current.startInstant?.toISOString() ?? null;
    const nextInstant = updated.startInstant?.toISOString() ?? null;
    return {
      item: serializeItineraryItem(updated),
      timeZoneConsequence:
        previousInstant && nextInstant && previousInstant !== nextInstant
          ? {
              kind: 'derived_instant_changed' as const,
              previousStartInstant: previousInstant,
              startInstant: nextInstant,
            }
          : null,
    };
  });

  return result;
}

export async function deleteItineraryItem(
  userId: string,
  tripId: string,
  itemId: string,
  expectedUpdatedAt?: string,
) {
  const prisma = getPrismaClient();
  await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    const item = await transaction.itineraryItem.findFirst({
      where: { id: itemId, tripId },
      select: { id: true, itineraryDayId: true, updatedAt: true },
    });
    if (!item) throw new ItineraryNotFoundError('itinerary_item_not_found');
    if (expectedUpdatedAt && item.updatedAt.toISOString() !== expectedUpdatedAt) {
      throw new ItineraryConflictError();
    }
    if (item.itineraryDayId) {
      await refreshDayDefaultTimeZone(transaction, tripId, item.itineraryDayId, item.id);
    }
    await unlinkItineraryItemReferences(transaction, tripId, item.id);
    await transaction.itineraryItem.delete({ where: { id: item.id } });
  });
}
