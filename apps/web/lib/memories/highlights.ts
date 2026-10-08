/**
 * Highlights keep an order of their own, curated by the traveller and distinct
 * from the chronological order the journal reads in. Moving one a step earlier
 * or later returns the whole new order, which is what the server takes; a move
 * past either end, or of a Memory that is not a Highlight, changes nothing.
 */
export function moveHighlightOrder(
  highlightIds: readonly string[],
  memoryId: string,
  direction: -1 | 1,
): string[] | null {
  const index = highlightIds.indexOf(memoryId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= highlightIds.length) return null;

  const reordered = [...highlightIds];
  reordered.splice(index, 1);
  reordered.splice(target, 0, memoryId);
  return reordered;
}
