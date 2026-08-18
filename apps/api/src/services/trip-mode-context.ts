import { getPrismaClient, type Prisma } from '@trove/db';

import { DAY_PART_ORDER, dayPartIndexForHour } from './day-part-windows.js';
import { floatingLocalTimeToInstant, formatInstantInTimeZone } from './itinerary-rules.js';
import { getItineraryDayRoutes } from './itinerary-routes.js';
import {
  itineraryItemInclude,
  ItineraryConflictError,
  ItineraryNotFoundError,
  serializeItineraryItem,
} from './itineraries.js';
import { hydratePlaceSnapshots } from './place-data.js';
import type { PlacesService } from './places.js';
import type { RoutesService } from './routes.js';
import { formatDateOnly, getLocalDate, parseDateOnly } from './trip-rules.js';

export type ItineraryTravelStatus = 'completed' | 'skipped' | 'upcoming';

type ContextItemRecord = Prisma.ItineraryItemGetPayload<{
  include: typeof itineraryItemInclude;
}>;

type ItemPhase = 'current_day_part' | 'current_exact' | 'flexible' | 'future' | 'overdue';

export type TripModeContextOptions = {
  at?: Date;
  languageCode?: string;
  preview?: { date: string; time: string };
  routeBufferSeconds?: number | null;
};

/** Test seam only: production callers never override these, so the real
 * `createPlacesService`/`createRoutesService` factories inside
 * `getItineraryDayRoutes` keep deciding what runs. */
export type TripModeContextServices = {
  placesService?: PlacesService | null;
  routesService?: RoutesService | null;
};

export class TripModeContextValidationError extends Error {
  constructor(public readonly code: 'invalid_preview_time') {
    super(code);
  }
}

// Derived from the shared window definitions so Trip Mode's sense of "now" and
// Plan Score's daypart evidence cannot drift apart.
const dayPartOrder = {
  AFTERNOON: DAY_PART_ORDER.indexOf('AFTERNOON'),
  EVENING: DAY_PART_ORDER.indexOf('EVENING'),
  MORNING: DAY_PART_ORDER.indexOf('MORNING'),
} as const;

function mapTravelStatus(value: ItineraryTravelStatus) {
  const values = {
    completed: 'COMPLETED',
    skipped: 'SKIPPED',
    upcoming: 'UPCOMING',
  } as const;
  return values[value];
}

const getCurrentDayPart = dayPartIndexForHour;

function compareLocalDate(localDate: string, itemDate: string) {
  if (localDate < itemDate) return 'future' as const;
  if (localDate > itemDate) return 'overdue' as const;
  return 'same_day' as const;
}

function resolveItemPhase(
  item: ContextItemRecord,
  itemDate: string,
  dayTimeZone: string,
  at: Date,
): ItemPhase {
  if (item.startInstant) {
    const start = item.startInstant.getTime();
    const now = at.getTime();
    if (now < start) return 'future';
    if (item.durationMinutes && now < start + item.durationMinutes * 60_000) {
      return 'current_exact';
    }
    return 'overdue';
  }

  const timeZone = item.timeZone ?? dayTimeZone;
  const local = formatInstantInTimeZone(at, timeZone);
  const datePhase = compareLocalDate(local.date, itemDate);
  if (datePhase !== 'same_day') return datePhase;

  if (!item.dayPart || item.dayPart === 'ANYTIME') return 'flexible';
  const currentDayPart = getCurrentDayPart(Number(local.time.slice(0, 2)));
  const itemDayPart = dayPartOrder[item.dayPart];
  if (currentDayPart < itemDayPart) return 'future';
  if (currentDayPart > itemDayPart) return 'overdue';
  return 'current_day_part';
}

function selectCurrentOrRelevant(items: ContextItemRecord[], phases: Map<string, ItemPhase>) {
  const priorities: ItemPhase[] = ['current_exact', 'current_day_part', 'overdue', 'flexible'];

  for (const phase of priorities) {
    const item = items.find((candidate) => phases.get(candidate.id) === phase);
    if (!item) continue;
    if (phase === 'current_exact') {
      return { item, kind: 'current' as const, reason: 'exact_time' as const };
    }
    if (phase === 'current_day_part') {
      return { item, kind: 'relevant' as const, reason: 'day_part' as const };
    }
    if (phase === 'overdue') {
      return { item, kind: 'relevant' as const, reason: 'overdue' as const };
    }
    return { item, kind: 'relevant' as const, reason: 'itinerary_order' as const };
  }

  return null;
}

function selectNextItem(
  items: ContextItemRecord[],
  phases: Map<string, ItemPhase>,
  currentOrRelevant: ReturnType<typeof selectCurrentOrRelevant>,
) {
  if (!currentOrRelevant) {
    return items.find((item) => phases.get(item.id) === 'future') ?? null;
  }

  const currentIndex = items.findIndex((item) => item.id === currentOrRelevant.item.id);
  return items.slice(currentIndex + 1).at(0) ?? null;
}

async function resolveLeaveBy(input: {
  bufferSeconds: number | null;
  contextAt: Date;
  currentItem: ContextItemRecord | null;
  dayId: string;
  languageCode?: string;
  nextItem: ContextItemRecord | null;
  services: TripModeContextServices;
  tripId: string;
  userId: string;
}) {
  if (
    !input.currentItem?.tripPlaceId ||
    !input.nextItem?.tripPlaceId ||
    !input.nextItem.startInstant ||
    input.nextItem.startInstant <= input.contextAt
  ) {
    return null;
  }

  const routes = await getItineraryDayRoutes(
    input.userId,
    input.tripId,
    input.dayId,
    {
      itemIds: [input.currentItem.id, input.nextItem.id],
      languageCode: input.languageCode,
    },
    input.services,
  );
  const segment = routes.segments.find(
    (candidate) =>
      candidate.origin.kind === 'itinerary_item' &&
      candidate.origin.id === input.currentItem?.id &&
      candidate.destination.kind === 'itinerary_item' &&
      candidate.destination.id === input.nextItem?.id,
  );
  if (segment?.status !== 'ok' || segment.durationSeconds === null) return null;

  const bufferSeconds = Math.max(0, Math.floor(input.bufferSeconds ?? 0));
  const leaveAt = new Date(
    input.nextItem.startInstant.getTime() - (segment.durationSeconds + bufferSeconds) * 1_000,
  );

  return {
    at: leaveAt.toISOString(),
    bufferSeconds: input.bufferSeconds === null ? null : bufferSeconds,
    destinationItemId: input.nextItem.id,
    distanceMeters: segment.distanceMeters,
    mode: segment.mode,
    originItemId: input.currentItem.id,
    provider: segment.provider,
    routeDurationSeconds: segment.durationSeconds,
    targetStartAt: input.nextItem.startInstant.toISOString(),
  };
}

export async function resolveTripModeContext(
  userId: string,
  tripId: string,
  options: TripModeContextOptions = {},
  services: TripModeContextServices = {},
) {
  const prisma = getPrismaClient();
  const trip = await prisma.trip.findFirst({
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

  let at = options.at ?? new Date();
  const selectedDate = options.preview?.date ?? getLocalDate(at, trip.referenceTimeZone);
  const day = await prisma.itineraryDay.findFirst({
    where: { date: parseDateOnly(selectedDate), tripId: trip.id },
    include: {
      items: {
        include: itineraryItemInclude,
        orderBy: { position: 'asc' },
      },
    },
  });
  if (options.preview) {
    try {
      at = floatingLocalTimeToInstant(
        options.preview.date,
        options.preview.time,
        day?.defaultTimeZone ?? trip.referenceTimeZone,
      );
    } catch {
      throw new TripModeContextValidationError('invalid_preview_time');
    }
  }

  const base = {
    contextAt: at.toISOString(),
    contextSource: options.at || options.preview ? ('preview' as const) : ('live' as const),
    selectedDate,
    trip: {
      endDate: formatDateOnly(trip.endDate),
      id: trip.id,
      name: trip.name,
      referenceTimeZone: trip.referenceTimeZone,
      startDate: formatDateOnly(trip.startDate),
    },
  };

  if (!day) {
    return {
      ...base,
      currentOrRelevant: null,
      day: null,
      leaveBy: null,
      nextItemId: null,
      state: 'no_day' as const,
    };
  }

  const activeItems = day.items.filter((item) => item.travelStatus === 'UPCOMING');
  const dayDate = formatDateOnly(day.date);
  const phases = new Map(
    activeItems.map((item) => [item.id, resolveItemPhase(item, dayDate, day.defaultTimeZone, at)]),
  );
  const currentOrRelevant = selectCurrentOrRelevant(activeItems, phases);
  const nextItem = selectNextItem(activeItems, phases, currentOrRelevant);
  const leaveBy = await resolveLeaveBy({
    bufferSeconds: options.routeBufferSeconds ?? null,
    contextAt: at,
    currentItem: currentOrRelevant?.item ?? null,
    dayId: day.id,
    languageCode: options.languageCode,
    nextItem,
    services,
    tripId: trip.id,
    userId,
  });

  // Trip Mode renders the same Places the itinerary does, so it reads the same
  // snapshots rather than re-resolving them on every tab.
  const snapshots = await hydratePlaceSnapshots(
    day.items.flatMap(
      (item) =>
        item.tripPlace?.place.providerRefs.map((reference) => reference.externalPlaceId) ?? [],
    ),
    { languageCode: options.languageCode },
  );

  return {
    ...base,
    currentOrRelevant: currentOrRelevant
      ? {
          itemId: currentOrRelevant.item.id,
          kind: currentOrRelevant.kind,
          reason: currentOrRelevant.reason,
        }
      : null,
    day: {
      date: dayDate,
      defaultTimeZone: day.defaultTimeZone,
      id: day.id,
      items: day.items.map((item) => serializeItineraryItem(item, { snapshots })),
    },
    leaveBy,
    nextItemId: nextItem?.id ?? null,
    state:
      activeItems.length === 0
        ? ('no_next_item' as const)
        : currentOrRelevant?.kind === 'current'
          ? ('current' as const)
          : currentOrRelevant
            ? ('relevant' as const)
            : ('free_time' as const),
  };
}

export async function updateItineraryItemTravelStatus(
  userId: string,
  tripId: string,
  itemId: string,
  travelStatus: ItineraryTravelStatus,
  expectedUpdatedAt?: string,
) {
  const prisma = getPrismaClient();
  const item = await prisma.itineraryItem.findFirst({
    where: { id: itemId, tripId, trip: { ownerId: userId } },
    select: { id: true, updatedAt: true },
  });
  if (!item) throw new ItineraryNotFoundError('itinerary_item_not_found');
  if (expectedUpdatedAt && item.updatedAt.toISOString() !== expectedUpdatedAt) {
    throw new ItineraryConflictError();
  }

  await prisma.itineraryItem.update({
    where: { id: item.id },
    data: { travelStatus: mapTravelStatus(travelStatus) },
  });

  return { id: item.id, travelStatus };
}
