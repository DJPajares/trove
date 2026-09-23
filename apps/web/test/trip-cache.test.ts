import { expect, test } from 'vitest';

import { createQueryClient } from '../lib/query/client.ts';
import { queryKeys } from '../lib/query/keys.ts';
import type { Trip } from '../lib/trips/api.ts';
import { cacheSavedTrip } from '../lib/trips/cache.ts';

test('a saved date edit updates the trip and reorders the Home and library list', () => {
  const client = createQueryClient();
  const earlier = {
    id: 'earlier',
    name: 'Earlier',
    startDate: '2026-10-02',
    endDate: '2026-10-06',
    createdAt: '2026-01-01T00:00:00.000Z',
  } as Trip;
  const later = {
    id: 'later',
    name: 'Later',
    startDate: '2026-10-10',
    endDate: '2026-10-12',
    createdAt: '2026-01-02T00:00:00.000Z',
  } as Trip;
  const saved = { ...earlier, startDate: '2026-10-15', endDate: '2026-10-19' };

  client.setQueryData(queryKeys.trip(earlier.id), { trip: earlier });
  client.setQueryData(queryKeys.trips(), { trips: [earlier, later] });

  cacheSavedTrip(client, saved);

  expect(client.getQueryData(queryKeys.trip(saved.id))).toEqual({ trip: saved });
  expect(client.getQueryData(queryKeys.trips())).toEqual({ trips: [later, saved] });
});

test('a saved trip does not invent an incomplete trip list', () => {
  const client = createQueryClient();
  const saved = { id: 'trip', startDate: '2026-10-15' } as Trip;

  cacheSavedTrip(client, saved);

  expect(client.getQueryData(queryKeys.trip(saved.id))).toEqual({ trip: saved });
  expect(client.getQueryData(queryKeys.trips())).toBeUndefined();
});
