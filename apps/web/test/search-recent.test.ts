import { expect, test } from 'vitest';

import { rememberSearch, splitMatch } from '@/lib/search/recent';

test('a search moves to the front once, and the list keeps its newest five', () => {
  expect(rememberSearch(['train', 'Sapa'], 'sapa')).toEqual(['sapa', 'train']);
  expect(rememberSearch(['a1', 'b2', 'c3', 'd4', 'e5'], 'f6')).toEqual([
    'f6',
    'a1',
    'b2',
    'c3',
    'd4',
  ]);
  expect(rememberSearch(['train'], ' x ')).toEqual(['train']);
});

test('the match is split out for emphasis, ignoring case', () => {
  expect(splitMatch('Dinner with a view in Sapa', 'sapa')).toEqual([
    'Dinner with a view in ',
    'Sapa',
    '',
  ]);
  expect(splitMatch('Night train', 'ramen')).toEqual(['Night train', '', '']);
});
