import { expect, test } from 'vitest';

import type { ItineraryItem } from '../lib/itinerary/api.ts';
import { itemLabel, resolveTripNextUp } from '../lib/trips/next-up.ts';

const googlePlace = (
  place: { name?: string | null; providerLabel?: string | null; snapshotName?: string | null },
  customName: string | null = null,
) => ({
  customName,
  place: {
    id: 'place',
    kind: 'provider' as const,
    name: place.name ?? null,
    providerAddress: null,
    providerLabel: place.providerLabel ?? null,
    snapshot: place.snapshotName ? { name: place.snapshotName } : null,
  },
});

const stop = (fields: Record<string, unknown>) =>
  ({
    customLabel: null,
    customLocation: null,
    id: 'stop',
    tripPlace: null,
    ...fields,
  }) as never as ItineraryItem;

test('an untitled stop at a Google place is named after the place', () => {
  // A provider place has no `name` of its own; its name lives in the snapshot.
  expect(itemLabel(stop({ tripPlace: googlePlace({ snapshotName: 'My Khe Beach' }) }))).toBe(
    'My Khe Beach',
  );
  // Before snapshots existed, the label captured when it was added still names it.
  expect(itemLabel(stop({ tripPlace: googlePlace({ providerLabel: 'Hoi An Spa' }) }))).toBe(
    'Hoi An Spa',
  );
});

test("the traveller's own words win over the provider's", () => {
  const place = googlePlace({ snapshotName: 'Hoi An Spa' }, 'Pedicure place');
  expect(itemLabel(stop({ tripPlace: place }))).toBe('Pedicure place');
  expect(itemLabel(stop({ customLabel: 'Pedicure', tripPlace: place }))).toBe('Pedicure');
  expect(itemLabel(stop({ customLabel: '  ', tripPlace: place }))).toBe('Pedicure place');
});

test('a stop with no title and no place still has nothing to be called', () => {
  expect(itemLabel(stop({}))).toBeNull();
  expect(itemLabel(stop({ tripPlace: googlePlace({}) }))).toBeNull();
  // So the next-up line keeps hiding rather than showing an empty name.
  expect(
    resolveTripNextUp({
      currentOrRelevant: null,
      day: { items: [stop({})] },
      nextItemId: 'stop',
      state: 'ok',
    } as never),
  ).toBeNull();
});
