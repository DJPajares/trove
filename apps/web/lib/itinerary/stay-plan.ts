import { stayRangeForEndpoint, type StayPlan } from '@trove/types';
import type { ItineraryDay } from './api';

/** The save preview uses booking/default fallbacks supplied by the shared server resolver. */
export function previewStayEndpoints(day: ItineraryDay, plan: StayPlan) {
  const automatic = (end: 'start' | 'end') => {
    const range = stayRangeForEndpoint(plan.ranges, day.date, end);
    if (range) return range.tripPlaceId;
    const fallback = day.stayFallback;
    if ((end === 'start' ? fallback?.startSource : fallback?.endSource) === 'trip_default')
      return plan.defaultTripPlaceId;
    return fallback
      ? end === 'start'
        ? fallback.startTripPlaceId
        : fallback.endTripPlaceId
      : plan.defaultTripPlaceId;
  };
  const startMode = day.stayStartMode ?? (day.dailyBaseTripPlaceId ? 'PLACE' : 'INHERIT');
  const endMode =
    day.stayEndMode ??
    (day.dailyBaseDepartureTripPlaceId
      ? 'PLACE'
      : day.dailyBaseTripPlaceId
        ? 'SAME_AS_START'
        : 'INHERIT');
  const start =
    startMode === 'NONE'
      ? null
      : startMode === 'PLACE'
        ? day.dailyBaseTripPlaceId
        : automatic('start');
  const end =
    endMode === 'NONE'
      ? null
      : endMode === 'PLACE'
        ? day.dailyBaseDepartureTripPlaceId
        : endMode === 'SAME_AS_START'
          ? start
          : automatic('end');
  return { start, end };
}
