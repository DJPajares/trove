import { expect, test } from 'vitest';

import { resolveItineraryItemPlaceName } from '../lib/trip-places/place-name.ts';

const fallback = 'No place';

function tripPlace({
  customName = null,
  kind = 'provider',
  name = null,
  providerLabel = null,
  snapshotName = null,
}: {
  customName?: string | null;
  kind?: 'custom' | 'provider';
  name?: string | null;
  providerLabel?: string | null;
  snapshotName?: string | null;
} = {}) {
  return {
    customName,
    place: {
      id: 'place-1',
      kind,
      name,
      providerAddress: null,
      providerLabel,
      snapshot: snapshotName
        ? {
            address: null,
            category: 'other' as const,
            fetchedAt: '2026-08-25T00:00:00.000Z',
            googleMapsUri: null,
            languageCode: 'en',
            name: snapshotName,
            primaryType: null,
            rawTypes: [],
            stale: false,
            utcOffsetMinutes: null,
          }
        : null,
    },
  };
}

test('Memory context preserves an itinerary item custom label', () => {
  expect(
    resolveItineraryItemPlaceName(
      { customLabel: 'Lunch by the harbour', tripPlace: tripPlace({ snapshotName: 'Cafe Ferry' }) },
      fallback,
    ),
  ).toBe('Lunch by the harbour');
});

test('Memory context prefers a traveller-renamed Trip Place', () => {
  expect(
    resolveItineraryItemPlaceName(
      {
        customLabel: null,
        tripPlace: tripPlace({ customName: "Mum's favourite", snapshotName: 'Cafe Ferry' }),
      },
      fallback,
    ),
  ).toBe("Mum's favourite");
});

test('Memory context names provider Places from their existing snapshots', () => {
  expect(
    resolveItineraryItemPlaceName(
      { customLabel: null, tripPlace: tripPlace({ snapshotName: 'Cafe Ferry' }) },
      fallback,
    ),
  ).toBe('Cafe Ferry');
});

test('Memory context falls back to an existing provider label without a snapshot', () => {
  expect(
    resolveItineraryItemPlaceName(
      { customLabel: null, tripPlace: tripPlace({ providerLabel: 'Harbour walk' }) },
      fallback,
    ),
  ).toBe('Harbour walk');
});

test('Memory context names custom Places from their own stored names', () => {
  expect(
    resolveItineraryItemPlaceName(
      { customLabel: null, tripPlace: tripPlace({ kind: 'custom', name: 'Our apartment' }) },
      fallback,
    ),
  ).toBe('Our apartment');
});

test('Memory context keeps No place for genuinely missing or unnamed context', () => {
  expect(resolveItineraryItemPlaceName({ customLabel: null, tripPlace: null }, fallback)).toBe(
    fallback,
  );
  expect(
    resolveItineraryItemPlaceName({ customLabel: null, tripPlace: tripPlace() }, fallback),
  ).toBe(fallback);
});
