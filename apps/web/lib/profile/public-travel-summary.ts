import type { PublicTravellerTrip } from '@/lib/public-trip/api';
import { calendarDayDistance } from '@/lib/trips/lifecycle';

export function publicTripDayCount(trip: Pick<PublicTravellerTrip, 'endDate' | 'startDate'>) {
  return calendarDayDistance(trip.startDate, trip.endDate) + 1;
}
