import { expect, test } from 'vitest';

import { selectTripMemoryPreview } from '../src/services/trip-memory-preview.js';

function photo(id: string) {
  return { contentType: 'image/jpeg', id, path: `trip/${id}.jpg` };
}

function memory(...ids: string[]) {
  return { photos: ids.map(photo) };
}

test('a finished trip without a story cover shows its first memories in order', () => {
  expect(
    selectTripMemoryPreview(null, [memory('a'), memory('b'), memory('c'), memory('d')]).map(
      (entry) => entry.id,
    ),
  ).toStrictEqual(['a', 'b', 'c']);
});

test('the chosen story cover leads, ahead of every highlight', () => {
  expect(
    selectTripMemoryPreview(photo('cover'), [memory('a'), memory('b'), memory('c')]).map(
      (entry) => entry.id,
    ),
  ).toStrictEqual(['cover', 'a', 'b']);
});

test('a story cover that is also a memory is shown once', () => {
  expect(
    selectTripMemoryPreview(photo('a'), [memory('a', 'x'), memory('b'), memory('c')]).map(
      (entry) => entry.id,
    ),
  ).toStrictEqual(['a', 'b', 'c']);
});

test('each memory contributes only its first photograph', () => {
  expect(
    selectTripMemoryPreview(null, [memory('a', 'a2', 'a3'), memory('b')]).map((entry) => entry.id),
  ).toStrictEqual(['a', 'b']);
});

test('a trip with nothing photographed has no preview', () => {
  expect(selectTripMemoryPreview(null, [])).toStrictEqual([]);
  expect(selectTripMemoryPreview(null, [{ photos: [] }])).toStrictEqual([]);
});
