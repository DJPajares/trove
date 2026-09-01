import { getPrismaClient } from '@trove/db';

import { readPlaceSnapshots } from './place-data.js';
import { placeProviderRefInclude, serializeCanonicalPlace } from './place-serializer.js';
import { formatLocalTime } from './itinerary-rules.js';
import { formatDateOnly } from './trip-rules.js';

/**
 * The trip is not shared, or does not exist. Deliberately one error for both, so
 * the endpoint cannot be used to learn which trip ids are real.
 */
export class PublicTripNotFoundError extends Error {
  constructor() {
    super('trip_not_found');
    this.name = 'PublicTripNotFoundError';
  }
}

export type PublicItineraryItem = {
  /** Free text the traveller wrote in place of a Place, if any. */
  address: string | null;
  dayPart: 'afternoon' | 'anytime' | 'evening' | 'morning' | null;
  durationMinutes: number | null;
  id: string;
  localEndTime: string | null;
  localStartTime: string | null;
  /** Null where nothing has named this yet. The reader supplies its own copy. */
  name: string | null;
  notes: string | null;
};

export type PublicItinerary = {
  days: Array<{
    date: string;
    id: string;
    items: PublicItineraryItem[];
    name: string | null;
    notes: string | null;
  }>;
  trip: {
    /** The traveller's own framing of the trip, deliberately shared. */
    description: string | null;
    endDate: string;
    id: string;
    name: string;
    startDate: string;
  };
};

const dayParts: Record<string, PublicItineraryItem['dayPart']> = {
  AFTERNOON: 'afternoon',
  ANYTIME: 'anytime',
  EVENING: 'evening',
  MORNING: 'morning',
};

const publicItemInclude = {
  tripPlace: { include: { place: { include: placeProviderRefInclude } } },
} as const;

/**
 * The trip as a stranger with the link sees it.
 *
 * Two rules shape everything here, and both are the reason this is its own
 * service rather than a flag on `listItinerary`.
 *
 * It reads Trove's own database and nothing else. Names come from
 * `readPlaceSnapshots`, which cannot reach a provider, so a shared trip left
 * open in a tab cannot turn into billed Google calls however stale it gets.
 *
 * It serializes its own narrow shape rather than reusing
 * `serializeItineraryItem`. That serializer carries planned costs, priority,
 * travel status, positions and provider ids - the private half of a plan, and
 * exactly what a shared one must not leak. Sharing a serializer would mean every
 * field added to the itinerary in future became public by default; separate
 * shapes mean the public one only ever grows on purpose. The trip's description
 * is one such deliberate growth: it is the traveller's own account of the trip,
 * written to be read, and a shared itinerary without it opens on a bare title.
 */
export async function listPublicItinerary(
  tripId: string,
  options: { now?: Date } = {},
): Promise<PublicItinerary> {
  const prisma = getPrismaClient();
  const trip = await prisma.trip.findFirst({
    // The whole of the authorization. There is no user to scope by, so
    // visibility is what stands in for one.
    where: { id: tripId, visibility: 'PUBLIC' },
    select: {
      description: true,
      endDate: true,
      id: true,
      name: true,
      startDate: true,
      itineraryDays: {
        select: {
          date: true,
          id: true,
          name: true,
          notes: true,
          items: { include: publicItemInclude, orderBy: { position: 'asc' } },
        },
        orderBy: { date: 'asc' },
      },
    },
  });
  if (!trip) throw new PublicTripNotFoundError();

  const items = trip.itineraryDays.flatMap((day) => day.items);
  const snapshots = await readPlaceSnapshots(
    items.flatMap(
      (item) =>
        item.tripPlace?.place.providerRefs.map((reference) => reference.externalPlaceId) ?? [],
    ),
    { now: options.now, source: 'public-share' },
  );
  const serializerOptions = { now: options.now, snapshots };

  return {
    days: trip.itineraryDays.map((day) => ({
      date: formatDateOnly(day.date),
      id: day.id,
      items: day.items.map((item) => ({
        address: item.customLocation,
        dayPart: item.dayPart ? (dayParts[item.dayPart] ?? null) : null,
        durationMinutes: item.durationMinutes,
        id: item.id,
        localEndTime: formatLocalTime(item.localEndTime),
        localStartTime: formatLocalTime(item.localStartTime),
        name: publicItemName(item, serializerOptions),
        notes: item.notes,
      })),
      name: day.name,
      notes: day.notes,
    })),
    trip: {
      description: trip.description,
      endDate: formatDateOnly(trip.endDate),
      id: trip.id,
      name: trip.name,
      startDate: formatDateOnly(trip.startDate),
    },
  };
}

type PublicItemRecord = {
  customLabel: string | null;
  tripPlace: {
    customName: string | null;
    place: Parameters<typeof serializeCanonicalPlace>[0];
  } | null;
};

/**
 * What to call this stop, in the same order the itinerary itself resolves a name:
 * whatever the traveller typed, then their name for the Place, then the Place's
 * own, then the provider's.
 *
 * Only a name and never coordinates or a provider id. Nothing on the public page
 * renders those, and sending them would make an endpoint anybody can reach a
 * source of Google Place IDs.
 */
function publicItemName(
  item: PublicItemRecord,
  options: Parameters<typeof serializeCanonicalPlace>[1],
): string | null {
  const label = item.customLabel?.trim();
  if (label) return label;
  if (!item.tripPlace) return null;

  const custom = item.tripPlace.customName?.trim();
  if (custom) return custom;

  const place = serializeCanonicalPlace(item.tripPlace.place, options);
  return place.name?.trim() || place.snapshot?.name || place.providerLabel || null;
}
