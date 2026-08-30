import { expect, test } from 'vitest';

import { itineraryViewHref, resolveItineraryView } from '../lib/itinerary/view.ts';

const DAY_IDS = ['day-1', 'day-2'];

test('the plain itinerary route opens the first day', () => {
  expect(resolveItineraryView(null, null, DAY_IDS)).toStrictEqual({
    invalidRequestedDay: false,
    selectedDayId: 'day-1',
    view: 'day',
  });
});

test('the full-trip overview is asked for by name', () => {
  expect(resolveItineraryView('overview', null, DAY_IDS)).toStrictEqual({
    invalidRequestedDay: false,
    selectedDayId: null,
    view: 'overview',
  });
  // A day left over from an earlier visit does not reopen it.
  expect(resolveItineraryView('overview', 'day-2', DAY_IDS).view).toBe('overview');
});

test('a valid day query opens focused day planning', () => {
  expect(resolveItineraryView(null, 'day-2', DAY_IDS)).toStrictEqual({
    invalidRequestedDay: false,
    selectedDayId: 'day-2',
    view: 'day',
  });
});

test('an invalid day query falls back to the first day for URL cleanup', () => {
  expect(resolveItineraryView(null, 'missing', DAY_IDS)).toStrictEqual({
    invalidRequestedDay: true,
    selectedDayId: 'day-1',
    view: 'day',
  });
  expect(resolveItineraryView(null, '', DAY_IDS).invalidRequestedDay).toBe(true);
});

test('a trip with no days has only the overview to open', () => {
  expect(resolveItineraryView(null, null, [])).toStrictEqual({
    invalidRequestedDay: false,
    selectedDayId: null,
    view: 'overview',
  });
  expect(resolveItineraryView(null, 'day-1', []).view).toBe('overview');
});

test('view hrefs preserve unrelated query parameters', () => {
  expect(itineraryViewHref('/trips/trip-1/itinerary', 'preview=1&day=old', null)).toBe(
    '/trips/trip-1/itinerary?preview=1&view=overview',
  );
  expect(itineraryViewHref('/trips/trip-1/itinerary', 'preview=1&view=overview', 'day-2')).toBe(
    '/trips/trip-1/itinerary?preview=1&day=day-2',
  );
});
