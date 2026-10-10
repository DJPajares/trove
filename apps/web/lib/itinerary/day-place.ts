import { dayLocality, localityFromAddress } from '@trove/types';

import type { ItineraryDay, ItineraryTripPlace } from './api';

export { dayLocality, localityFromAddress, sameTown } from '@trove/types';

/**
 * The town a day happens in. Its Stay decides first - where the traveller ends
 * the day, else where they start it, else a base set by hand - read from that
 * place's address rather than named after it, because a hotel is not a town. A
 * day with no Stay to go on is named after the town most of its stops share,
 * and a day that says nothing safely is left unnamed.
 *
 * The planner heads each day with it and the Memories journal names each
 * chapter with it, so a day is called the same thing in both.
 */
export function dayTown(
  day: Pick<ItineraryDay, 'dailyBaseTripPlaceId' | 'items' | 'stay'>,
  tripPlaces: readonly ItineraryTripPlace[],
) {
  const stayId =
    day.stay?.endTripPlaceId ?? day.stay?.startTripPlaceId ?? day.dailyBaseTripPlaceId ?? null;
  const stay = stayId ? tripPlaces.find((tripPlace) => tripPlace.id === stayId) : null;
  const stayLocality = stay
    ? localityFromAddress(stay.place.snapshot?.address ?? stay.place.providerAddress)
    : null;
  if (stayLocality) return stayLocality;

  return dayLocality(
    day.items.map(
      (item) => item.tripPlace?.place.snapshot?.address ?? item.tripPlace?.place.providerAddress,
    ),
  );
}
