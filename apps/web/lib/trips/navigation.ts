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

export type TripCoreExperience = Extract<TripSection, 'itinerary' | 'memories' | 'mode'>;

type TripCoreDestination = Omit<TripDestination, 'section'> & {
  section: TripCoreExperience;
};

export type TripOverviewDestination = TripCoreDestination & {
  /** The label shown by the overview, which can differ from the canonical route label. */
  displayLabelKey: string;
  /** The localized description shown by the overview tile. */
  descriptionKey: string;
};

export type TripOverviewDestinations = {
  primary: TripOverviewDestination;
  secondary: [TripOverviewDestination, TripOverviewDestination];
};

function isTripCoreExperience(destination: TripDestination): destination is TripCoreDestination {
  return ['itinerary', 'memories', 'mode'].includes(destination.section);
}

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
      // Planning and completed trips use Trip Mode as a rehearsal, so they open
      // in Preview at the first day rather than pretending the trip is live.
      href:
        lifecycle === 'planning' || lifecycle === 'completed'
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
 * Trip Mode is live only during an active trip. Planning and completed trips can
 * still open the same experience when the traveller explicitly chooses Preview.
 */
export function isTripModeAvailable(lifecycle: Trip['lifecycle'], isPreview: boolean): boolean {
  return (
    lifecycle === 'active' || (isPreview && (lifecycle === 'planning' || lifecycle === 'completed'))
  );
}

/**
 * Projects the stable three-experience navigation contract into the overview's
 * one-primary, two-secondary composition. The source list remains the single
 * place that owns lifecycle routing, labels and Preview parameters.
 */
export function tripOverviewDestinations(
  tripId: string,
  lifecycle: Trip['lifecycle'],
  startDate: string,
): TripOverviewDestinations {
  const destinations = primaryTripDestinations(tripId, lifecycle, startDate);
  const coreDestinations = destinations.filter(isTripCoreExperience);
  const overviewDestinations = coreDestinations.map((destination) => {
    const isCompletedPreview = lifecycle === 'completed' && destination.section === 'mode';

    return {
      ...destination,
      descriptionKey: isCompletedPreview ? 'previewCompleted' : destination.labelKey,
      displayLabelKey: isCompletedPreview ? 'preview' : destination.labelKey,
    } satisfies TripOverviewDestination;
  });
  const primary = overviewDestinations.find((destination) => destination.emphasis === 'leading');
  const distinctSections = new Set(overviewDestinations.map((destination) => destination.section));
  const distinctHrefs = new Set(overviewDestinations.map((destination) => destination.href));
  const secondary = overviewDestinations.filter((destination) => destination !== primary);
  const [firstSecondary, secondSecondary, ...unexpectedSecondary] = secondary;

  if (
    overviewDestinations.length !== destinations.length ||
    distinctSections.size !== 3 ||
    distinctHrefs.size !== 3 ||
    !primary ||
    !firstSecondary ||
    !secondSecondary ||
    unexpectedSecondary.length
  ) {
    throw new Error('invalid_trip_overview_destinations');
  }

  return {
    primary,
    secondary: [firstSecondary, secondSecondary],
  };
}

/**
 * Trip section headers keep only the planning and memories destinations. The
 * shared destination set and the Preview and Trip Mode routes remain intact.
 */
export function visibleTripNavigationDestinations(
  destinations: TripDestination[],
): TripDestination[] {
  return destinations.filter((destination) => destination.section !== 'mode');
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

/**
 * The trip section a path is standing on, or null when the path is not one of
 * a trip's sections. The chrome derives this rather than taking it as a prop:
 * it is mounted by the layout, which never learns which child is rendering.
 */
export function tripSectionFromPathname(pathname: string, tripId: string): TripSection | null {
  const prefix = `/trips/${tripId}/`;
  if (!pathname.startsWith(prefix)) return null;

  const segment = pathname.slice(prefix.length).split('/')[0];
  const sections: TripSection[] = [
    'expenses',
    'info',
    'itinerary',
    'memories',
    'mode',
    'places',
    'reservations',
    'tasks',
  ];

  return sections.find((section) => section === segment) ?? null;
}
