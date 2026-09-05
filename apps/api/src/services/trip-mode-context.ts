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
import { placeProviderRefInclude, serializeCanonicalPlace } from './place-serializer.js';
import type { PlacesService } from './places.js';
import type { RouteTravelMode, RoutesService } from './routes.js';
import { formatDateOnly, getLocalDate, parseDateOnly } from './trip-rules.js';

export type ItineraryTravelStatus = 'completed' | 'skipped' | 'upcoming';

type ContextItemRecord = Prisma.ItineraryItemGetPayload<{
  include: typeof itineraryItemInclude;
}>;

type ContextScheduleItem = Pick<
  ContextItemRecord,
  'dayPart' | 'durationMinutes' | 'id' | 'startInstant' | 'timeZone'
>;

type ItemPhase = 'current_day_part' | 'current_exact' | 'flexible' | 'future' | 'overdue';

const FINAL_UNTIMED_DURATION_MINUTES = 60;

/** A Trip Place read only for its name and coordinates, never re-resolved. */
const legBaseInclude = { include: { place: { include: placeProviderRefInclude } } } as const;

type LegBaseRecord = Prisma.TripPlaceGetPayload<typeof legBaseInclude>;

export type TripModeLegEndpoint = {
  coordinate: { latitude: number; longitude: number } | null;
  id: string;
  kind: 'daily_base' | 'itinerary_item';
  /** Null when nothing has named the Place yet; the caller owns the fallback. */
  name: string | null;
};

/**
 * The hop the traveller is on, as geometry rather than as a route.
 *
 * `leaveBy` answers "when must I go", which needs a routed duration and so can
 * only ever describe two stops Trove has paid to measure between. This answers
 * the cheaper question - which two places, which way of travelling - and it
 * answers it for the parts of a day `leaveBy` cannot reach: the morning leg out
 * of the daily base, and the evening one back to it. Both ends are already in
 * the database, so nothing here reaches a provider.
 */
export type TripModeLeg = {
  destination: TripModeLegEndpoint;
  mode: RouteTravelMode;
  origin: TripModeLegEndpoint;
};

function mapTravelMode(value: string): RouteTravelMode {
  if (value === 'FLIGHT') return 'flight';
  if (value === 'TRANSIT') return 'transit';
  if (value === 'WALK') return 'walk';
  return 'drive';
}

function toEndpointCoordinate(place: ReturnType<typeof serializeCanonicalPlace>) {
  return place.location
    ? { latitude: place.location.latitude, longitude: place.location.longitude }
    : null;
}

/**
 * The name chain the timeline and the map already read, said once more here so
 * a stop is called the same thing on the bar as it is in the day's list.
 */
function placeName(place: ReturnType<typeof serializeCanonicalPlace>) {
  return place.name ?? place.snapshot?.name ?? place.providerLabel ?? null;
}

/**
 * Whether the two ends are the same place, which is not a leg but a standstill.
 *
 * A traveller sleeping at the last stop they visited has nowhere left to go,
 * and a line drawn from a place to itself reads as nought metres of travel
 * rather than as the nothing it actually is. Only located ends can be compared:
 * two places nobody has pinned are unknown, not identical.
 */
function sameLocation(origin: TripModeLegEndpoint, destination: TripModeLegEndpoint) {
  if (!origin.coordinate || !destination.coordinate) return false;

  return (
    origin.coordinate.latitude === destination.coordinate.latitude &&
    origin.coordinate.longitude === destination.coordinate.longitude
  );
}

function itemEndpoint(item: ContextItemRecord): TripModeLegEndpoint | null {
  if (!item.tripPlace) {
    return item.customLabel
      ? { coordinate: null, id: item.id, kind: 'itinerary_item', name: item.customLabel }
      : null;
  }

  const place = serializeCanonicalPlace(item.tripPlace.place);

  return {
    coordinate: toEndpointCoordinate(place),
    id: item.id,
    kind: 'itinerary_item',
    name: item.customLabel ?? item.tripPlace.customName ?? placeName(place),
  };
}

function baseEndpoint(tripPlace: LegBaseRecord | null): TripModeLegEndpoint | null {
  if (!tripPlace) return null;
  const place = serializeCanonicalPlace(tripPlace.place);

  return {
    coordinate: toEndpointCoordinate(place),
    id: tripPlace.id,
    kind: 'daily_base',
    name: tripPlace.customName ?? placeName(place),
  };
}

/**
 * Which two places the traveller is between, and how they are getting there.
 *
 * The chain is walked in position order rather than from the current-item
 * selection, because that is the order the route planner itself builds and the
 * order `travelModeToNext` describes - the mode belongs to the stop the leg
 * leaves, not to the one it arrives at.
 */
export function resolveTripModeLeg(input: {
  arrivalBase: LegBaseRecord | null;
  departureBase: LegBaseRecord | null;
  dayStartMode: string;
  items: readonly ContextItemRecord[];
  nextItemId: string | null;
}): TripModeLeg | null {
  const { arrivalBase, departureBase, dayStartMode, items, nextItemId } = input;

  if (nextItemId) {
    const index = items.findIndex((item) => item.id === nextItemId);
    if (index < 0) return null;

    const destination = itemEndpoint(items[index] as ContextItemRecord);
    if (!destination) return null;

    const previous = index > 0 ? items[index - 1] : null;
    // Before the day's first stop the traveller is still where they slept, so
    // the leg starts at the base rather than not existing at all.
    const origin = previous ? itemEndpoint(previous) : baseEndpoint(arrivalBase);
    if (!origin) return null;

    if (sameLocation(origin, destination)) return null;

    return {
      destination,
      mode: mapTravelMode(previous ? previous.travelModeToNext : dayStartMode),
      origin,
    };
  }

  // Nothing left to reach today: the last stop and the way back to bed.
  const last = items.at(-1);
  if (!last) return null;
  const destination = baseEndpoint(departureBase);
  const origin = itemEndpoint(last);
  if (!destination || !origin || sameLocation(origin, destination)) return null;

  return { destination, mode: mapTravelMode(last.travelModeToNext), origin };
}

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
  item: ContextScheduleItem,
  itemDate: string,
  dayTimeZone: string,
  at: Date,
  scheduledStarts: readonly number[],
): ItemPhase {
  if (item.startInstant) {
    const start = item.startInstant.getTime();
    const now = at.getTime();
    if (now < start) return 'future';
    const nextScheduledStart = scheduledStarts.find((candidate) => candidate > start);
    const end = item.durationMinutes
      ? start + item.durationMinutes * 60_000
      : (nextScheduledStart ?? start + FINAL_UNTIMED_DURATION_MINUTES * 60_000);
    if (now < end) {
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

function selectCurrentOrRelevant<T extends ContextScheduleItem>(
  items: readonly T[],
  phases: ReadonlyMap<string, ItemPhase>,
) {
  const currentExact = items.reduce<T | null>((latest, item) => {
    if (phases.get(item.id) !== 'current_exact') return latest;
    if (!latest || item.startInstant!.getTime() >= latest.startInstant!.getTime()) return item;
    return latest;
  }, null);
  if (currentExact) {
    return { item: currentExact, kind: 'current' as const, reason: 'exact_time' as const };
  }

  for (const phase of ['current_day_part', 'flexible'] as const) {
    const item = items.find((candidate) => phases.get(candidate.id) === phase);
    if (!item) continue;
    if (phase === 'current_day_part') {
      return { item, kind: 'relevant' as const, reason: 'day_part' as const };
    }
    return { item, kind: 'relevant' as const, reason: 'itinerary_order' as const };
  }

  return null;
}

function futureStart(item: ContextScheduleItem, itemDate: string, dayTimeZone: string) {
  if (item.startInstant) return item.startInstant.getTime();
  if (!item.dayPart || item.dayPart === 'ANYTIME') return Number.POSITIVE_INFINITY;
  const hour = item.dayPart === 'MORNING' ? '00' : item.dayPart === 'AFTERNOON' ? '12' : '17';
  return floatingLocalTimeToInstant(itemDate, `${hour}:00`, item.timeZone ?? dayTimeZone).getTime();
}

function selectNextItem<T extends ContextScheduleItem>(
  items: readonly T[],
  phases: ReadonlyMap<string, ItemPhase>,
  currentOrRelevant: ReturnType<typeof selectCurrentOrRelevant<T>>,
  itemDate: string,
  dayTimeZone: string,
) {
  const future = items
    .filter((item) => phases.get(item.id) === 'future')
    .toSorted(
      (left, right) =>
        futureStart(left, itemDate, dayTimeZone) - futureStart(right, itemDate, dayTimeZone),
    )[0];
  if (future) return future;

  if (!currentOrRelevant) return null;
  const currentIndex = items.findIndex((item) => item.id === currentOrRelevant.item.id);
  return (
    items
      .slice(currentIndex + 1)
      .find((item) =>
        ['current_day_part', 'flexible'].includes(phases.get(item.id) ?? 'overdue'),
      ) ?? null
  );
}

/** The server's pure timing policy, exported so its important business rules stay directly tested. */
export function resolveTripModeItemSelection<T extends ContextScheduleItem>(
  items: readonly T[],
  itemDate: string,
  dayTimeZone: string,
  at: Date,
) {
  const scheduledStarts = items
    .flatMap((item) => (item.startInstant ? [item.startInstant.getTime()] : []))
    .toSorted((left, right) => left - right);
  const phases = new Map(
    items.map((item) => [
      item.id,
      resolveItemPhase(item, itemDate, dayTimeZone, at, scheduledStarts),
    ]),
  );
  const currentOrRelevant = selectCurrentOrRelevant(items, phases);
  const nextItem = selectNextItem(items, phases, currentOrRelevant, itemDate, dayTimeZone);

  return { currentOrRelevant, nextItem };
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
      // One leg is read below. Asking for the whole day's chain around these
      // two stops bought the base legs at either end and threw them away.
      legs: 'between_items',
    },
    { ...input.services, source: 'trip-mode-context' },
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
      // Joined, never resolved: the bar reads the coordinates already stored
      // against these Places, so adding them costs a join and nothing else.
      dailyBaseDepartureTripPlace: legBaseInclude,
      dailyBaseTripPlace: legBaseInclude,
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
      leg: null,
      nextItemId: null,
      state: 'no_day' as const,
    };
  }

  const activeItems = day.items.filter((item) => item.travelStatus === 'UPCOMING');
  const dayDate = formatDateOnly(day.date);
  const { currentOrRelevant, nextItem } = resolveTripModeItemSelection(
    activeItems,
    dayDate,
    day.defaultTimeZone,
    at,
  );
  // Two independent questions, and both can reach the provider. Asked in
  // series they add up; the leg and the snapshots know nothing about each
  // other, so the request waits once for the slower of the two.
  const [leaveBy, snapshots] = await Promise.all([
    resolveLeaveBy({
      bufferSeconds: options.routeBufferSeconds ?? null,
      contextAt: at,
      currentItem: currentOrRelevant?.item ?? null,
      dayId: day.id,
      languageCode: options.languageCode,
      nextItem,
      services,
      tripId: trip.id,
      userId,
    }),
    // Trip Mode renders the same Places the itinerary does, so it reads the same
    // snapshots rather than re-resolving them on every tab.
    hydratePlaceSnapshots(
      day.items.flatMap(
        (item) =>
          item.tripPlace?.place.providerRefs.map((reference) => reference.externalPlaceId) ?? [],
      ),
      { languageCode: options.languageCode, source: 'trip-mode-context' },
    ),
  ]);

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
      name: day.name,
      number: Math.round((day.date.getTime() - trip.startDate.getTime()) / 86_400_000) + 1,
    },
    leaveBy,
    leg: resolveTripModeLeg({
      arrivalBase: day.dailyBaseTripPlace,
      dayStartMode: day.routeStartTravelMode,
      // Where the day ends falls back to where it began, the same precedence
      // the itinerary's own base resolution uses.
      departureBase: day.dailyBaseDepartureTripPlace ?? day.dailyBaseTripPlace,
      items: day.items,
      nextItemId: nextItem?.id ?? null,
    }),
    nextItemId: nextItem?.id ?? null,
    state:
      activeItems.length === 0 || (!currentOrRelevant && !nextItem)
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
