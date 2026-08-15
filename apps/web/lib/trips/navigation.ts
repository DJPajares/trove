import type { Trip } from './api';

/**
 * The three experiences Trove is built around — plan it, live it, remember it —
 * plus the supporting tools that serve them. Keeping the shape here rather than in
 * the header component means the lifecycle rules can be read and tested on their own.
 */
export type TripSection =
  'expenses' | 'info' | 'itinerary' | 'memories' | 'mode' | 'places' | 'reservations' | 'tasks';

export type TripDestination = {
  /** Drives visual weight only; every destination is always present. */
  emphasis: 'leading' | 'quiet' | 'standard';
  href: string;
  labelKey: string;
  section: TripSection;
};

/**
 * A trip is planned, then lived, then remembered, and the interface should lean
 * toward whichever of those the traveller is actually in. Emphasis shifts; the set
 * and its order never do, because navigation that rearranges itself between visits
 * costs more than it gives.
 */
export function primaryTripDestinations(
  tripId: string,
  lifecycle: Trip['lifecycle'],
  startDate: string,
): TripDestination[] {
  const base = `/trips/${tripId}`;

  return [
    {
      emphasis: lifecycle === 'planning' ? 'leading' : 'standard',
      href: `${base}/itinerary`,
      labelKey: 'itinerary',
      section: 'itinerary',
    },
    {
      emphasis:
        lifecycle === 'active' ? 'leading' : lifecycle === 'completed' ? 'quiet' : 'standard',
      // Before departure Trip Mode is only useful as a rehearsal, so it opens in
      // Preview at the first day rather than pretending the trip has started.
      href:
        lifecycle === 'planning'
          ? `${base}/mode?preview=1&date=${encodeURIComponent(startDate)}&time=09%3A00`
          : `${base}/mode`,
      labelKey: lifecycle === 'planning' ? 'preview' : 'tripMode',
      section: 'mode',
    },
    {
      emphasis: lifecycle === 'completed' ? 'leading' : 'quiet',
      href: `${base}/memories`,
      labelKey: 'memories',
      section: 'memories',
    },
  ];
}

/**
 * Everything a trip needs but should not have to look at. Places sits here until
 * the itinerary carries it directly.
 */
export function supportingTripDestinations(tripId: string): TripDestination[] {
  const base = `/trips/${tripId}`;

  return (
    [
      ['places', 'places'],
      ['tasks', 'tasks'],
      ['reservations', 'reservations'],
      ['expenses', 'expenses'],
      ['info', 'tripInfo'],
    ] as const
  ).map(([section, labelKey]) => ({
    emphasis: 'standard' as const,
    href: `${base}/${section}`,
    labelKey,
    section,
  }));
}
