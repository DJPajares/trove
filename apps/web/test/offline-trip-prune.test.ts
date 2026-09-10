import { expect, test } from 'vitest';

import { orphanedTripIds, tripsSafeToPrune } from '../lib/offline/trip-store.ts';

test('a trip missing from the authoritative list is an orphan', () => {
  expect(orphanedTripIds(['japan', 'peru', 'iceland'], ['japan', 'iceland'])).toEqual(['peru']);
});

test('a list that still holds every offline trip prunes nothing', () => {
  expect(orphanedTripIds(['japan', 'peru'], ['peru', 'japan'])).toEqual([]);
});

test('an offline trip the server has never listed is still an orphan', () => {
  // A trip created on another device and deleted before this one ever saw it.
  expect(orphanedTripIds(['ghost'], [])).toEqual(['ghost']);
});

test('an empty offline store has nothing to prune', () => {
  expect(orphanedTripIds([], ['japan'])).toEqual([]);
});

test('unsynced work outranks a stale copy', () => {
  const pruned = tripsSafeToPrune([
    { hasPendingMutations: false, tripId: 'peru' },
    { hasPendingMutations: true, tripId: 'iceland' },
  ]);

  // Iceland survives: the list may simply predate the queued edits, and losing
  // them is worse than keeping a copy of a trip that is probably gone.
  expect(pruned).toEqual(['peru']);
});

test('every orphan carrying queued work is kept', () => {
  expect(tripsSafeToPrune([{ hasPendingMutations: true, tripId: 'iceland' }])).toEqual([]);
});
