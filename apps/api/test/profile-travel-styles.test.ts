import { describe, expect, it } from 'vitest';

import { normalizeTravelStyles } from '../src/services/profile.js';

describe('normalizeTravelStyles', () => {
  it('trims, collapses spaces and drops empty tags', () => {
    expect(normalizeTravelStyles(['  Slow   traveller ', '', '   '])).toEqual(['Slow traveller']);
  });

  it('keeps the first of tags that differ only by case, in the traveller order', () => {
    expect(normalizeTravelStyles(['Food first', 'Hikes', 'food FIRST'])).toEqual([
      'Food first',
      'Hikes',
    ]);
  });
});
