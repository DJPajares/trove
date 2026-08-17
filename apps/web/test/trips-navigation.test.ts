import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  primaryTripDestinations,
  supportingTripDestinations,
  tripSectionLabelKey,
  type TripSection,
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
    assert.deepEqual(
      primaryTripDestinations(TRIP, lifecycle, START).map((entry) => entry.section),
      ['itinerary', 'mode', 'memories'],
      `order changed for ${lifecycle}`,
    );
  }
});

test('emphasis follows the stage the traveller is actually in', () => {
  assert.deepEqual(shape('planning'), [
    { emphasis: 'leading', label: 'itinerary', section: 'itinerary' },
    { emphasis: 'standard', label: 'preview', section: 'mode' },
    { emphasis: 'quiet', label: 'memories', section: 'memories' },
  ]);
  assert.deepEqual(shape('active'), [
    { emphasis: 'standard', label: 'itinerary', section: 'itinerary' },
    { emphasis: 'leading', label: 'tripMode', section: 'mode' },
    { emphasis: 'quiet', label: 'memories', section: 'memories' },
  ]);
  assert.deepEqual(shape('completed'), [
    { emphasis: 'standard', label: 'itinerary', section: 'itinerary' },
    { emphasis: 'quiet', label: 'tripMode', section: 'mode' },
    { emphasis: 'leading', label: 'memories', section: 'memories' },
  ]);
});

test('every destination is reachable at every stage, none are hidden', () => {
  for (const lifecycle of ['planning', 'active', 'completed'] as const) {
    const destinations = primaryTripDestinations(TRIP, lifecycle, START);
    assert.equal(destinations.length, 3);
    assert.ok(destinations.every((entry) => entry.href.startsWith(`/trips/${TRIP}/`)));
  }
});

test('Trip Mode opens as a rehearsal before departure and directly afterwards', () => {
  const planning = primaryTripDestinations(TRIP, 'planning', START)[1];
  assert.equal(planning?.href, `/trips/${TRIP}/mode?preview=1&date=2026-09-05&time=09%3A00`);

  for (const lifecycle of ['active', 'completed'] as const) {
    assert.equal(
      primaryTripDestinations(TRIP, lifecycle, START)[1]?.href,
      `/trips/${TRIP}/mode`,
      `${lifecycle} should not open Preview`,
    );
  }
});

test('supporting tools stay complete and out of the primary set', () => {
  const supporting = supportingTripDestinations(TRIP);

  assert.deepEqual(
    supporting.map((entry) => entry.section),
    ['tasks', 'reservations', 'expenses', 'info'],
  );
  assert.deepEqual(
    supporting.map((entry) => entry.href),
    [
      `/trips/${TRIP}/tasks`,
      `/trips/${TRIP}/reservations`,
      `/trips/${TRIP}/expenses`,
      `/trips/${TRIP}/info`,
    ],
  );
  // The itinerary opens Places itself, so listing it here would be a second door.
  assert.ok(supporting.every((entry) => entry.section !== 'places'));
  // Trip Info's route and its label have never matched; the mapping must survive.
  assert.equal(supporting.at(-1)?.labelKey, 'tripInfo');
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
    assert.ok(tripSectionLabelKey(section), `${section} has no label`);
  }

  // Places is in neither set, and it is exactly the screen that would otherwise be
  // left describing itself as "More".
  assert.equal(tripSectionLabelKey('places'), 'places');
  assert.equal(tripSectionLabelKey('info'), 'tripInfo');
});
