import assert from 'node:assert/strict';
import { test } from 'vitest';

import { planReorderWrites } from '../src/services/itineraries.js';

/**
 * Replays the writes against the slots rows actually occupy, the way Postgres
 * sees them: one row per slot, checked on every statement rather than at commit.
 * Returns the final id-per-slot layout, or throws on the first collision.
 */
function applyWrites(
  startingPositions: Record<string, number>,
  writes: ReturnType<typeof planReorderWrites>,
) {
  const occupant = new Map<number, string>();
  for (const [id, position] of Object.entries(startingPositions)) occupant.set(position, id);

  for (const write of writes) {
    const held = occupant.get(write.position);
    if (held !== undefined && held !== write.id) {
      throw new Error(`position ${write.position} still held by ${held}, wanted by ${write.id}`);
    }
    for (const [position, id] of occupant) if (id === write.id) occupant.delete(position);
    occupant.set(write.position, write.id);
  }

  return [...occupant.entries()].sort(([a], [b]) => a - b).map(([position, id]) => [position, id]);
}

test('moving an item into the middle of a full day never writes onto an occupied slot', () => {
  // The reported case: five stops, the last one moved up one place. Writing the
  // moved row straight to slot 3 used to collide with the row still sitting there.
  const starting = { a: 0, b: 1, c: 2, d: 3, e: 4 };
  const writes = planReorderWrites(['a', 'b', 'c', 'e', 'd'], 5);

  assert.deepEqual(applyWrites(starting, writes), [
    [0, 'a'],
    [1, 'b'],
    [2, 'c'],
    [3, 'e'],
    [4, 'd'],
  ]);
});

test('every rotation of a day survives the same replay', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const starting = Object.fromEntries(ids.map((id, index) => [id, index]));

  for (let from = 0; from < ids.length; from += 1) {
    for (let to = 0; to < ids.length; to += 1) {
      const order = ids.filter((_, index) => index !== from);
      order.splice(to, 0, ids[from]!);
      assert.deepEqual(
        applyWrites(starting, planReorderWrites(order, ids.length)).map(([, id]) => id),
        order,
        `moving ${ids[from]} to ${to}`,
      );
    }
  }
});

test('parking clears the final range even when the day has no room above it', () => {
  // A day whose positions already sit at 0..n-1 leaves `above` equal to n, but a
  // day with gaps can report a lower ceiling; parking must still clear 0..n-1.
  const writes = planReorderWrites(['a', 'b', 'c'], 0);

  assert.ok(writes.slice(0, 3).every((write) => write.position >= 3));
  assert.deepEqual(
    applyWrites({ a: 0, b: 1, c: 2 }, writes).map(([, id]) => id),
    ['a', 'b', 'c'],
  );
});
