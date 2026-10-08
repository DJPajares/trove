import { expect, test } from 'vitest';

import { momentLean, printTilts, selectPhotoLayout } from '../lib/memories/photo-layout.ts';

test('returns null for a Memory with no photos', () => {
  expect(selectPhotoLayout('memory-1', 0)).toBeNull();
});

test('is a pure function of id and count: same inputs, same template', () => {
  for (const count of [1, 2, 3, 4, 5, 8]) {
    const first = selectPhotoLayout('memory-stable', count);
    const second = selectPhotoLayout('memory-stable', count);
    expect(second).toStrictEqual(first);
  }
});

test('a single photo always resolves a single-frame template', () => {
  for (const id of ['a', 'b', 'c', 'd']) {
    expect(selectPhotoLayout(id, 1)?.kind).toBe('single');
  }
});

test('exactly two photos always resolve a pair template', () => {
  for (const id of ['a', 'b', 'c', 'd']) {
    expect(selectPhotoLayout(id, 2)?.kind).toBe('pair');
  }
});

test('three or more photos always resolve a spread template', () => {
  for (const count of [3, 4, 5, 8]) {
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(selectPhotoLayout(id, count)?.kind).toBe('spread');
    }
  }
});

test('different Memory ids within the same count vary the chosen template', () => {
  for (const count of [1, 2, 3]) {
    const ids = Array.from({ length: 12 }, (_, index) => `memory-${count}-${index}`);
    const templateIds = new Set(ids.map((id) => selectPhotoLayout(id, count)?.id));
    expect(templateIds.size).toBeGreaterThan(1);
  }
});

test('prints lean between half a degree and two, neighbours always opposite, the same every time', () => {
  for (const id of ['memory-a', 'memory-b', 'memory-c', 'memory-long-id-123']) {
    const tilts = printTilts(id, 6);
    expect(printTilts(id, 6)).toStrictEqual(tilts);
    for (const [index, tilt] of tilts.entries()) {
      expect(Math.abs(tilt)).toBeGreaterThanOrEqual(0.5);
      expect(Math.abs(tilt)).toBeLessThanOrEqual(2);
      const next = tilts[index + 1];
      if (next !== undefined) expect(Math.sign(next)).toBe(-Math.sign(tilt));
    }
  }
  expect(printTilts('memory-a', 0)).toStrictEqual([]);
});

test('moments lean to alternate sides in reading order', () => {
  expect([0, 1, 2, 3].map(momentLean)).toStrictEqual(['start', 'end', 'start', 'end']);
});
