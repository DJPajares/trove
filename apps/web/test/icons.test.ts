import { expect, test } from 'vitest';

import * as Icons from '../lib/icons.ts';

/**
 * The registry exists because glyphs drifted: Sparkles meant both Memories and AI,
 * and MapPinned meant trips, places and a daily base at once. One glyph per
 * concept is the whole contract, so a second concept reusing a glyph fails here.
 */
test('every concept in the icon registry has its own glyph', () => {
  const { tripSectionIcons, ...concepts } = Icons;
  const owners = new Map<unknown, string[]>();
  for (const [concept, glyph] of Object.entries(concepts)) {
    owners.set(glyph, [...(owners.get(glyph) ?? []), concept]);
  }

  const shared = [...owners.values()].filter((names) => names.length > 1);

  expect(shared).toStrictEqual([]);
  expect(tripSectionIcons).toBeDefined();
});

test('trip destinations reuse the registry rather than choosing their own glyphs', () => {
  expect(Icons.tripSectionIcons).toStrictEqual({
    expenses: Icons.Expenses,
    info: Icons.TripInfo,
    itinerary: Icons.Itinerary,
    memories: Icons.Memories,
    mode: Icons.TripMode,
    notes: Icons.Notes,
    places: Icons.Places,
    reservations: Icons.Reservations,
    tasks: Icons.Tasks,
  });
});
