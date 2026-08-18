import { dayPartWindow } from './day-part-windows.js';
import { formatInstantInTimeZone, formatLocalTime } from './itinerary-rules.js';
import type { ItineraryDayRoutes } from './itinerary-routes.js';
import { resolveOpeningHoursForDay } from './place-opening-hours.js';
import type { PlaceOpeningPeriod } from './places.js';
import type { PlanScoreDayItem, PlanScoreOpeningHours } from './plan-score-factors.js';

/**
 * Turns stored itinerary rows plus live route and provider evidence into the
 * day shape the Plan Score rubric already understands.
 *
 * Pure, so both the trip-wide scorer and the day-scoped time suggester can share
 * one reading of a day without sharing a query. Each caller keeps its own Prisma
 * access: the scorer loads every day at once, and duplicating that per day would
 * turn one query into one per day.
 */

/** Provider opening evidence keyed by Trip Place id. */
export type PlaceHoursEvidence = Map<
  string,
  { periods: PlaceOpeningPeriod[]; utcOffsetMinutes: number | null }
>;

export type ItineraryDayItemRecord = {
  dayPart: string | null;
  durationMinutes: number | null;
  id: string;
  localStartTime: Date | null;
  reservationCount: number;
  startInstant: Date | null;
  timeSemantics: string | null;
  timeZone: string | null;
  tripPlaceId: string | null;
};

export type ItineraryDayCommitmentRecord = {
  endMinute: number;
  id: string;
  startMinute: number;
};

export type ItineraryDayRecord = {
  commitments: ItineraryDayCommitmentRecord[];
  date: string;
  id: string;
  items: ItineraryDayItemRecord[];
  timeZone: string;
};

export function toLocalDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function parseMinutes(value: string) {
  const [hours, minutes] = value.split(':');
  if (hours === undefined || minutes === undefined) return null;

  const total = Number(hours) * 60 + Number(minutes);
  return Number.isFinite(total) ? total : null;
}

export function itemStartMinutes(item: ItineraryDayItemRecord, dayTimeZone: string) {
  const local = formatLocalTime(item.localStartTime);
  if (local) return parseMinutes(local);
  if (!item.startInstant) return null;

  return parseMinutes(
    formatInstantInTimeZone(item.startInstant, item.timeZone ?? dayTimeZone).time,
  );
}

export function inboundTravelMinutes(routes: ItineraryDayRoutes | undefined, itemId: string) {
  const segment = routes?.segments.find(
    (entry) => entry.destination.kind === 'itinerary_item' && entry.destination.id === itemId,
  );
  if (!segment || segment.durationSeconds === null) return null;

  return segment.durationSeconds / 60;
}

/**
 * A flight whose departure and arrival fall on the same local day occupies that
 * day the way a reservation does. PRD section 29.1 treats a long-distance
 * journey as logistics rather than local travel, so it enters as a fixed
 * commitment instead of a routed leg.
 */
export function sameDayJourneyCommitment(reservation: {
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

export function toDayEvidenceItems(
  day: ItineraryDayRecord,
  routes: ItineraryDayRoutes | undefined,
  hours: PlaceHoursEvidence,
): PlanScoreDayItem[] {
  return day.items.map((item): PlanScoreDayItem => {
    const startMinutes = itemStartMinutes(item, day.timeZone);
    const travelMinutes = inboundTravelMinutes(routes, item.id);
    const window = dayPartWindow(item.dayPart);
    const placeHours = item.tripPlaceId ? hours.get(item.tripPlaceId) : undefined;
    const openingHours: PlanScoreOpeningHours = placeHours
      ? resolveOpeningHoursForDay({
          date: day.date,
          dayTimeZone: day.timeZone,
          periods: placeHours.periods,
          utcOffsetMinutes: placeHours.utcOffsetMinutes,
        })
      : { status: 'UNKNOWN' };

    return {
      duration:
        item.durationMinutes === null
          ? null
          : { minutes: item.durationMinutes, source: 'USER_OWNED' },
      // FLOATING_LOCAL is the exact-clock-time case (see `scheduleData`'s
      // `local_time` branch): the traveller picked a real start, not just a
      // daypart, so it is as much a commitment as a reservation or an
      // AUTHORITATIVE_INSTANT would be — and nothing ever writes the latter.
      fixed:
        item.reservationCount > 0 ||
        item.timeSemantics === 'AUTHORITATIVE_INSTANT' ||
        item.timeSemantics === 'FLOATING_LOCAL',
      id: item.id,
      inboundTravel:
        travelMinutes === null ? null : { minutes: travelMinutes, source: 'FRESH_PROVIDER' },
      openingHours,
      start: startMinutes === null ? null : { minutes: startMinutes, source: 'USER_OWNED' },
      // Exact and coarse timings are mutually exclusive: an exact start is what
      // the traveller actually committed to, so it always wins.
      startWindow:
        startMinutes !== null || !window
          ? null
          : {
              earliestMinute: window.startMinute,
              latestMinute: window.endMinute,
              source: 'ESTIMATED',
            },
    };
  });
}
