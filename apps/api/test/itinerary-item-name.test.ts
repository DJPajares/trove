import { expect, test } from 'vitest';

import {
  resolveCanonicalPlaceName,
  resolveItineraryItemName,
} from '../src/services/place-serializer.js';

/**
 * The shape a serialized stop arrives in. `place.name` is the traveller's own
 * custom name for the Place, which is null for every provider-backed one - the
 * detail the notification builder used to miss.
 */
function stop(
  overrides: {
    customLabel?: string | null;
    customLocation?: { label: string } | null;
    tripPlace?: {
      customName?: string | null;
      place: {
        name: string | null;
        providerLabel?: string | null;
        snapshot?: { name?: string | null } | null;
      };
    } | null;
  } = {},
) {
  return { customLabel: null, customLocation: null, tripPlace: null, ...overrides };
}

test('a Google-backed stop is named by its snapshot, not left nameless', () => {
  // The regression. A provider Place carries no `name` of its own, so a chain
  // that stopped there returned null and the caller fell back to the trip's
  // title - which is how a push notification read "Leave for <trip> in <trip>".
  const name = resolveItineraryItemName(
    stop({
      tripPlace: {
        customName: null,
        place: {
          name: null,
          providerLabel: 'Hobbiton Movie Set',
          snapshot: { name: 'Hobbiton™ Movie Set Tours' },
        },
      },
    }),
  );

  expect(name).toBe('Hobbiton™ Movie Set Tours');
});

test('the traveller’s own words win over every provider name', () => {
  expect(
    resolveItineraryItemName(
      stop({
        customLabel: 'Breakfast before the drive',
        tripPlace: {
          customName: 'The good bakery',
          place: { name: null, snapshot: { name: 'Wildflour Bakery' } },
        },
      }),
    ),
  ).toBe('Breakfast before the drive');

  // Failing a label of their own, the name they gave the Trip Place.
  expect(
    resolveItineraryItemName(
      stop({
        tripPlace: {
          customName: 'The good bakery',
          place: { name: null, snapshot: { name: 'Wildflour Bakery' } },
        },
      }),
    ),
  ).toBe('The good bakery');
});

test('a stop with no Place falls back to its custom location, then to nothing', () => {
  expect(resolveItineraryItemName(stop({ customLocation: { label: 'The car park' } }))).toBe(
    'The car park',
  );
  // Null rather than a guess: the caller decides what a nameless stop is called,
  // and for a notification that is the trip it belongs to.
  expect(resolveItineraryItemName(stop())).toBeNull();
});

test('a Place falls back through snapshot to provider label', () => {
  expect(resolveCanonicalPlaceName({ name: 'My spot', snapshot: { name: 'Cafe' } })).toBe(
    'My spot',
  );
  expect(resolveCanonicalPlaceName({ name: null, snapshot: { name: 'Cafe' } })).toBe('Cafe');
  expect(resolveCanonicalPlaceName({ name: null, providerLabel: 'Cafe (label)' })).toBe(
    'Cafe (label)',
  );
  expect(resolveCanonicalPlaceName({ name: null })).toBeNull();
});
