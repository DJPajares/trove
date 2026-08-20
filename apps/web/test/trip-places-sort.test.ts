import { expect, test } from 'vitest';

import { sortTripPlaces } from '../lib/trip-places/sort.ts';

type SampleTripPlace = {
  createdAt: string;
  customName: string | null;
  id: string;
  priority: 'interested' | 'maybe' | 'must_go' | null;
  providerName: string;
};

const places: SampleTripPlace[] = [
  {
    createdAt: '2026-09-06T00:00:00.000Z',
    customName: null,
    id: 'zoo',
    priority: 'must_go',
    providerName: 'Zoo',
  },
  {
    createdAt: '2026-09-07T00:00:00.000Z',
    customName: 'Auckland walk',
    id: 'renamed',
    priority: 'interested',
    providerName: 'Harbour walk',
  },
  {
    createdAt: '2026-09-07T00:00:00.000Z',
    customName: null,
    id: 'beach',
    priority: 'maybe',
    providerName: 'Beach',
  },
  {
    createdAt: '2026-09-05T00:00:00.000Z',
    customName: null,
    id: 'museum',
    priority: null,
    providerName: 'Museum',
  },
];

const nameFor = (place: SampleTripPlace) => place.customName ?? place.providerName;

test('sorts Trip Places by their resolved name, including custom-name and provider fallbacks', () => {
  expect(sortTripPlaces(places, 'name', nameFor).map((place) => place.id)).toStrictEqual([
    'renamed',
    'beach',
    'museum',
    'zoo',
  ]);
});

test('sorts priority as Must Go, Interested, Maybe, and no priority with name tie-breaking', () => {
  expect(sortTripPlaces(places, 'priority', nameFor).map((place) => place.id)).toStrictEqual([
    'zoo',
    'renamed',
    'beach',
    'museum',
  ]);
});

test('sorts recently added first and uses the resolved name to break equal timestamps', () => {
  expect(sortTripPlaces(places, 'recent', nameFor).map((place) => place.id)).toStrictEqual([
    'renamed',
    'beach',
    'zoo',
    'museum',
  ]);
});
