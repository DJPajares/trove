import { expect, test } from 'vitest';

import { carouselIndex, photographicDescription } from '../lib/media/editorial-carousel.ts';
import type { EditorialImageReference } from '../lib/media/editorial-images.ts';

const image = (altText: string | null): EditorialImageReference => ({
  altText,
  attribution: {
    photographerName: 'Ada Rivera',
    photographerUrl: 'https://provider.example/ada',
    providerName: 'pexels',
    providerPageUrl: 'https://provider.example/photo/1',
  },
  dominantColor: '#2f4858',
  externalPhotoId: '1',
  height: 800,
  sourceUrl: 'https://images.example/1/original.jpg',
  width: 1200,
});

test.each([
  { expected: 0, index: 1, total: 1 },
  { expected: 1, index: 1, total: 2 },
  { expected: 2, index: 8, total: 3 },
  { expected: 0, index: -1, total: 3 },
])('carousel navigation clamps $index within $total slides', ({ expected, index, total }) => {
  expect(carouselIndex(index, total)).toBe(expected);
});

test('photo descriptions are supplementary, trimmed, and optional', () => {
  expect(photographicDescription(image('  A tram — on a hill  '))).toBe('A tram - on a hill');
  expect(photographicDescription(image('   '))).toBeNull();
  expect(photographicDescription(image(null))).toBeNull();
});
