import { expect, test } from 'vitest';

import { reorderMoves } from '@/lib/itinerary/better-order';

/** What the server does with a move: take the item out, put it back at `position`. */
function apply(order: string[], moves: ReturnType<typeof reorderMoves>) {
  const working = [...order];
  for (const move of moves) {
    working.splice(working.indexOf(move.itemId), 1);
    working.splice(move.position, 0, move.itemId);
  }
  return working;
}

test('the moves turn the current order into the proposed one', () => {
  const current = ['c', 'a', 'd', 'b'];
  const proposed = ['a', 'b', 'c', 'd'];
  expect(apply(current, reorderMoves(current, proposed))).toStrictEqual(proposed);
});

test('items already in place are not moved', () => {
  expect(reorderMoves(['a', 'b', 'c'], ['a', 'b', 'c'])).toStrictEqual([]);
  expect(reorderMoves(['a', 'c', 'b'], ['a', 'b', 'c'])).toStrictEqual([
    { itemId: 'b', position: 1 },
  ]);
});
