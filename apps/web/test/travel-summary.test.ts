import { describe, expect, it } from 'vitest';

import { summarizeTravels } from '@/lib/profile/travel-summary';
import type { Trip } from '@/lib/trips/api';

function trip(overrides: Partial<Trip>): Trip {
  return {
    archivedAt: null,
    countries: [],
    destinations: [],
    endDate: '2025-01-05',
    experienceRating: null,
    id: 'trip',
    lifecycle: 'completed',
    memoryPhotos: [],
    name: 'Trip',
    startDate: '2025-01-01',
    ...overrides,
  } as Trip;
}

const destination = (placeId: string, location: { latitude: number; longitude: number } | null) =>
  ({
    id: placeId,
    location,
    name: placeId,
    placeId,
    position: 0,
    timeZone: null,
  }) as Trip['destinations'][number];

describe('summarizeTravels', () => {
  it('counts only completed, unarchived trips', () => {
    const summary = summarizeTravels([
      trip({ id: 'done' }),
      trip({ id: 'planning', lifecycle: 'planning' }),
      trip({ id: 'active', lifecycle: 'active' }),
      trip({ archivedAt: '2025-02-01T00:00:00Z', id: 'archived' }),
    ]);

    expect(summary.completed.map(({ id }) => id)).toEqual(['done']);
  });

  it('stamps each country once, with the year first visited and the trips there', () => {
    const summary = summarizeTravels([
      trip({ countries: ['JP'], endDate: '2026-04-05', id: 'b', startDate: '2026-04-01' }),
      trip({ countries: ['JP', 'KR'], endDate: '2024-10-05', id: 'a', startDate: '2024-10-01' }),
      trip({ countries: ['ZZ'], id: 'c' }),
    ]);

    expect(summary.countries).toEqual([
      { code: 'JP', firstYear: 2024, trips: 2 },
      { code: 'KR', firstYear: 2024, trips: 1 },
    ]);
  });

  it('adds up days away and finds the first year', () => {
    const summary = summarizeTravels([
      trip({ endDate: '2026-04-03', id: 'b', startDate: '2026-04-01' }),
      trip({ endDate: '2019-06-10', id: 'a', startDate: '2019-06-01' }),
    ]);

    expect(summary.daysAway).toBe(13);
    expect(summary.firstYear).toBe(2019);
  });

  it('counts each destination once and maps only those with coordinates', () => {
    const summary = summarizeTravels([
      trip({ destinations: [destination('kyoto', { latitude: 35, longitude: 135.7 })], id: 'a' }),
      trip({
        destinations: [
          destination('kyoto', { latitude: 35, longitude: 135.7 }),
          destination('nara', null),
        ],
        id: 'b',
      }),
    ]);

    expect(summary.cities).toBe(2);
    expect(summary.places.map(({ key }) => key)).toEqual(['kyoto']);
  });

  it("lights a trip's countries when none of its destinations has coordinates", () => {
    const summary = summarizeTravels([
      trip({ countries: ['JP'], destinations: [destination('tokyo', null)], id: 'a' }),
      trip({
        countries: ['TH'],
        destinations: [destination('bangkok', { latitude: 13.7, longitude: 100.5 })],
        endDate: '2025-02-05',
        id: 'b',
        startDate: '2025-02-01',
      }),
    ]);

    expect(summary.places.map(({ key }) => key)).toEqual(['country:JP', 'bangkok']);
  });

  it('takes favourites from highly rated trips that have Memory photos, best first', () => {
    const photo = [{ contentType: 'image/jpeg', id: 'p', url: 'https://example.test/p.jpg' }];
    const summary = summarizeTravels([
      trip({ endDate: '2025-03-01', experienceRating: 4, id: 'four', memoryPhotos: photo }),
      trip({ endDate: '2025-02-01', experienceRating: 5, id: 'five', memoryPhotos: photo }),
      trip({ experienceRating: 5, id: 'no-photos' }),
      trip({ experienceRating: 3, id: 'three', memoryPhotos: photo }),
    ]);

    expect(summary.favourites.map(({ id }) => id)).toEqual(['five', 'four']);
  });
});
