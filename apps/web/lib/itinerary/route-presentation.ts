import type { ItineraryRouteSegment } from '@/lib/itinerary/api';

export type RoutePresentationState = 'cached' | 'estimated' | 'not-estimated' | 'unavailable';

export function routePresentationState(
  status: ItineraryRouteSegment['status'],
  stale: boolean,
): RoutePresentationState {
  if (status === 'not_estimated') return 'not-estimated';
  if (status !== 'ok') return 'unavailable';
  return stale ? 'cached' : 'estimated';
}
