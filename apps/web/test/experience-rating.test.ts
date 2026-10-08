import { expect, test } from 'vitest';

import {
  EXPERIENCE_RATING_VALUES,
  experienceRatingWord,
  nextExperienceRating,
} from '../lib/experience-rating.ts';

test('every rating from one to five has its own word', () => {
  expect(EXPERIENCE_RATING_VALUES.map((value) => experienceRatingWord(value))).toStrictEqual([
    '1',
    '2',
    '3',
    '4',
    '5',
  ]);
});

test('anything that is not a whole rating from one to five has no word', () => {
  for (const value of [null, undefined, 0, 6, -1, 2.5, Number.NaN]) {
    expect(experienceRatingWord(value), String(value)).toBeNull();
  }
});

test('choosing the value already given clears it; any other value replaces it', () => {
  expect(nextExperienceRating(null, 3)).toBe(3);
  expect(nextExperienceRating(3, 3)).toBeNull();
  expect(nextExperienceRating(3, 5)).toBe(5);
  expect(nextExperienceRating(5, 1)).toBe(1);
});
