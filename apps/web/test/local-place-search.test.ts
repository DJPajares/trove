import { expect, test } from 'vitest';

import {
  knownExternalIds,
  matchLocalPlaces,
  providerResults,
  type LocalPlaceRecord,
} from '../lib/places/local-search.ts';
import type { ProviderSuggestion } from '../lib/saved/api.ts';

function place(
  id: string,
  name: string,
  category: 'stay' | 'things_to_do' = 'things_to_do',
): LocalPlaceRecord {
  return {
    id,
    kind: 'provider',
    name: null,
    providerAddress: `${name} street`,
    providerLabel: name,
    providerRefs: [{ externalPlaceId: `${id}-google` }],
    snapshot: { address: `${name} street, Tokyo`, category, name },
  };
}

const gracery = place('gracery', 'Hotel Gracery Shinjuku', 'stay');
const garden = place('garden', 'Shinjuku Gyoen', 'things_to_do');
const station = place('station', 'Shinjuku Station', 'things_to_do');
const ryokan = place('ryokan', 'Shinjuku Ryokan', 'stay');

test('nothing is matched before there is a query', () => {
  expect(matchLocalPlaces('  ', { trip: [{ place: garden }] }).total).toBe(0);
});

test('a place appears once, in the first group that knows it', () => {
  const groups = matchLocalPlaces('shinjuku', {
    known: [
      { place: gracery, tripName: null },
      { place: station, tripName: null },
    ],
    saved: [{ place: garden }, { place: station }],
    trip: [{ customName: null, place: garden }],
  });
  expect(groups.trip.map((entry) => entry.place.id)).toEqual(['garden']);
  expect(groups.saved.map((entry) => entry.place.id)).toEqual(['station']);
  expect(groups.known.map((entry) => entry.place.id)).toEqual(['gracery']);
  expect(groups.total).toBe(3);
});

test('the traveller’s own name for a place finds it, and so does the place’s name', () => {
  const trip = [{ customName: 'Our hotel', place: gracery }];
  expect(matchLocalPlaces('our hotel', { trip }).trip).toHaveLength(1);
  expect(matchLocalPlaces('gracery', { trip }).trip).toHaveLength(1);
  expect(
    matchLocalPlaces('tokyo hotel', { known: [{ place: gracery, tripName: 'Tokyo hotel' }] }).known,
  ).toHaveLength(1);
});

test('looking for a stay puts somewhere to sleep first', () => {
  const known = [station, gracery, garden, ryokan].map((entry) => ({
    place: entry,
    tripName: null,
  }));
  expect(
    matchLocalPlaces('shinjuku', { known }, { stay: true }).known.map((entry) => entry.place.id),
  ).toEqual(['gracery', 'ryokan', 'station', 'garden']);
});

test('google results leave out what Trove offered and lead with stays when asked', () => {
  const suggestion = (id: string, category: 'stay' | 'things_to_do'): ProviderSuggestion => ({
    category,
    description: null,
    externalPlaceId: id,
    name: id,
    provider: 'google',
  });
  const suggestions = [
    suggestion('gracery-google', 'stay'),
    suggestion('tower', 'things_to_do'),
    suggestion('inn', 'stay'),
  ];
  const known = knownExternalIds([{ place: gracery }]);
  expect(providerResults(suggestions, known).map((entry) => entry.externalPlaceId)).toEqual([
    'tower',
    'inn',
  ]);
  expect(
    providerResults(suggestions, known, { stay: true }).map((entry) => entry.externalPlaceId),
  ).toEqual(['inn', 'tower']);
});
