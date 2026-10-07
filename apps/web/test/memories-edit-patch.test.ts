import { expect, test } from 'vitest';

import type { Memory } from '../lib/memories/api.ts';
import { memoryDraftFrom, memoryEditPatch, withDay } from '../lib/memories/edit-patch.ts';

const SHRINE = {
  id: 'trip-place-shrine',
  kind: 'provider' as const,
  name: null,
  placeId: 'place-shrine',
  providerRefs: [],
};

/** A seeded Memory: kept at a Place, with no itinerary stop. */
const SEEDED: Memory = {
  capturedAt: '2026-09-02T01:30:42.000Z',
  capturedLocalDate: '2026-09-02',
  capturedLocalTime: '10:30',
  createdAt: '2026-09-02T01:30:42.000Z',
  highlightPosition: null,
  id: 'memory-seeded',
  isHighlight: false,
  itineraryDay: { date: '2026-09-02', id: 'day-2' },
  itineraryItem: null,
  note: 'Gates up the mountain',
  photos: [],
  timeZone: 'Asia/Tokyo',
  timeZoneSource: 'trip_place',
  tripPlace: SHRINE,
  updatedAt: '2026-09-02T01:30:42.000Z',
};

const AT_A_STOP: Memory = {
  ...SEEDED,
  itineraryItem: { id: 'item-shrine', label: null },
};

test('an untouched draft sends nothing at all', () => {
  expect(memoryEditPatch(SEEDED, memoryDraftFrom(SEEDED))).toStrictEqual({});
  expect(memoryEditPatch(AT_A_STOP, memoryDraftFrom(AT_A_STOP))).toStrictEqual({});
});

test('editing only the note sends only the note, so the Place survives', () => {
  const draft = { ...memoryDraftFrom(SEEDED), note: '  Thousands of gates  ' };
  expect(memoryEditPatch(SEEDED, draft)).toStrictEqual({ note: 'Thousands of gates' });
  expect(memoryEditPatch(SEEDED, { ...draft, note: '   ' })).toStrictEqual({ note: null });
});

test('turning a Highlight on or off sends only that', () => {
  expect(memoryEditPatch(SEEDED, { ...memoryDraftFrom(SEEDED), isHighlight: true })).toStrictEqual({
    isHighlight: true,
  });
});

test('choosing a stop ties the Memory to it and to its Place', () => {
  const draft = {
    ...memoryDraftFrom(SEEDED),
    place: { itemId: 'item-market', kind: 'item' as const, tripPlaceId: 'trip-place-market' },
  };
  expect(memoryEditPatch(SEEDED, draft)).toStrictEqual({
    itineraryItemId: 'item-market',
    tripPlaceId: 'trip-place-market',
  });
});

test('clearing the Place clears the stop and the Place, and nothing else', () => {
  expect(
    memoryEditPatch(AT_A_STOP, { ...memoryDraftFrom(AT_A_STOP), place: { kind: 'none' } }),
  ).toStrictEqual({
    itineraryItemId: null,
    tripPlaceId: null,
  });
});

test('moving to another day moves the date, keeps the time and the Place, and lets the stop go', () => {
  const moved = withDay(memoryDraftFrom(AT_A_STOP), { date: '2026-09-03', id: 'day-3' });
  expect(memoryEditPatch(AT_A_STOP, moved)).toStrictEqual({
    capturedLocalDate: '2026-09-03',
    capturedLocalTime: '10:30',
    itineraryDayId: 'day-3',
    itineraryItemId: null,
  });
});

test('correcting only the time sends the date with it, as the pair the server reads', () => {
  expect(memoryEditPatch(SEEDED, { ...memoryDraftFrom(SEEDED), localTime: '11:15' })).toStrictEqual(
    {
      capturedLocalDate: '2026-09-02',
      capturedLocalTime: '11:15',
    },
  );
});
