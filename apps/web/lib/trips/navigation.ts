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
 * Trip section headers omit the planning Preview entry without changing the
 * shared set of destinations or the preview route itself.
 */
export function visibleTripNavigationDestinations(
  destinations: TripDestination[],
  currentSection: TripSection,
): TripDestination[] {
  return destinations.filter(
    (destination) =>
      destination.labelKey !== 'preview' &&
      !(currentSection === 'itinerary' && destination.section === 'mode'),
  );
}

/**
 * How much visual weight a destination's control carries. The mapping lives
 * beside the emphasis it reads so a surface never invents its own answer, and
 * so the whole lifecycle rule stays testable without rendering anything.
 */
export function tripDestinationEmphasisVariant(emphasis: TripDestination['emphasis']) {
  if (emphasis === 'leading') return 'default' as const;
  if (emphasis === 'quiet') return 'ghost' as const;

  return 'outline' as const;
}

const emphasisRank: Record<TripDestination['emphasis'], number> = {
  quiet: 0,
  standard: 1,
  leading: 2,
};

/**
 * Whether a destination is prominent enough for a surface that shows only some
 * of them. A focal card offers the stage's own actions; the full set belongs to
 * navigation, which never hides anything.
 */
export function isEmphasisAtLeast(
  emphasis: TripDestination['emphasis'],
  minimum: 'quiet' | 'standard',
) {
  return emphasisRank[emphasis] >= emphasisRank[minimum];
}

/**
 * What every section is called, including the ones that appear in neither the primary
 * set nor the menu. A screen the traveller can reach must still be able to say its
 * name, so nothing is left having to describe itself as "More".
 */
const sectionLabelKeys: Record<TripSection, string> = {
  expenses: 'expenses',
  info: 'tripInfo',
  itinerary: 'itinerary',
  memories: 'memories',
  mode: 'tripMode',
  places: 'places',
  reservations: 'reservations',
  tasks: 'tasks',
};

export function tripSectionLabelKey(section: TripSection): string {
  return sectionLabelKeys[section];
}

/**
 * Everything a trip needs but should not have to look at. Places sits here until
 * the itinerary carries it directly.
 */
export function supportingTripDestinations(tripId: string): TripDestination[] {
  const base = `/trips/${tripId}`;

  // Places is not here: the itinerary opens the collection directly, so listing it
  // again would be a second door to the same room. The route still works.
  return (
    [
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
