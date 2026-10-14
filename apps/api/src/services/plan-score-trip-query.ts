// Keep this query definition independent of scoring and itinerary services.
// Scheduling extends it during module initialization, before those services may be ready.
/**
 * What a Plan Score reads, as a Prisma selection. Exported so Apply reads the
 * rows it just created through the same shape rather than reconstructing them:
 * a second mapper is a second thing to keep in step with the rubric, and a
 * revision computed from a drifted one silently serves a stale score.
 */
export const PLAN_SCORE_TRIP_INCLUDE = {
  itineraryDays: {
    orderBy: { date: 'asc' },
    include: {
      items: {
        orderBy: { position: 'asc' },
        include: { _count: { select: { reservations: true } } },
      },
    },
  },
  destinations: { include: { place: { include: { providerRefs: true } } } },
  reservations: {
    select: {
      itineraryItemId: true,
      type: true,
      // A booked stay moves where the day's legs start and end, so it belongs
      // in the planning revision the scorer is cached against.
      tripPlaceId: true,
      checkInDate: true,
      checkOutDate: true,
      accommodationDays: { select: { itineraryDayId: true } },
      transportPickupLocation: true,
      transportDropoffLocation: true,
      localDate: true,
      localTime: true,
      timeZone: true,
      transportDepartureLocalDate: true,
      transportDepartureLocalTime: true,
      transportDepartureTimeZone: true,
      transportDepartureInstant: true,
      transportArrivalLocalDate: true,
      transportArrivalLocalTime: true,
      transportArrivalTimeZone: true,
      transportArrivalInstant: true,
      flightDepartureTimeZone: true,
      flightDepartureInstant: true,
      flightArrivalTimeZone: true,
      flightArrivalInstant: true,
      flightArrivalLocalDate: true,
      flightArrivalLocalTime: true,
      flightDepartureLocalDate: true,
      flightDepartureLocalTime: true,
      id: true,
    },
  },
  tripPlaces: {
    select: { id: true, placeId: true, place: { include: { providerRefs: true } }, priority: true },
  },
} as const;
