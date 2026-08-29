import { expect, test } from 'vitest';

import { itineraryViewHref, resolveItineraryView } from '../lib/itinerary/view.ts';

const DAY_IDS = ['day-1', 'day-2'];

test('the plain itinerary route opens the full-trip overview', () => {
  expect(resolveItineraryView(null, DAY_IDS)).toStrictEqual({
    invalidRequestedDay: false,
    selectedDayId: null,
    view: 'overview',
  });
});

test('a valid day query opens focused day planning', () => {
  expect(resolveItineraryView('day-2', DAY_IDS)).toStrictEqual({
    invalidRequestedDay: false,
    selectedDayId: 'day-2',
    view: 'day',
  });
});

test('an invalid day query falls back to overview for URL cleanup', () => {
  expect(resolveItineraryView('missing', DAY_IDS)).toStrictEqual({
    invalidRequestedDay: true,
    selectedDayId: null,
    view: 'overview',
  });
  expect(resolveItineraryView('', DAY_IDS).invalidRequestedDay).toBe(true);
});

test('view hrefs preserve unrelated query parameters', () => {
  expect(itineraryViewHref('/trips/trip-1/itinerary', 'preview=1&day=old', null)).toBe(
    '/trips/trip-1/itinerary?preview=1',
  );
  expect(itineraryViewHref('/trips/trip-1/itinerary', 'preview=1', 'day-2')).toBe(
    '/trips/trip-1/itinerary?preview=1&day=day-2',
  );
});
