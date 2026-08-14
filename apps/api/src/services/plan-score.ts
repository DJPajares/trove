import { getPrismaClient } from '@trove/db';

import { formatInstantInTimeZone, formatLocalTime } from './itinerary-rules.js';
import { getItineraryDayRoutes, type ItineraryDayRoutes } from './itinerary-routes.js';
import { ItineraryNotFoundError } from './itineraries.js';
import { createPlacesService } from './places-runtime.js';
import type { PlacesService } from './places.js';
import {
  explainDay,
  explainTrip,
  type PlanScoreExplanationGroups,
} from './plan-score-explanations.js';
import {
  evaluateFeasibility,
  evaluateMustGoPriorityFit,
  evaluatePaceBuffer,
  evaluatePlaceQuality,
  evaluateTravelEffort,
  type PlanScoreDayItem,
  type PlanScoreFixedCommitment,
  type PlanScorePlace,
  type PlanScoreRouteSegment,
} from './plan-score-factors.js';
import {
  planScoreFingerprint,
  scoreTrip,
  toPlanScoreDayPayload,
  type PlanScoreDayInput,
  type PlanScoreDayPayload,
  type PlanScoreFactorOutcome,
  type PlanScoreFactorResult,
  type PlanScoreTripWithheldReason,
} from './plan-score-rules.js';

/**
 * Plan Score for a trip, derived on demand from stored itinerary data and live
 * route/provider evidence (PRD section 29).
 *
 * Two factors stay unknown in this integration rather than being guessed:
 * opening hours, because the Places provider only returns human-readable
 * weekday text today, and route efficiency, because comparing alternative
 * orders needs a full pairwise duration matrix per day. Both lower completeness
 * honestly instead of inventing evidence.
 */

export type TripPlanScoreDay = PlanScoreDayPayload & {
  date: string;
  explanations: PlanScoreExplanationGroups;
};

export type TripPlanScore = {
  days: TripPlanScoreDay[];
  explanations: PlanScoreExplanationGroups;
  /** Identity of the evidence this result came from, for cache validation. */
  fingerprint: string;
  generatedAt: string;
  mustGoPriorityFit: PlanScoreFactorOutcome;
  score: number | null;
  withheldReasons: PlanScoreTripWithheldReason[];
};

type PlanScoreItemRecord = {
  durationMinutes: number | null;
  id: string;
  localStartTime: Date | null;
  reservationCount: number;
  startInstant: Date | null;
  timeSemantics: string | null;
  timeZone: string | null;
  tripPlaceId: string | null;
};

type PlanScoreCommitmentRecord = {
  endMinute: number;
  id: string;
  startMinute: number;
};

export type PlanScoreDayRecord = {
  commitments: PlanScoreCommitmentRecord[];
  date: string;
  id: string;
  items: PlanScoreItemRecord[];
  timeZone: string;
};

export type PlanScoreTripRecord = {
  days: PlanScoreDayRecord[];
  mustGoTripPlaceIds: string[];
  /** Known public ratings keyed by Trip Place id; absent means no usable rating. */
  ratings: Map<string, number>;
  routes: Map<string, ItineraryDayRoutes>;
};

function parseMinutes(value: string) {
  const [hours, minutes] = value.split(':');
  if (hours === undefined || minutes === undefined) return null;

  const total = Number(hours) * 60 + Number(minutes);
  return Number.isFinite(total) ? total : null;
}

function itemStartMinutes(item: PlanScoreItemRecord, dayTimeZone: string) {
  const local = formatLocalTime(item.localStartTime);
  if (local) return parseMinutes(local);
  if (!item.startInstant) return null;

  return parseMinutes(
    formatInstantInTimeZone(item.startInstant, item.timeZone ?? dayTimeZone).time,
  );
}

function inboundTravelMinutes(routes: ItineraryDayRoutes | undefined, itemId: string) {
  const segment = routes?.segments.find(
    (entry) => entry.destination.kind === 'itinerary_item' && entry.destination.id === itemId,
  );
  if (!segment || segment.durationSeconds === null) return null;

  return segment.durationSeconds / 60;
}

function toRouteSegments(routes: ItineraryDayRoutes | undefined): PlanScoreRouteSegment[] {
  return (routes?.segments ?? []).map((segment) =>
    segment.durationSeconds === null
      ? { id: segment.id, scope: 'LOCAL', status: 'UNKNOWN' }
      : {
          duration: { minutes: segment.durationSeconds / 60, source: 'FRESH_PROVIDER' },
          id: segment.id,
          scope: 'LOCAL',
          status: 'KNOWN',
        },
  );
}

function toDayItems(day: PlanScoreDayRecord, routes: ItineraryDayRoutes | undefined) {
  return day.items.map((item): PlanScoreDayItem => {
    const startMinutes = itemStartMinutes(item, day.timeZone);
    const travelMinutes = inboundTravelMinutes(routes, item.id);

    return {
      duration:
        item.durationMinutes === null
          ? null
          : { minutes: item.durationMinutes, source: 'USER_OWNED' },
      fixed: item.reservationCount > 0 || item.timeSemantics === 'AUTHORITATIVE_INSTANT',
      id: item.id,
      inboundTravel:
        travelMinutes === null ? null : { minutes: travelMinutes, source: 'FRESH_PROVIDER' },
      openingHours: { status: 'UNKNOWN' },
      start: startMinutes === null ? null : { minutes: startMinutes, source: 'USER_OWNED' },
    };
  });
}

function toCommitments(day: PlanScoreDayRecord): PlanScoreFixedCommitment[] {
  return day.commitments.map((commitment) => ({
    endMinute: commitment.endMinute,
    id: commitment.id,
    source: 'USER_OWNED',
    startMinute: commitment.startMinute,
  }));
}

function toDayPlaces(day: PlanScoreDayRecord, ratings: Map<string, number>): PlanScorePlace[] {
  const tripPlaceIds = [
    ...new Set(day.items.flatMap((item) => (item.tripPlaceId ? [item.tripPlaceId] : []))),
  ];

  return tripPlaceIds.map((tripPlaceId) => {
    const rating = ratings.get(tripPlaceId);
    return {
      rating:
        rating === undefined
          ? { status: 'UNKNOWN' }
          : { rating, source: 'FRESH_PROVIDER', status: 'KNOWN' },
      tripPlaceId,
    };
  });
}

type DayEvaluation = {
  conflicts: ReturnType<typeof evaluateFeasibility>['conflicts'];
  input: PlanScoreDayInput;
  pace: ReturnType<typeof evaluatePaceBuffer>;
  travel: ReturnType<typeof evaluateTravelEffort>;
};

function evaluateDayRecord(day: PlanScoreDayRecord, record: PlanScoreTripRecord): DayEvaluation {
  const routes = record.routes.get(day.id);
  const items = toDayItems(day, routes);
  const segments = toRouteSegments(routes);
  const feasibility = evaluateFeasibility({ commitments: toCommitments(day), items });
  const travel = evaluateTravelEffort(segments);
  const pace = evaluatePaceBuffer({ items, segments });
  const placeQuality = evaluatePlaceQuality(toDayPlaces(day, record.ratings));

  return {
    conflicts: feasibility.conflicts,
    input: {
      dayId: day.id,
      // Route efficiency is deliberately absent: an alternative-order comparison
      // needs a pairwise duration matrix this endpoint does not fetch.
      factors: {
        FEASIBILITY: feasibility.factor,
        PACE_BUFFER: pace.factor,
        PLACE_QUALITY: placeQuality,
        TRAVEL_EFFORT: travel.factor,
      },
    },
    pace,
    travel,
  };
}

/**
 * Pure scoring over already-loaded evidence, so the aggregation and explanation
 * wiring can be exercised without a database or provider.
 */
export function buildTripPlanScore(record: PlanScoreTripRecord): TripPlanScore {
  const evaluations = record.days.map((day) => ({
    day,
    evaluation: evaluateDayRecord(day, record),
  }));
  const scheduledTripPlaceIds = record.days.flatMap((day) =>
    day.items.flatMap((item) => (item.tripPlaceId ? [item.tripPlaceId] : [])),
  );
  const mustGoPriorityFit: PlanScoreFactorResult = evaluateMustGoPriorityFit({
    mustGoTripPlaceIds: record.mustGoTripPlaceIds,
    scheduledTripPlaceIds,
    source: 'USER_OWNED',
  });
  const tripInput = {
    days: evaluations.map(({ evaluation }) => evaluation.input),
    mustGoPriorityFit,
  };
  const result = scoreTrip(tripInput);
  const scheduled = new Set(scheduledTripPlaceIds);

  return {
    days: result.days.map((dayResult, index) => {
      const entry = evaluations[index];
      return {
        ...toPlanScoreDayPayload(dayResult),
        date: entry?.day.date ?? '',
        explanations: explainDay({
          alternatives: [],
          conflicts: entry?.evaluation.conflicts ?? [],
          day: dayResult,
          pace: {
            activeMinutes: entry?.evaluation.pace.activeMinutes ?? null,
            smallestBufferMinutes: entry?.evaluation.pace.smallestBufferMinutes ?? null,
          },
          route: { bestMinutes: null, plannedMinutes: null },
          travel: { totalMinutes: entry?.evaluation.travel.totalMinutes ?? null },
        }),
      };
    }),
    explanations: explainTrip({
      mustGoPriorityFit: result.mustGoPriorityFit,
      unscheduledMustGoTripPlaceIds: record.mustGoTripPlaceIds.filter(
        (tripPlaceId) => !scheduled.has(tripPlaceId),
      ),
    }),
    fingerprint: planScoreFingerprint(tripInput),
    generatedAt: new Date().toISOString(),
    mustGoPriorityFit: result.mustGoPriorityFit,
    score: result.score,
    withheldReasons: result.withheldReasons,
  };
}

function toLocalDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function sameDayJourneyCommitment(reservation: {
  flightArrivalLocalDate: Date | null;
  flightArrivalLocalTime: Date | null;
  flightDepartureLocalDate: Date | null;
  flightDepartureLocalTime: Date | null;
  id: string;
}) {
  const departureDate = reservation.flightDepartureLocalDate;
  const arrivalDate = reservation.flightArrivalLocalDate;
  const departure = formatLocalTime(reservation.flightDepartureLocalTime);
  const arrival = formatLocalTime(reservation.flightArrivalLocalTime);
  if (!departureDate || !arrivalDate || !departure || !arrival) return null;
  if (toLocalDate(departureDate) !== toLocalDate(arrivalDate)) return null;

  const startMinute = parseMinutes(departure);
  const endMinute = parseMinutes(arrival);
  if (startMinute === null || endMinute === null || endMinute <= startMinute) return null;

  return { date: toLocalDate(departureDate), endMinute, id: reservation.id, startMinute };
}

async function loadRatings(
  tripPlaces: Array<{ externalPlaceId: string | null; id: string }>,
  placesService: PlacesService | null,
) {
  const ratings = new Map<string, number>();
  if (!placesService) return ratings;

  const results = await Promise.all(
    tripPlaces.map(async (tripPlace) => {
      if (!tripPlace.externalPlaceId) return null;
      const details = await placesService.getDetails({
        externalPlaceId: tripPlace.externalPlaceId,
      });
      if (details.status !== 'ok' || details.place.rating === null) return null;
      return { id: tripPlace.id, rating: details.place.rating };
    }),
  );

  for (const result of results) {
    if (result) ratings.set(result.id, result.rating);
  }

  return ratings;
}

export async function getTripPlanScore(
  userId: string,
  tripId: string,
  services: { placesService?: PlacesService | null } = {},
): Promise<TripPlanScore> {
  const prisma = getPrismaClient();
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    include: {
      itineraryDays: {
        orderBy: { date: 'asc' },
        include: {
          items: {
            orderBy: { position: 'asc' },
            include: { _count: { select: { reservations: true } } },
          },
        },
      },
      reservations: {
        select: {
          flightArrivalLocalDate: true,
          flightArrivalLocalTime: true,
          flightDepartureLocalDate: true,
          flightDepartureLocalTime: true,
          id: true,
        },
      },
      tripPlaces: {
        select: { id: true, place: { select: { providerRefs: true } }, priority: true },
      },
    },
  });
  if (!trip) throw new ItineraryNotFoundError('trip_not_found');

  const placesService =
    services.placesService === undefined ? createPlacesService() : services.placesService;
  const commitments = trip.reservations.flatMap((reservation) => {
    const commitment = sameDayJourneyCommitment(reservation);
    return commitment ? [commitment] : [];
  });

  const [routeResults, ratings] = await Promise.all([
    Promise.all(
      trip.itineraryDays.map(async (day) => ({
        id: day.id,
        routes: await getItineraryDayRoutes(userId, tripId, day.id),
      })),
    ),
    loadRatings(
      trip.tripPlaces.map((tripPlace) => ({
        externalPlaceId:
          tripPlace.place.providerRefs.find((reference) => reference.provider === 'GOOGLE')
            ?.externalPlaceId ?? null,
        id: tripPlace.id,
      })),
      placesService,
    ),
  ]);

  return buildTripPlanScore({
    days: trip.itineraryDays.map((day) => {
      const date = toLocalDate(day.date);
      return {
        commitments: commitments.filter((commitment) => commitment.date === date),
        date,
        id: day.id,
        items: day.items.map((item) => ({
          durationMinutes: item.durationMinutes,
          id: item.id,
          localStartTime: item.localStartTime,
          reservationCount: item._count.reservations,
          startInstant: item.startInstant,
          timeSemantics: item.timeSemantics,
          timeZone: item.timeZone,
          tripPlaceId: item.tripPlaceId,
        })),
        timeZone: day.defaultTimeZone,
      };
    }),
    mustGoTripPlaceIds: trip.tripPlaces
      .filter((tripPlace) => tripPlace.priority === 'MUST_GO')
      .map((tripPlace) => tripPlace.id),
    ratings,
    routes: new Map(routeResults.map(({ id, routes }) => [id, routes])),
  });
}
