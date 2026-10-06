import { expect, test } from 'vitest';

import {
  describeHours,
  describeHoursParts,
  describeRating,
  describeRatingParts,
  formatNearbyDistance,
  nearestDistanceMeters,
  sortForDay,
} from '@/lib/trip-places/signals';

const t = (key: string, values?: Record<string, number | string>) =>
  values ? `${key}:${JSON.stringify(values)}` : key;
const asOf = '2026-09-28T00:00:00.000Z';

test('hours say when the place is open, that it is closed, or nothing at all', () => {
  const options = { hour12: false, locale: 'en', t };
  expect(describeHours(undefined, options)).toBeNull();
  expect(describeHours({ asOf, status: 'closed' }, options)).toMatch(/^closed · checked:/);
  expect(
    describeHours(
      { asOf, special: false, spans: [{ close: '17:00', open: '09:00' }], status: 'open' },
      options,
    ),
  ).toContain('openHours:{"times":"09:00 – 17:00"}');
  expect(
    describeHours(
      { asOf, special: true, spans: [{ close: '15:00', open: '10:00' }], status: 'open' },
      options,
    ),
  ).toContain('specialHours');
  expect(
    describeHours(
      { asOf, special: false, spans: [{ close: '24:00', open: '00:00' }], status: 'open' },
      options,
    ),
  ).toMatch(/^allDay · checked:/);
});

test('hours keep the date they were checked apart, so a row can set it quieter', () => {
  const options = { hour12: false, locale: 'en', t };
  expect(describeHoursParts(undefined, options)).toBeNull();
  expect(describeHoursParts({ asOf, status: 'closed' }, options)).toMatchObject({
    closed: true,
    label: 'closed',
  });
  const open = describeHoursParts(
    { asOf, special: false, spans: [{ close: '17:00', open: '09:00' }], status: 'open' },
    options,
  );
  expect(open).toMatchObject({ closed: false, label: 'openHours:{"times":"09:00 – 17:00"}' });
  expect(open?.checked).toMatch(/^checked:/);
});

test('a rating splits into its number, a compact count, and a sentence to read aloud', () => {
  expect(describeRatingParts(undefined, { locale: 'en', t })).toBeNull();
  expect(describeRatingParts({ reviewCount: null, value: 4.5 }, { locale: 'en', t })).toStrictEqual(
    { count: null, label: 'rating:{"rating":"4.5"}', value: '4.5' },
  );
  expect(
    describeRatingParts({ reviewCount: 12_000, value: 4.1 }, { locale: 'en', t }),
  ).toStrictEqual({
    count: '12K',
    label: 'ratingWithCount:{"count":"12K","rating":"4.1"}',
    value: '4.1',
  });
});

test('a rating names its count only when there is one', () => {
  expect(describeRating(undefined, { locale: 'en', t })).toBeNull();
  expect(describeRating({ reviewCount: null, value: 4.5 }, { locale: 'en', t })).toBe(
    'rating:{"rating":"4.5"}',
  );
  expect(describeRating({ reviewCount: 1200, value: 4.72 }, { locale: 'en', t })).toBe(
    'ratingWithCount:{"count":"1.2K","rating":"4.7"}',
  );
});

test('distance is to the closest stop of the day, and unknown without a location', () => {
  const stops = [
    { latitude: 35, longitude: 135 },
    { latitude: 35.1, longitude: 135 },
  ];
  expect(nearestDistanceMeters({ latitude: 35.101, longitude: 135 }, stops)).toBeLessThan(200);
  expect(nearestDistanceMeters(null, stops)).toBeNull();
  expect(nearestDistanceMeters({ latitude: 35, longitude: 135 }, [])).toBeNull();
});

test('short distances use the small unit, in the traveller’s own system', () => {
  expect(formatNearbyDistance(340, 'km', 'en')).toBe('340 m');
  expect(formatNearbyDistance(1250, 'km', 'en')).toBe('1.3 km');
  expect(formatNearbyDistance(20_000, 'km', 'en')).toBe('20 km');
  expect(formatNearbyDistance(1609, 'mi', 'en')).toBe('1 mi');
  expect(formatNearbyDistance(50, 'mi', 'en')).toMatch(/ft/);
});

test('nearest and open orderings put unknowns after what is known', () => {
  const places = [
    { distance: null, hours: null, name: 'C' },
    { distance: 900, hours: 'closed' as const, name: 'B' },
    { distance: 300, hours: 'open' as const, name: 'A' },
    { distance: 300, hours: 'open' as const, name: 'D' },
  ];
  const context = {
    distanceOf: (place: (typeof places)[number]) => place.distance,
    hoursOf: (place: (typeof places)[number]) => place.hours,
  };
  const names = (sort: 'nearest' | 'open') =>
    sortForDay(places, sort, (place) => place.name, context).map((place) => place.name);

  expect(names('nearest')).toStrictEqual(['A', 'D', 'B', 'C']);
  expect(names('open')).toStrictEqual(['A', 'D', 'C', 'B']);
});
