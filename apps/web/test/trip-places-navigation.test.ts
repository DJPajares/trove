import { expect, test } from 'vitest';

import {
  canReturnFromPlaces,
  tripPlacesDrawerHref,
  tripPlacesHref,
} from '../lib/trip-places/navigation';

test('search results and legacy bookmarks open Places over the trip hub', () => {
  expect(tripPlacesHref('trip')).toBe('/trips/trip?places=1');
});

test('drawer navigation preserves planner, preview and fragment context', () => {
  for (const href of [
    '/trips/trip/itinerary?day=day-2&view=day#stop',
    '/trips/trip/mode/trip?preview=1&date=2026-10-10&time=09%3A00',
  ]) {
    const open = tripPlacesDrawerHref(href, true);
    expect(new URL(open, 'https://trove.test').searchParams.get('places')).toBe('1');
    expect(tripPlacesDrawerHref(open, false)).toBe(href);
    expect(tripPlacesDrawerHref(open, true)).toBe(open);
  }
});

test('dismissal returns through history only for the matching underlying screen', () => {
  const state = { trovePlacesReturnHref: '/trips/trip/itinerary?day=day-2' };
  expect(canReturnFromPlaces(state, '/trips/trip/itinerary?day=day-2&places=1')).toBe(true);
  expect(canReturnFromPlaces(state, '/trips/trip/itinerary?day=day-3&places=1')).toBe(false);
  expect(canReturnFromPlaces(state, '/trips/trip?places=1')).toBe(false);
  expect(canReturnFromPlaces(null, '/trips/trip?places=1')).toBe(false);
  expect(canReturnFromPlaces({}, '/trips/trip?places=1')).toBe(false);
});
