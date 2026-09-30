/**
 * The moves that turn a day's current order into a proposed one, one item at a
 * time, each to its final position. Applying them in this order leaves every
 * earlier position already settled, so no move disturbs one before it.
 * Items already where they belong are skipped.
 */
export function reorderMoves(current: readonly string[], proposed: readonly string[]) {
  const working = [...current];
  const moves: Array<{ itemId: string; position: number }> = [];
  proposed.forEach((itemId, position) => {
    const from = working.indexOf(itemId);
    if (from === -1 || from === position) return;
    working.splice(from, 1);
    working.splice(position, 0, itemId);
    moves.push({ itemId, position });
  });
  return moves;
}
