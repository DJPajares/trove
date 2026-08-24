import { expect, test } from 'vitest';

import {
  LANDING_IMAGES_RESOLVED_AT,
  landingHeroImage,
  landingLiveItImage,
} from '../lib/media/landing-images.ts';

const pinnedImages = { landingHeroImage, landingLiveItImage };

for (const [name, reference] of Object.entries(pinnedImages)) {
  test(`${name} is a fully-attributed editorial reference`, () => {
    expect(reference.attribution.photographerName).not.toBe('');
    expect(reference.attribution.photographerUrl).toMatch(/^https:\/\//);
    expect(reference.attribution.providerName).toBe('pexels');
    expect(reference.attribution.providerPageUrl).toMatch(/^https:\/\//);
  });

  test(`${name} reserves intrinsic dimensions and a loading placeholder`, () => {
    expect(reference.width).toBeGreaterThan(0);
    expect(reference.height).toBeGreaterThan(0);
    expect(reference.dominantColor).toMatch(/^#/);
  });

  test(`${name} stores one unsized source URL from the Pexels CDN`, () => {
    expect(reference.sourceUrl).toMatch(/^https:\/\/images\.pexels\.com\//);
    expect(new URL(reference.sourceUrl).searchParams.has('w')).toBe(false);
  });

  test(`${name} keeps the provider identifier needed for stable collection keys`, () => {
    expect(reference.externalPhotoId).not.toBe('');
  });
}

test('the pinned set records when it was last resolved', () => {
  expect(LANDING_IMAGES_RESOLVED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(Number.isNaN(Date.parse(LANDING_IMAGES_RESOLVED_AT))).toBe(false);
});
