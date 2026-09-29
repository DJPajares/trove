/**
 * Where a traveller's day starts and ends - their stay. Travellers call it
 * their stay; the columns keep their original `dailyBase*` names.
 *
 * One reading for every surface that needs it (routes, Trip Mode, weather,
 * Insights, time zones, scoring) so they cannot disagree. A stay only ever adds
 * to a plan: with none known, each caller behaves exactly as it did before.
 *
 * Precedence, per end of the day:
 * 1. What the traveller set on the day.
 * 2. An accommodation they linked to the day by hand.
 * 3. An accommodation whose check-in and check-out dates span the day: a
 *    stay is where the day starts from the morning after check-in through
 *    check-out, and where it ends from check-in until the night before
 *    check-out. A transfer day therefore starts at one stay and ends at the
 *    next, with nothing picked by hand.
 * Anything ambiguous - two stays that could both be the answer - resolves to
 * no stay on that end rather than a guess.
 */
export type DayStaySource = 'explicit' | 'accommodation';
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
): { start: DayStayEnd<Place>; end: DayStayEnd<Place> } {
  const booked = accommodationStay(day, accommodations);
  const explicitEnd = day.dailyBaseDepartureTripPlace ?? day.dailyBaseTripPlace;
  return {
    start: day.dailyBaseTripPlace
      ? { place: day.dailyBaseTripPlace, source: 'explicit' }
      : booked.start
        ? { place: booked.start, source: 'accommodation' }
        : null,
    end: explicitEnd
      ? { place: explicitEnd, source: 'explicit' }
      : booked.end
        ? { place: booked.end, source: 'accommodation' }
        : null,
  };
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
