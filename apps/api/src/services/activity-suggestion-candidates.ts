type ActivitySuggestionTrip = {
  defaultStayTripPlaceId: string | null;
  stayRanges: readonly { tripPlace: { id: string } }[];
  reservations: readonly { type: string | null; tripPlaceId: string | null }[];
  itineraryDays: readonly {
    dailyBaseTripPlaceId: string | null;
    dailyBaseDepartureTripPlaceId: string | null;
    items: readonly { tripPlaceId: string | null }[];
  }[];
  tripPlaces: readonly { id: string; placeId: string }[];
};

/**
 * Activity recommendations come from unplanned Trip Places, excluding every
 * accommodation role across the trip (even an ambiguous booking or a masked
 * default). A separately selected restaurant or attraction at a hotel keeps
 * its own Place identity and remains eligible; ratings alone never turn a Stay
 * into an activity.
 */
export function activitySuggestionCandidateIds(trip: ActivitySuggestionTrip): Set<string> {
  const occupied = new Set([
    trip.defaultStayTripPlaceId,
    ...trip.stayRanges.map((range) => range.tripPlace.id),
    ...trip.reservations
      .filter((reservation) => reservation.type === 'ACCOMMODATION')
      .map((reservation) => reservation.tripPlaceId),
    ...trip.itineraryDays.flatMap((day) => [
      day.dailyBaseTripPlaceId,
      day.dailyBaseDepartureTripPlaceId,
      ...day.items.map((item) => item.tripPlaceId),
    ]),
  ]);
  const excludedPlaces = new Set(
    trip.tripPlaces.filter((place) => occupied.has(place.id)).map((place) => place.placeId),
  );
  const candidates = new Set<string>();
  const seen = new Set<string>();
  for (const place of trip.tripPlaces) {
    if (excludedPlaces.has(place.placeId) || seen.has(place.placeId)) continue;
    candidates.add(place.id);
    seen.add(place.placeId);
  }
  return candidates;
}
