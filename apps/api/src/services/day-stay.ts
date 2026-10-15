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
  /** Days the traveller linked by hand; when any exist, they alone apply. */
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

/**
 * Hand-linked accommodations keep their original rule: a single one is both
 * ends; two split cleanly only on the day one is checked out of and the other
 * checked into.
 */
function linkedStay<Place extends { id: string }>(
  linked: ReadonlyArray<StayAccommodation<Place> & { tripPlace: Place }>,
  day: Date,
): { start: Place | null; end: Place | null } {
  const places = only(linked.map((entry) => entry.tripPlace));
  if (places) return { start: places, end: places };
  if (linked.length === 2) {
    const leaving = linked.find((entry) => entry.checkOutDate?.getTime() === day.getTime());
    const arriving = linked.find((entry) => entry.checkInDate?.getTime() === day.getTime());
    if (leaving && arriving && leaving.tripPlace.id !== arriving.tripPlace.id)
      return { start: leaving.tripPlace, end: arriving.tripPlace };
  }
  return { start: null, end: null };
}

/** The accommodation-backed stay alone, before anything the traveller set. */
export function accommodationStay<Place extends { id: string }>(
  day: Pick<StayDay<Place>, 'id' | 'date'>,
  accommodations: readonly StayAccommodation<Place>[],
): { start: Place | null; end: Place | null } {
  const located = accommodations.filter(
    (entry): entry is StayAccommodation<Place> & { tripPlace: Place } => entry.tripPlace !== null,
  );
  const linked = located.filter((entry) => entry.linkedDayIds.includes(day.id));
  if (linked.length) return linkedStay(linked, day.date);

  const time = day.date.getTime();
  const dated = located.filter(
    (entry) => !entry.linkedDayIds.length && entry.checkInDate && entry.checkOutDate,
  );
  return {
    start: only(
      dated
        .filter(
          (entry) => entry.checkInDate!.getTime() < time && time <= entry.checkOutDate!.getTime(),
        )
        .map((entry) => entry.tripPlace),
    ),
    end: only(
      dated
        .filter(
          (entry) => entry.checkInDate!.getTime() <= time && time < entry.checkOutDate!.getTime(),
        )
        .map((entry) => entry.tripPlace),
    ),
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
    const located = accommodations.filter((entry) => entry.tripPlace);
    const linked = located.filter((entry) => entry.linkedDayIds.includes(day.id));
    const candidates = linked.length
      ? linked
      : located.filter(
          (entry) =>
            !entry.linkedDayIds.length &&
            entry.checkInDate &&
            entry.checkOutDate &&
            (end === 'start'
              ? entry.checkInDate < day.date && day.date <= entry.checkOutDate
              : entry.checkInDate <= day.date && day.date < entry.checkOutDate),
        );
    if (candidates.length) return null;
    // A trip default plans this trip's nights, not the night before arrival.
    if (end === 'start' && day.date.getTime() === plan.startDate?.getTime()) return null;
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
