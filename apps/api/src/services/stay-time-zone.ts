import type { DayStayEnd } from './day-stay.js';
import { resolveDayTimeZone } from './itinerary-rules.js';
import { resolvedPlaceTimeZone } from './place-data.js';
import type { OwnedContextPlace } from './owned-place-location.js';

type Place = Parameters<typeof resolvedPlaceTimeZone>[0];
/** Re-read owned location data so older cached day zones cannot keep an arrival stay's zone. */
export function stayDayTimeZone(input: {
  start: DayStayEnd<{ id: string }>;
  places: readonly { id: string; place?: Place | OwnedContextPlace | null }[];
  items: readonly {
    id: string;
    tripPlaceId: string | null;
    customLocationTimeZone?: string | null;
  }[];
  tripTimeZone: string;
}) {
  const zone = (id: string | null) => {
    const place = input.places.find((p) => p.id === id)?.place;
    return place && 'kind' in place ? resolvedPlaceTimeZone(place) : null;
  };
  const result = resolveDayTimeZone({
    dailyBase: input.start
      ? { tripPlaceId: input.start.place.id, timeZone: zone(input.start.place.id) }
      : null,
    accommodations: [],
    items: input.items.map((item) => ({
      id: item.id,
      tripPlaceId: item.tripPlaceId,
      customLocationTimeZone: item.customLocationTimeZone ?? null,
      tripPlaceTimeZone: zone(item.tripPlaceId),
    })),
    tripTimeZone: input.tripTimeZone,
  });
  if (result.source === 'EXPLICIT_DAILY_BASE') {
    if (input.start?.source === 'accommodation') result.source = 'ACCOMMODATION';
    if (input.start?.source === 'stay_range' || input.start?.source === 'trip_default')
      result.source = 'STAY_PLAN';
  }
  return result;
}
