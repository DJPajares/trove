import { expect, test } from 'vitest';

import {
  isEmphasisAtLeast,
  isTripModeAvailable,
  primaryTripDestinations,
  supportingTripDestinations,
  tripDestinationEmphasisVariant,
  tripOverviewDestinations,
  tripSectionLabelKey,
  type TripSection,
  visibleTripNavigationDestinations,
} from '../lib/trips/navigation.ts';

const TRIP = 'trip-japan';
const START = '2026-09-05';

function shape(lifecycle: 'active' | 'completed' | 'planning') {
  return primaryTripDestinations(TRIP, lifecycle, START).map((destination) => ({
    emphasis: destination.emphasis,
    label: destination.labelKey,
    section: destination.section,
  }));
}

test('the three experiences keep a stable order whatever stage the trip is in', () => {
  for (const lifecycle of ['planning', 'active', 'completed'] as const) {
    expect(
      primaryTripDestinations(TRIP, lifecycle, START).map((entry) => entry.section),
      `order changed for ${lifecycle}`,
    ).toStrictEqual(['itinerary', 'mode', 'memories']);
  }
});

test('emphasis follows the stage the traveller is actually in', () => {
  expect(shape('planning')).toStrictEqual([
    { emphasis: 'leading', label: 'itinerary', section: 'itinerary' },
    { emphasis: 'standard', label: 'preview', section: 'mode' },
    { emphasis: 'quiet', label: 'memories', section: 'memories' },
  ]);
  expect(shape('active')).toStrictEqual([
    { emphasis: 'standard', label: 'itinerary', section: 'itinerary' },
    { emphasis: 'leading', label: 'tripMode', section: 'mode' },
    { emphasis: 'quiet', label: 'memories', section: 'memories' },
  ]);
  expect(shape('completed')).toStrictEqual([
    { emphasis: 'standard', label: 'itinerary', section: 'itinerary' },
    { emphasis: 'quiet', label: 'tripMode', section: 'mode' },
    { emphasis: 'leading', label: 'memories', section: 'memories' },
  ]);
});

test('every destination is reachable at every stage, none are hidden', () => {
  for (const lifecycle of ['planning', 'active', 'completed'] as const) {
    const destinations = primaryTripDestinations(TRIP, lifecycle, START);
    expect(destinations.length).toBe(3);
    expect(destinations.every((entry) => entry.href.startsWith(`/trips/${TRIP}/`))).toBeTruthy();
  }
});

test('Trip Mode opens as a rehearsal before departure and after a completed trip', () => {
  const planning = primaryTripDestinations(TRIP, 'planning', START)[1];
  expect(planning?.href).toBe(`/trips/${TRIP}/mode?preview=1&date=2026-09-05&time=09%3A00`);

  expect(primaryTripDestinations(TRIP, 'active', START)[1]?.href).toBe(`/trips/${TRIP}/mode`);
  expect(primaryTripDestinations(TRIP, 'completed', START)[1]?.href).toBe(
    `/trips/${TRIP}/mode?preview=1&date=2026-09-05&time=09%3A00`,
  );
});

test('Trip Mode is live only for active trips, while Preview is available before and after', () => {
  expect(isTripModeAvailable('planning', false)).toBe(false);
  expect(isTripModeAvailable('planning', true)).toBe(true);
  expect(isTripModeAvailable('active', false)).toBe(true);
  expect(isTripModeAvailable('active', true)).toBe(true);
  expect(isTripModeAvailable('completed', false)).toBe(false);
  expect(isTripModeAvailable('completed', true)).toBe(true);
});

test('trip section navigation omits Preview and Trip Mode on every section', () => {
  for (const lifecycle of ['planning', 'active', 'completed'] as const) {
    expect(
      visibleTripNavigationDestinations(primaryTripDestinations(TRIP, lifecycle, START)).map(
        (entry) => entry.section,
      ),
    ).toStrictEqual(['itinerary', 'memories']);
  }
});

test('supporting tools stay complete and out of the primary set', () => {
  const supporting = supportingTripDestinations(TRIP);

  expect(supporting.map((entry) => entry.section)).toStrictEqual([
    'tasks',
    'reservations',
    'expenses',
    'info',
  ]);
  expect(supporting.map((entry) => entry.href)).toStrictEqual([
    `/trips/${TRIP}/tasks`,
    `/trips/${TRIP}/reservations`,
    `/trips/${TRIP}/expenses`,
    `/trips/${TRIP}/info`,
  ]);
  // The itinerary opens Places itself, so listing it here would be a second door.
  expect(supporting.every((entry) => entry.section !== 'places')).toBeTruthy();
  // Trip Info's route and its label have never matched; the mapping must survive.
  expect(supporting.at(-1)?.labelKey).toBe('tripInfo');
});

test('emphasis maps to weight, so no surface invents its own', () => {
  expect(tripDestinationEmphasisVariant('leading')).toBe('default');
  expect(tripDestinationEmphasisVariant('standard')).toBe('outline');
  expect(tripDestinationEmphasisVariant('quiet')).toBe('ghost');
});

test('emphasis ranks so a focal surface can offer only the prominent actions', () => {
  expect(isEmphasisAtLeast('leading', 'standard')).toBe(true);
  expect(isEmphasisAtLeast('standard', 'standard')).toBe(true);
  expect(isEmphasisAtLeast('quiet', 'standard')).toBe(false);

  // Nothing is below `quiet`, so the permissive threshold hides nothing.
  for (const emphasis of ['leading', 'standard', 'quiet'] as const) {
    expect(isEmphasisAtLeast(emphasis, 'quiet')).toBe(true);
  }
});

test('a focal surface offers exactly the two actions the stage calls for', () => {
  // This is the regression guard for the trip overview rewrite: the sheet used
  // to hard-code its action row, and these are the sections and hrefs it showed.
  const offered = (lifecycle: 'active' | 'completed' | 'planning') =>
    primaryTripDestinations(TRIP, lifecycle, START).filter((destination) =>
      isEmphasisAtLeast(destination.emphasis, 'standard'),
    );

  expect(offered('planning').map((entry) => entry.section)).toStrictEqual(['itinerary', 'mode']);
  expect(offered('active').map((entry) => entry.section)).toStrictEqual(['itinerary', 'mode']);
  expect(offered('completed').map((entry) => entry.section)).toStrictEqual([
    'itinerary',
    'memories',
  ]);

  expect(offered('planning').map((entry) => entry.href)).toStrictEqual([
    `/trips/${TRIP}/itinerary`,
    `/trips/${TRIP}/mode?preview=1&date=2026-09-05&time=09%3A00`,
  ]);
  expect(offered('active').map((entry) => entry.href)).toStrictEqual([
    `/trips/${TRIP}/itinerary`,
    `/trips/${TRIP}/mode`,
  ]);
  expect(offered('completed').map((entry) => entry.href)).toStrictEqual([
    `/trips/${TRIP}/itinerary`,
    `/trips/${TRIP}/memories`,
  ]);
});

test('every stage leads with exactly one action', () => {
  for (const lifecycle of ['planning', 'active', 'completed'] as const) {
    const leading = primaryTripDestinations(TRIP, lifecycle, START).filter(
      (entry) => entry.emphasis === 'leading',
    );
    expect(leading, `${lifecycle} must lead with one action`).toHaveLength(1);
  }
});

test('the Trip Overview projects one primary action and two unique secondary actions', () => {
  const expected = {
    active: { primary: 'mode', secondary: ['itinerary', 'memories'] },
    completed: { primary: 'memories', secondary: ['itinerary', 'mode'] },
    planning: { primary: 'itinerary', secondary: ['mode', 'memories'] },
  } as const;

  for (const lifecycle of ['planning', 'active', 'completed'] as const) {
    const overview = tripOverviewDestinations(TRIP, lifecycle, START);
    const all = [overview.primary, ...overview.secondary];

    expect(overview.primary.section).toBe(expected[lifecycle].primary);
    expect(overview.secondary.map((entry) => entry.section)).toStrictEqual(
      expected[lifecycle].secondary,
    );
    expect(new Set(all.map((entry) => entry.section)).size).toBe(3);
    expect(new Set(all.map((entry) => entry.href)).size).toBe(3);
  }
});

test('completed overview uses Preview copy while retaining the mode destination identity', () => {
  const overview = tripOverviewDestinations(TRIP, 'completed', START);
  const mode = overview.secondary.find((entry) => entry.section === 'mode');

  expect(mode).toMatchObject({
    descriptionKey: 'previewCompleted',
    displayLabelKey: 'preview',
    labelKey: 'tripMode',
  });
  expect(mode?.href).toBe(`/trips/${TRIP}/mode?preview=1&date=2026-09-05&time=09%3A00`);
});

test('the planning overview has one planning route and keeps Preview parameters intact', () => {
  const overview = tripOverviewDestinations(TRIP, 'planning', START);

  expect(overview.primary.href).toBe(`/trips/${TRIP}/itinerary`);
  expect(overview.secondary.map((entry) => entry.href)).toStrictEqual([
    `/trips/${TRIP}/mode?preview=1&date=2026-09-05&time=09%3A00`,
    `/trips/${TRIP}/memories`,
  ]);
  expect(
    [overview.primary, ...overview.secondary].filter(
      (entry) => entry.href === `/trips/${TRIP}/itinerary`,
    ),
  ).toHaveLength(1);
});

test('every section can say its own name, including the ones no menu lists', () => {
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

  for (const section of sections) {
    expect(tripSectionLabelKey(section), `${section} has no label`).toBeTruthy();
  }

  // Places is in neither set, and it is exactly the screen that would otherwise be
  // left describing itself as "More".
  expect(tripSectionLabelKey('places')).toBe('places');
  expect(tripSectionLabelKey('info')).toBe('tripInfo');
});
