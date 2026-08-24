import { expect, test } from 'vitest';

import { pexelsImageLoader } from '../lib/media/pexels-loader.ts';

const source =
  'https://images.pexels.com/photos/1/photo.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=350';

test('the requested width is asked of the provider, not of a local optimizer', () => {
  const resized = new URL(pexelsImageLoader({ src: source, width: 640 }));

  expect(resized.hostname).toBe('images.pexels.com');
  expect(resized.searchParams.get('w')).toBe('640');
  expect(resized.searchParams.get('auto')).toBe('compress');
  expect(resized.searchParams.get('cs')).toBe('tinysrgb');
});

test('a height or a density alongside the width is dropped', () => {
  const resized = new URL(pexelsImageLoader({ src: source, width: 1200 }));
  expect(resized.searchParams.has('h')).toBe(false);
  // Next already asks for the density it needs through the requested width.
  expect(resized.searchParams.has('dpr')).toBe(false);
});

test('an existing width is replaced rather than appended', () => {
  const resized = new URL(
    pexelsImageLoader({ src: 'https://images.pexels.com/photos/1/photo.jpeg?w=100', width: 320 }),
  );
  expect(resized.searchParams.getAll('w')).toStrictEqual(['320']);
});

/**
 * A dense display asks for a width no slot in the app can use, and the provider
 * would happily serve a near-original of a photograph that is decoration.
 */
test('a width past what any layout can use is capped', () => {
  const resized = new URL(pexelsImageLoader({ src: source, width: 3840 }));
  expect(resized.searchParams.get('w')).toBe('2048');
});

test('anything that is not a provider photograph passes through untouched', () => {
  const supabaseCover = 'https://project.supabase.co/storage/v1/object/cover.jpg';
  expect(pexelsImageLoader({ src: supabaseCover, width: 640 })).toBe(supabaseCover);
  expect(pexelsImageLoader({ src: '/local-asset.png', width: 640 })).toBe('/local-asset.png');
});
