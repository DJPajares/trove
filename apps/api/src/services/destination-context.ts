import {
  destinationContextMessages,
  destinationContextApplicabilitySchema,
  readTripPlanningPreferences,
  type DestinationContextGroup,
  type DestinationContextId,
  type DestinationContextRecord,
  type TripDestinationContext,
} from '@trove/types';
import {
  DESTINATION_CONTEXT_DESTINATIONS,
  DESTINATION_CONTEXT_RECORDS,
  DESTINATION_CONTEXT_VERSION,
} from '../data/destination-context.js';

export type ContextPlace = {
  name?: string | null;
  coordinates?: { latitude: number; longitude: number } | null;
  expiresAt?: string;
};
type DecimalLike = number | { toNumber(): number };
type ContextSnapshot = {
  cachedTypes?: string[];
  externalPlaceId?: string;
  cachedAt?: Date | null;
  cachedName?: string | null;
  cachedLatitude?: DecimalLike | null;
  cachedLongitude?: DecimalLike | null;
};
export type OwnedContextPlace = {
  customName?: string | null;
  providerLabel?: string | null;
  customLatitude?: DecimalLike | null;
  customLongitude?: DecimalLike | null;
  providerRefs?: readonly ContextSnapshot[];
};
const normalize = (value: string) => value.normalize('NFKC').toLowerCase().trim();
const number = (value: DecimalLike) => (typeof value === 'number' ? value : value.toNumber());
const LOCATION_TTL = 30 * 86_400_000;

/** Pure reading of owned values and permitted snapshots. No refresh-on-miss import. */
export function contextPlaceFromOwnedData(place: OwnedContextPlace, now: Date): ContextPlace {
  if (place.customLatitude != null && place.customLongitude != null)
    return {
      name: place.customName,
      coordinates: {
        latitude: number(place.customLatitude),
        longitude: number(place.customLongitude),
      },
    };
  const reference = place.providerRefs?.find(
    (entry) =>
      entry.cachedAt &&
      now.getTime() >= entry.cachedAt.getTime() &&
      now.getTime() < entry.cachedAt.getTime() + LOCATION_TTL,
  );
  return {
    name: place.customName ?? reference?.cachedName ?? place.providerLabel,
    coordinates:
      reference?.cachedLatitude != null && reference.cachedLongitude != null
        ? {
            latitude: number(reference.cachedLatitude),
            longitude: number(reference.cachedLongitude),
          }
        : null,
    ...(reference?.cachedAt
      ? { expiresAt: new Date(reference.cachedAt.getTime() + LOCATION_TTL).toISOString() }
      : {}),
  };
}

/** Exact reviewed aliases, or conservative planning-area bounds; no substring guess. */
export function matchContextDestination(place: ContextPlace): DestinationContextId | null {
  const names = Object.entries(DESTINATION_CONTEXT_DESTINATIONS).filter(
    ([, value]) =>
      place.name && (value.aliases as readonly string[]).includes(normalize(place.name)),
  );
  if (place.coordinates) {
    const { latitude, longitude } = place.coordinates;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    const located = Object.entries(DESTINATION_CONTEXT_DESTINATIONS).filter(([, value]) => {
      const [south, north, west, east] = value.bounds;
      return latitude >= south && latitude <= north && longitude >= west && longitude <= east;
    });
    if (located.length !== 1 || (names.length > 0 && names[0]![0] !== located[0]![0])) return null;
    return located[0]![0] as DestinationContextId;
  }
  return names.length === 1 ? (names[0]![0] as DestinationContextId) : null;
}

function applicableDates(record: DestinationContextRecord, start: string, end: string): string[] {
  const window = record.applicability;
  if (window.kind === 'all_year') return [start, end];
  if (window.kind === 'date_set')
    return window.dates.filter((date) => date >= start && date <= end);
  if (window.kind === 'dates')
    return window.start <= end && window.end >= start
      ? [window.start > start ? window.start : start, window.end < end ? window.end : end]
      : [];
  // Recurring windows can straddle New Year. Compare local date strings, never
  // UTC instants or the server timezone. No forecast dates are synthesized.
  const firstYear = Number(start.slice(0, 4)) - 1;
  const lastYear = Number(end.slice(0, 4));
  for (let year = firstYear; year <= lastYear; year++) {
    const from = `${year}-${window.start}`;
    const to = `${year + (window.end < window.start ? 1 : 0)}-${window.end}`;
    if (from <= end && to >= start) return [from > start ? from : start, to < end ? to : end];
  }
  return [];
}

export type DestinationContextInput = {
  startDate: string;
  endDate: string;
  destinations: readonly ContextPlace[];
  days: readonly { id: string; date: string; places: readonly ContextPlace[] }[];
  preferences?: unknown;
};

export function resolveDestinationContext(
  input: DestinationContextInput,
  now: Date,
  catalog: readonly DestinationContextRecord[] = DESTINATION_CONTEXT_RECORDS,
): TripDestinationContext {
  const interests = readTripPlanningPreferences(input.preferences).interests;
  const fresh = catalog.filter(
    (record) =>
      Date.parse(record.reviewedAt) <= now.getTime() &&
      Date.parse(record.expiresAt) > now.getTime(),
  );
  const groups = (
    places: readonly ContextPlace[],
    start: string,
    end: string,
  ): DestinationContextGroup[] => {
    if (!destinationContextApplicabilitySchema.safeParse({ kind: 'dates', start, end }).success)
      return [];
    const destinations = [
      ...new Set(
        places.map(matchContextDestination).filter((id): id is DestinationContextId => id !== null),
      ),
    ];
    return destinations.flatMap((destination) => {
      const records = fresh
        .filter((record) => record.scope.destination === destination)
        .flatMap((record) => {
          // Venue access evidence needs an actual named place, not just the city.
          if (
            record.scope.venueAliases &&
            !places.some(
              (place) =>
                matchContextDestination(place) === destination &&
                place.name &&
                record.scope.venueAliases!.some(
                  (alias) => normalize(alias) === normalize(place.name!),
                ),
            )
          )
            return [];
          const matchedDates = [...new Set(applicableDates(record, start, end))];
          return matchedDates.length
            ? [
                {
                  ...record,
                  matchedDates,
                  interestMatch: record.interests.some((interest) => interests.includes(interest)),
                },
              ]
            : [];
        })
        .toSorted(
          (a, b) => Number(b.interestMatch) - Number(a.interestMatch) || a.id.localeCompare(b.id),
        );
      return records.length ? [{ destination, records }] : [];
    });
  };
  const overviewPlaces = [...input.destinations, ...input.days.flatMap((day) => day.places)];
  const overview = groups(overviewPlaces, input.startDate, input.endDate);
  const days = input.days.map((day) => ({
    dayId: day.id,
    groups: groups(day.places, day.date, day.date),
  }));
  const deadlines = [
    ...overview.flatMap((group) => group.records.map((record) => record.expiresAt)),
    ...overviewPlaces.flatMap((place) =>
      place.expiresAt && matchContextDestination(place) ? [place.expiresAt] : [],
    ),
  ];
  return {
    catalogVersion: DESTINATION_CONTEXT_VERSION,
    evaluatedAt: now.toISOString(),
    expiresAt: deadlines.length
      ? new Date(Math.min(...deadlines.map(Date.parse))).toISOString()
      : null,
    overview,
    days,
  };
}

/** Clock-free fingerprint content; recomputation time must not invalidate itself. */
export function destinationContextRevision(context: TripDestinationContext) {
  return {
    catalogVersion: context.catalogVersion,
    overview: context.overview,
    days: context.days,
    expiresAt: context.expiresAt,
  };
}

/** Bounded local context joins the existing generation call; no new model call. */
export function destinationContextForAi(now: Date) {
  return {
    catalogVersion: DESTINATION_CONTEXT_VERSION,
    records: DESTINATION_CONTEXT_RECORDS.filter(
      (record) =>
        Date.parse(record.reviewedAt) <= now.getTime() &&
        Date.parse(record.expiresAt) > now.getTime(),
    ).map((record) => ({
      id: record.id,
      revision: record.revision,
      sourceUrl: record.sourceUrl,
      reviewedAt: record.reviewedAt,
      expiresAt: record.expiresAt,
      scope: record.scope,
      applicability: record.applicability,
      kind: record.kind,
      accessEffect: record.accessEffect,
      certainty: record.certainty,
      interests: record.interests,
      summary:
        destinationContextMessages.en.records[
          record.contentKey as keyof typeof destinationContextMessages.en.records
        ].summary,
    })),
  };
}

type OwnedTripContextRows = {
  startDate?: Date;
  endDate?: Date;
  planningPreferences?: unknown;
  destinations?: unknown;
  tripPlaces: readonly { id: string; place?: OwnedContextPlace }[];
  itineraryDays: readonly {
    id: string;
    date: Date;
    dailyBaseTripPlaceId: string | null;
    dailyBaseDepartureTripPlaceId: string | null;
    items: readonly { tripPlaceId: string | null }[];
  }[];
};
/** Same adapter for itinerary and score reads. No destination-per-day assumption. */
export function readOwnedTripDestinationContext(
  trip: OwnedTripContextRows,
  now: Date,
  snapshots?: ReadonlyMap<string, ContextSnapshot>,
) {
  // Reuse an acquisition already performed by the itinerary surface in this
  // request. Scoring omits this argument and remains strictly cache-only.
  const readPlace = (place: OwnedContextPlace) =>
    contextPlaceFromOwnedData(
      {
        ...place,
        providerRefs: place.providerRefs?.map((reference) => ({
          ...reference,
          ...(reference.externalPlaceId ? snapshots?.get(reference.externalPlaceId) : undefined),
        })),
      },
      now,
    );
  const places = new Map(
    trip.tripPlaces.map((row) => [row.id, row.place ? readPlace(row.place) : {}]),
  );
  const destinations = Array.isArray(trip.destinations)
    ? trip.destinations.flatMap((row: unknown) =>
        row &&
        typeof row === 'object' &&
        'place' in row &&
        row.place &&
        typeof row.place === 'object'
          ? [readPlace(row.place as OwnedContextPlace)]
          : [],
      )
    : [];
  return resolveDestinationContext(
    {
      startDate: trip.startDate?.toISOString().slice(0, 10) ?? '',
      endDate: trip.endDate?.toISOString().slice(0, 10) ?? '',
      destinations,
      preferences: trip.planningPreferences,
      days: trip.itineraryDays.map((day) => ({
        id: day.id,
        date: day.date.toISOString().slice(0, 10),
        places: [
          ...new Set([
            day.dailyBaseTripPlaceId,
            day.dailyBaseDepartureTripPlaceId,
            ...day.items.map((item) => item.tripPlaceId),
          ]),
        ].flatMap((id) => (id && places.has(id) ? [places.get(id)!] : [])),
      })),
    },
    now,
  );
}
