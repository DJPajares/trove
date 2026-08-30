import { describe, expect, it } from 'vitest';

import { googleMapsPlaceHref, type PlaceSnapshot } from '@/lib/saved/api';

function snapshot(overrides: Partial<PlaceSnapshot> = {}): PlaceSnapshot {
  return {
    address: '1 Chome-1-2 Oshiage, Sumida City, Tokyo, Japan',
    category: 'things_to_do',
    fetchedAt: '2026-08-01T00:00:00.000Z',
    googleMapsUri: null,
    languageCode: 'en',
    name: 'Tokyo Skytree',
    primaryType: 'tourist_attraction',
    rawTypes: ['tourist_attraction'],
    stale: false,
    utcOffsetMinutes: 540,
    ...overrides,
  };
}

const googleRef = { externalPlaceId: 'ChIJ35ov0dCOGGARKvdDH7NPHX0', provider: 'google' } as const;

describe('googleMapsPlaceHref', () => {
  it("prefers the provider's own canonical URL", () => {
    const href = googleMapsPlaceHref({
      providerRefs: [googleRef],
      snapshot: snapshot({ googleMapsUri: 'https://maps.google.com/?cid=9057936243611410224' }),
    });
    expect(href).toBe('https://maps.google.com/?cid=9057936243611410224');
  });

  it('searches the place name and pins it with the place id', () => {
    const href = googleMapsPlaceHref({ providerRefs: [googleRef], snapshot: snapshot() });
    const params = new URL(href!).searchParams;
    expect(params.get('query')).toBe('Tokyo Skytree');
    expect(params.get('query_place_id')).toBe(googleRef.externalPlaceId);
  });

  it('never builds a link that carries the place id alone', () => {
    // A bare `query_place_id` resolves to nothing and opens a blank map.
    const href = googleMapsPlaceHref({ providerRefs: [googleRef], snapshot: snapshot() });
    expect(new URL(href!).searchParams.get('query')).toBeTruthy();
  });

  it('falls back through the name, label and address a Place has in hand', () => {
    const href = googleMapsPlaceHref({
      name: null,
      providerAddress: '1 Chome-1-2 Oshiage, Tokyo',
      providerLabel: null,
      providerRefs: [googleRef],
      snapshot: null,
    });
    expect(new URL(href!).searchParams.get('query')).toBe('1 Chome-1-2 Oshiage, Tokyo');
  });

  it('still pins the listing when only coordinates are left to search for', () => {
    const href = googleMapsPlaceHref({
      location: { latitude: 35.7101, longitude: 139.8107 },
      providerRefs: [googleRef],
    });
    const params = new URL(href!).searchParams;
    expect(params.get('query')).toBe('35.7101,139.8107');
    expect(params.get('query_place_id')).toBe(googleRef.externalPlaceId);
  });

  it('hides the action for a custom Place with no provider reference', () => {
    expect(googleMapsPlaceHref({ name: 'Our picnic spot', providerRefs: [] })).toBeNull();
  });

  it('hides the action when nothing identifies the place to search for', () => {
    expect(googleMapsPlaceHref({ providerRefs: [googleRef] })).toBeNull();
  });
});
