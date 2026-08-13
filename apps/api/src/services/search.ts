import { getPrismaClient } from '@trove/db';

import type { PlacesService, PlaceSuggestion } from './places.js';

const CANDIDATE_LIMIT = 30;
const RESULT_LIMIT_PER_GROUP = 5;
const PLACE_FALLBACK_RESULT_THRESHOLD = 5;

export type SearchResultKind =
  'note' | 'reservation' | 'saved_place' | 'trip' | 'trip_info' | 'trip_place';
export type SearchNoteSource =
  'itinerary' | 'reservation' | 'saved_place' | 'trip' | 'trip_info' | 'trip_place';

// Memories can join this owned-result contract without changing provider search behavior.

export type TroveSearchResult = {
  description: string | null;
  href: string;
  id: string;
  kind: SearchResultKind;
  noteSource: SearchNoteSource | null;
  title: string;
  trip: { id: string; name: string } | null;
};

export type ExternalPlaceResult = {
  description: string | null;
  externalPlaceId: string;
  href: string;
  name: string;
  provider: 'google';
};

type RankedResult = TroveSearchResult & { score: number };

const groupOrder: Record<SearchResultKind, number> = {
  trip: 0,
  reservation: 1,
  trip_place: 2,
  saved_place: 3,
  trip_info: 4,
  note: 5,
};

function normalize(value: string) {
  return value.trim().toLocaleLowerCase();
}

function scoreValue(query: string, value: string | null | undefined, weight = 0) {
  if (!value) return 0;
  const normalized = normalize(value);
  if (!normalized) return 0;
  if (normalized === query) return 100 + weight;
  if (normalized.startsWith(query)) return 85 + weight;
  if (normalized.split(/\s+/).some((word) => word.startsWith(query))) return 72 + weight;
  if (normalized.includes(query)) return 58 + weight;
  return 0;
}

function bestScore(
  query: string,
  fields: Array<{ value: string | null | undefined; weight?: number }>,
) {
  return Math.max(0, ...fields.map(({ value, weight }) => scoreValue(query, value, weight)));
}

function excerpt(value: string) {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 140 ? `${compact.slice(0, 137).trimEnd()}...` : compact;
}

function resultKey(result: TroveSearchResult) {
  return `${result.kind}:${result.id}`;
}

function groupResults(results: RankedResult[]) {
  const deduplicated = new Map<string, RankedResult>();
  for (const result of results) {
    const key = resultKey(result);
    const current = deduplicated.get(key);
    if (!current || result.score > current.score) deduplicated.set(key, result);
  }

  const grouped = new Map<SearchResultKind, RankedResult[]>();
  for (const result of deduplicated.values()) {
    const group = grouped.get(result.kind) ?? [];
    group.push(result);
    grouped.set(result.kind, group);
  }

  return [...grouped.entries()]
    .map(([kind, entries]) => ({
      kind,
      maxScore: Math.max(...entries.map((entry) => entry.score)),
      results: entries
        .toSorted(
          (left, right) => right.score - left.score || left.title.localeCompare(right.title),
        )
        .slice(0, RESULT_LIMIT_PER_GROUP)
        .map(({ score: _score, ...result }) => result),
    }))
    .toSorted(
      (left, right) =>
        right.maxScore - left.maxScore || groupOrder[left.kind] - groupOrder[right.kind],
    )
    .map(({ maxScore: _maxScore, ...group }) => group);
}

async function searchOwnedContent(userId: string, input: string) {
  const prisma = getPrismaClient();
  const query = normalize(input);
  const contains = { contains: input, mode: 'insensitive' as const };

  const [trips, savedPlaces, tripPlaces, reservations, tripInfo, days, itineraryItems] =
    await Promise.all([
      prisma.trip.findMany({
        where: { ownerId: userId, OR: [{ name: contains }, { notes: contains }] },
        select: { id: true, name: true, notes: true },
        orderBy: { updatedAt: 'desc' },
        take: CANDIDATE_LIMIT,
      }),
      prisma.savedPlace.findMany({
        where: {
          ownerId: userId,
          OR: [
            { note: contains },
            { place: { customName: contains } },
            { place: { customNote: contains } },
          ],
        },
        select: {
          id: true,
          note: true,
          place: { select: { customName: true, customNote: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: CANDIDATE_LIMIT,
      }),
      prisma.tripPlace.findMany({
        where: {
          trip: { ownerId: userId },
          OR: [
            { note: contains },
            { place: { customName: contains } },
            { place: { customNote: contains } },
          ],
        },
        select: {
          id: true,
          note: true,
          place: { select: { customName: true, customNote: true } },
          trip: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: CANDIDATE_LIMIT,
      }),
      prisma.reservation.findMany({
        where: {
          trip: { ownerId: userId },
          OR: [
            { title: contains },
            { provider: contains },
            { bookingReference: contains },
            { accommodationAddress: contains },
            { flightAirline: contains },
            { flightNumber: contains },
            { flightDepartureAirport: contains },
            { flightArrivalAirport: contains },
            { transportOperator: contains },
            { transportServiceNumber: contains },
            { transportPickupLocation: contains },
            { transportDropoffLocation: contains },
            { notes: contains },
          ],
        },
        select: {
          accommodationAddress: true,
          bookingReference: true,
          flightAirline: true,
          flightArrivalAirport: true,
          flightDepartureAirport: true,
          flightNumber: true,
          id: true,
          notes: true,
          provider: true,
          title: true,
          transportDropoffLocation: true,
          transportOperator: true,
          transportPickupLocation: true,
          transportServiceNumber: true,
          trip: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: CANDIDATE_LIMIT,
      }),
      prisma.tripInfo.findMany({
        where: {
          trip: { ownerId: userId },
          OR: [
            { label: contains },
            { value: contains },
            { category: contains },
            { link: contains },
            { note: contains },
          ],
        },
        select: {
          category: true,
          id: true,
          label: true,
          link: true,
          note: true,
          trip: { select: { id: true, name: true } },
          value: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: CANDIDATE_LIMIT,
      }),
      prisma.itineraryDay.findMany({
        where: { notes: contains, trip: { ownerId: userId } },
        select: { date: true, id: true, notes: true, trip: { select: { id: true, name: true } } },
        orderBy: { updatedAt: 'desc' },
        take: CANDIDATE_LIMIT,
      }),
      prisma.itineraryItem.findMany({
        where: { notes: contains, trip: { ownerId: userId } },
        select: {
          customLabel: true,
          customLocation: true,
          id: true,
          itineraryDayId: true,
          notes: true,
          trip: { select: { id: true, name: true } },
          tripPlace: { select: { place: { select: { customName: true } } } },
        },
        orderBy: { updatedAt: 'desc' },
        take: CANDIDATE_LIMIT,
      }),
    ]);

  const results: RankedResult[] = [];

  for (const trip of trips) {
    const primaryScore = scoreValue(query, trip.name, 10);
    if (primaryScore) {
      results.push({
        description: null,
        href: `/trips/${trip.id}/itinerary`,
        id: trip.id,
        kind: 'trip',
        noteSource: null,
        score: primaryScore,
        title: trip.name,
        trip: null,
      });
    } else if (trip.notes) {
      results.push({
        description: excerpt(trip.notes),
        href: `/trips/${trip.id}/itinerary`,
        id: `trip:${trip.id}`,
        kind: 'note',
        noteSource: 'trip',
        score: scoreValue(query, trip.notes),
        title: trip.name,
        trip: { id: trip.id, name: trip.name },
      });
    }
  }

  for (const savedPlace of savedPlaces) {
    const primaryScore = scoreValue(query, savedPlace.place.customName, 8);
    if (primaryScore && savedPlace.place.customName) {
      results.push({
        description: null,
        href: '/saved',
        id: savedPlace.id,
        kind: 'saved_place',
        noteSource: null,
        score: primaryScore,
        title: savedPlace.place.customName,
        trip: null,
      });
      continue;
    }
    const note = bestScore(query, [
      { value: savedPlace.note, weight: 2 },
      { value: savedPlace.place.customNote },
    ]);
    const noteText = scoreValue(query, savedPlace.note)
      ? savedPlace.note
      : savedPlace.place.customNote;
    if (note && noteText) {
      results.push({
        description: excerpt(noteText),
        href: '/saved',
        id: `saved-place:${savedPlace.id}`,
        kind: 'note',
        noteSource: 'saved_place',
        score: note,
        title: savedPlace.place.customName ?? '',
        trip: null,
      });
    }
  }

  for (const tripPlace of tripPlaces) {
    const primaryScore = scoreValue(query, tripPlace.place.customName, 8);
    if (primaryScore && tripPlace.place.customName) {
      results.push({
        description: null,
        href: `/trips/${tripPlace.trip.id}/places`,
        id: tripPlace.id,
        kind: 'trip_place',
        noteSource: null,
        score: primaryScore,
        title: tripPlace.place.customName,
        trip: tripPlace.trip,
      });
      continue;
    }
    const note = bestScore(query, [
      { value: tripPlace.note, weight: 2 },
      { value: tripPlace.place.customNote },
    ]);
    const noteText = scoreValue(query, tripPlace.note)
      ? tripPlace.note
      : tripPlace.place.customNote;
    if (note && noteText) {
      results.push({
        description: excerpt(noteText),
        href: `/trips/${tripPlace.trip.id}/places`,
        id: `trip-place:${tripPlace.id}`,
        kind: 'note',
        noteSource: 'trip_place',
        score: note,
        title: tripPlace.place.customName ?? tripPlace.trip.name,
        trip: tripPlace.trip,
      });
    }
  }

  for (const reservation of reservations) {
    const primaryScore = bestScore(query, [
      { value: reservation.title, weight: 10 },
      { value: reservation.provider, weight: 3 },
      { value: reservation.bookingReference, weight: 4 },
      { value: reservation.accommodationAddress },
      { value: reservation.flightAirline, weight: 3 },
      { value: reservation.flightNumber, weight: 5 },
      { value: reservation.flightDepartureAirport },
      { value: reservation.flightArrivalAirport },
      { value: reservation.transportOperator, weight: 3 },
      { value: reservation.transportServiceNumber, weight: 5 },
      { value: reservation.transportPickupLocation },
      { value: reservation.transportDropoffLocation },
    ]);
    if (primaryScore) {
      results.push({
        description: reservation.provider,
        href: `/trips/${reservation.trip.id}/reservations`,
        id: reservation.id,
        kind: 'reservation',
        noteSource: null,
        score: primaryScore,
        title: reservation.title,
        trip: reservation.trip,
      });
    } else if (reservation.notes) {
      results.push({
        description: excerpt(reservation.notes),
        href: `/trips/${reservation.trip.id}/reservations`,
        id: `reservation:${reservation.id}`,
        kind: 'note',
        noteSource: 'reservation',
        score: scoreValue(query, reservation.notes),
        title: reservation.title,
        trip: reservation.trip,
      });
    }
  }

  for (const entry of tripInfo) {
    const primaryScore = bestScore(query, [
      { value: entry.label, weight: 10 },
      { value: entry.value, weight: 5 },
      { value: entry.category, weight: 3 },
      { value: entry.link },
    ]);
    if (primaryScore) {
      results.push({
        description: excerpt(entry.value),
        href: `/trips/${entry.trip.id}/info`,
        id: entry.id,
        kind: 'trip_info',
        noteSource: null,
        score: primaryScore,
        title: entry.label,
        trip: entry.trip,
      });
    } else if (entry.note) {
      results.push({
        description: excerpt(entry.note),
        href: `/trips/${entry.trip.id}/info`,
        id: `trip-info:${entry.id}`,
        kind: 'note',
        noteSource: 'trip_info',
        score: scoreValue(query, entry.note),
        title: entry.label,
        trip: entry.trip,
      });
    }
  }

  for (const day of days) {
    if (!day.notes) continue;
    results.push({
      description: excerpt(day.notes),
      href: `/trips/${day.trip.id}/itinerary?day=${encodeURIComponent(day.id)}`,
      id: `itinerary-day:${day.id}`,
      kind: 'note',
      noteSource: 'itinerary',
      score: scoreValue(query, day.notes, 2),
      title: day.date.toISOString().slice(0, 10),
      trip: day.trip,
    });
  }

  for (const item of itineraryItems) {
    if (!item.notes) continue;
    results.push({
      description: excerpt(item.notes),
      href: `/trips/${item.trip.id}/itinerary${item.itineraryDayId ? `?day=${encodeURIComponent(item.itineraryDayId)}` : ''}`,
      id: `itinerary-item:${item.id}`,
      kind: 'note',
      noteSource: 'itinerary',
      score: scoreValue(query, item.notes, 2),
      title:
        item.customLabel ??
        item.customLocation ??
        item.tripPlace?.place.customName ??
        item.trip.name,
      trip: item.trip,
    });
  }

  return results;
}

async function resolveOwnedProviderResults(
  userId: string,
  query: string,
  suggestions: PlaceSuggestion[],
) {
  if (!suggestions.length) return { external: [], owned: [] };
  const references = await getPrismaClient().placeProviderRef.findMany({
    where: {
      externalPlaceId: { in: suggestions.map((suggestion) => suggestion.externalPlaceId) },
      place: {
        OR: [
          { savedPlaces: { some: { ownerId: userId } } },
          { tripPlaces: { some: { trip: { ownerId: userId } } } },
        ],
      },
    },
    select: {
      externalPlaceId: true,
      place: {
        select: {
          savedPlaces: { where: { ownerId: userId }, select: { id: true } },
          tripPlaces: {
            where: { trip: { ownerId: userId } },
            select: { id: true, trip: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });
  const memberships = new Map(
    references.map((reference) => [reference.externalPlaceId, reference]),
  );
  const owned: RankedResult[] = [];
  const external: ExternalPlaceResult[] = [];

  for (const suggestion of suggestions) {
    const membership = memberships.get(suggestion.externalPlaceId);
    if (!membership) {
      external.push({
        description: suggestion.description,
        externalPlaceId: suggestion.externalPlaceId,
        href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(suggestion.name)}&query_place_id=${encodeURIComponent(suggestion.externalPlaceId)}`,
        name: suggestion.name,
        provider: suggestion.provider,
      });
      continue;
    }
    const score = bestScore(query, [
      { value: suggestion.name, weight: 8 },
      { value: suggestion.description },
    ]);
    for (const savedPlace of membership.place.savedPlaces) {
      owned.push({
        description: suggestion.description,
        href: '/saved',
        id: savedPlace.id,
        kind: 'saved_place',
        noteSource: null,
        score,
        title: suggestion.name,
        trip: null,
      });
    }
    for (const tripPlace of membership.place.tripPlaces) {
      owned.push({
        description: suggestion.description,
        href: `/trips/${tripPlace.trip.id}/places`,
        id: tripPlace.id,
        kind: 'trip_place',
        noteSource: null,
        score,
        title: suggestion.name,
        trip: tripPlace.trip,
      });
    }
  }

  return { external: external.slice(0, 5), owned };
}

export async function searchTrove(
  userId: string,
  input: string,
  options: { includePlaces?: boolean; placesService?: PlacesService | null } = {},
) {
  const owned = await searchOwnedContent(userId, input);
  const initialGroups = groupResults(owned);
  const visibleLocalResultCount = initialGroups.reduce(
    (total, group) => total + group.results.length,
    0,
  );
  const canSearchPlaces =
    visibleLocalResultCount <= PLACE_FALLBACK_RESULT_THRESHOLD && input.length >= 3;
  let external: {
    results: ExternalPlaceResult[];
    status: 'empty' | 'not_requested' | 'ok' | 'unavailable';
  } = { results: [], status: 'not_requested' };

  if (options.includePlaces && canSearchPlaces) {
    if (!options.placesService) {
      external = { results: [], status: 'unavailable' };
    } else {
      const provider = await options.placesService.search({ input });
      if (provider.status === 'unavailable') {
        external = { results: [], status: 'unavailable' };
      } else {
        const resolved = await resolveOwnedProviderResults(
          userId,
          normalize(input),
          provider.suggestions,
        );
        owned.push(...resolved.owned);
        external = {
          results: resolved.external,
          status: resolved.external.length ? 'ok' : 'empty',
        };
      }
    }
  }

  return {
    canSearchPlaces,
    external,
    groups: options.includePlaces ? groupResults(owned) : initialGroups,
    query: input,
  };
}
