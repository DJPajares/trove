/**
 * Where a traveller's day starts and ends - their stay. Travellers call it
 * their stay; the columns keep their original `dailyBase*` names.
 *
 * One reading for every surface that needs it (routes, Trip Mode, weather,
 * Insights, time zones, scoring) so they cannot disagree. A stay only ever adds
 * to a plan: with none known, each caller behaves exactly as it did before.
 *
 * Day overrides (including none) win, then a night in a planning range,
 * accommodation inference, and the trip default. Arrive/Leave dates govern
 * nights for every kind of stay, including friends' and family homes.
 * Ambiguous bookings never silently fall back to the trip default.
 */
import { stayRangeForEndpoint } from '@trove/types';
export type DayStaySource = import('@trove/types').StaySource;
type EndpointMode = 'INHERIT' | 'NONE' | 'PLACE' | 'SAME_AS_START';
export type TripStayPlan<Place> = {
  startDate?: Date;
  endDate?: Date;
  defaultStayTripPlace?: Place | null;
  stayRanges?: readonly { startDate: Date; endDate: Date; tripPlace: Place }[];
};

export function tripStayInclude<Include>(tripPlace: Include) {
  return {
    defaultStayTripPlace: tripPlace,
    stayRanges: { include: { tripPlace }, orderBy: { startDate: 'asc' as const } },
  };
}
export type DayStayEnd<Place> = { place: Place; source: DayStaySource } | null;

export type StayAccommodation<Place> = {
  checkInDate: Date | null;
  checkOutDate: Date | null;
  /** Linked days restrict this booking; known dates still constrain each endpoint. */
  linkedDayIds: readonly string[];
  tripPlace: Place | null;
};

export type StayDay<Place> = {
  id: string;
  date: Date;
  stayStartMode?: EndpointMode | null;
  stayEndMode?: EndpointMode | null;
  dailyBaseTripPlace: Place | null;
  dailyBaseDepartureTripPlace: Place | null;
};

function only<Place extends { id: string }>(places: readonly Place[]): Place | null {
  const distinct = [...new Map(places.map((place) => [place.id, place])).values()];
  return distinct.length === 1 ? distinct[0]! : null;
}

/** Linked days select applicability; known dates still constrain each endpoint. */
function accommodationCandidates<Place extends { id: string }>(
  day: Pick<StayDay<Place>, 'id' | 'date'>,
  accommodations: readonly StayAccommodation<Place>[],
  endpoint: 'start' | 'end',
) {
  const eligible = (entry: StayAccommodation<Place>) =>
    endpoint === 'start'
      ? (!entry.checkInDate || entry.checkInDate < day.date) &&
        (!entry.checkOutDate || day.date <= entry.checkOutDate)
      : (!entry.checkInDate || entry.checkInDate <= day.date) &&
        (!entry.checkOutDate || day.date < entry.checkOutDate);
  const located = accommodations.filter(
    (entry): entry is StayAccommodation<Place> & { tripPlace: Place } => entry.tripPlace !== null,
  );
  const linked = located.filter((entry) => entry.linkedDayIds.includes(day.id) && eligible(entry));
  return linked.length
    ? linked
    : located.filter(
        (entry) =>
          !entry.linkedDayIds.length && entry.checkInDate && entry.checkOutDate && eligible(entry),
      );
}

/** The accommodation-backed stay alone, before anything the traveller set. */
export function accommodationStay<Place extends { id: string }>(
  day: Pick<StayDay<Place>, 'id' | 'date'>,
  accommodations: readonly StayAccommodation<Place>[],
): { start: Place | null; end: Place | null } {
  return {
    start: only(
      accommodationCandidates(day, accommodations, 'start').map((entry) => entry.tripPlace),
    ),
    end: only(accommodationCandidates(day, accommodations, 'end').map((entry) => entry.tripPlace)),
  };
}

export function resolveDayStay<Place extends { id: string }>(
  day: StayDay<Place>,
  accommodations: readonly StayAccommodation<Place>[],
  plan: TripStayPlan<Place> = {},
): { start: DayStayEnd<Place>; end: DayStayEnd<Place> } {
  const booked = accommodationStay(day, accommodations);
  const ranges = (plan.stayRanges ?? []).map((range) => ({
    ...range,
    startDate: range.startDate.toISOString().slice(0, 10),
    endDate: range.endDate.toISOString().slice(0, 10),
  }));
  const automatic = (end: 'start' | 'end'): DayStayEnd<Place> => {
    const range = stayRangeForEndpoint(ranges, day.date.toISOString().slice(0, 10), end);
    if (range) return { place: range.tripPlace, source: 'stay_range' };
    if (booked[end]) return { place: booked[end], source: 'accommodation' };
    // A conflicting booking is not permission to guess the trip default.
    if (accommodationCandidates(day, accommodations, end).length) return null;
    // A trip default plans this trip's nights, not the night before arrival.
    if (end === 'start' && day.date.getTime() === plan.startDate?.getTime()) return null;
    if (end === 'end' && plan.endDate && day.date >= plan.endDate) return null;
    return plan.defaultStayTripPlace
      ? { place: plan.defaultStayTripPlace, source: 'trip_default' }
      : null;
  };
  const startMode = day.stayStartMode ?? (day.dailyBaseTripPlace ? 'PLACE' : 'INHERIT');
  const endMode =
    day.stayEndMode ??
    (day.dailyBaseDepartureTripPlace
      ? 'PLACE'
      : day.dailyBaseTripPlace
        ? 'SAME_AS_START'
        : 'INHERIT');
  const start: DayStayEnd<Place> =
    startMode === 'NONE'
      ? null
      : startMode === 'PLACE'
        ? day.dailyBaseTripPlace
          ? { place: day.dailyBaseTripPlace, source: 'explicit' }
          : null
        : automatic('start');
  const end: DayStayEnd<Place> =
    endMode === 'NONE'
      ? null
      : endMode === 'SAME_AS_START'
        ? start
          ? { ...start, source: 'explicit' }
          : null
        : endMode === 'PLACE'
          ? day.dailyBaseDepartureTripPlace
            ? { place: day.dailyBaseDepartureTripPlace, source: 'explicit' }
            : null
          : automatic('end');
  return { start, end };
}

/** The Prisma selection every caller uses to feed `resolveDayStay`. */
export function stayAccommodationsInclude<TripPlaceInclude>(tripPlace: TripPlaceInclude) {
  return {
    where: { type: 'ACCOMMODATION' as const },
    select: {
      checkInDate: true,
      checkOutDate: true,
      accommodationDays: { select: { itineraryDayId: true } },
      tripPlace,
    },
  };
}

export function toStayAccommodations<Place>(
  rows: ReadonlyArray<{
    checkInDate: Date | null;
    checkOutDate: Date | null;
    accommodationDays: ReadonlyArray<{ itineraryDayId: string }>;
    tripPlace: Place | null;
  }>,
): StayAccommodation<Place>[] {
  return rows.map((row) => ({
    checkInDate: row.checkInDate,
    checkOutDate: row.checkOutDate,
    linkedDayIds: row.accommodationDays.map((link) => link.itineraryDayId),
    tripPlace: row.tripPlace,
  }));
}
