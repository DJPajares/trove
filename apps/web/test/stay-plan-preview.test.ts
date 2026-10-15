import { expect, test } from 'vitest';
import { previewStayEndpoints } from '../lib/itinerary/stay-plan';
import type { ItineraryDay } from '../lib/itinerary/api';

const plan = {
  defaultTripPlaceId: 'ritz',
  revision: 1,
  ranges: [{ tripPlaceId: 'marina', startDate: '2026-10-19', endDate: '2026-10-20' }],
};
const day = (date: string, extra: Partial<ItineraryDay> = {}) =>
  ({
    date,
    dailyBaseTripPlaceId: null,
    dailyBaseDepartureTripPlaceId: null,
    stayStartMode: 'INHERIT',
    stayEndMode: 'INHERIT',
    ...extra,
  }) as ItineraryDay;

test('the screenshot example previews a Ritz-to-Marina arrival and a Marina departure morning', () => {
  expect(previewStayEndpoints(day('2026-10-19'), plan)).toEqual({ start: 'ritz', end: 'marina' });
  expect(previewStayEndpoints(day('2026-10-20'), plan)).toEqual({ start: 'marina', end: 'ritz' });
  const home = { ...plan, ranges: plan.ranges.map((r) => ({ ...r, tripPlaceId: 'friends-home' })) };
  expect(previewStayEndpoints(day('2026-10-19'), home)).toEqual({
    start: 'ritz',
    end: 'friends-home',
  });
});

test('previews preserve independent day overrides, no stay, bookings and ambiguous fallbacks', () => {
  expect(
    previewStayEndpoints(
      day('2026-10-19', {
        stayStartMode: 'NONE',
        stayEndMode: 'PLACE',
        dailyBaseDepartureTripPlaceId: 'family-home',
      }),
      plan,
    ),
  ).toEqual({ start: null, end: 'family-home' });
  expect(
    previewStayEndpoints(
      day('2026-10-19', {
        stayFallback: {
          startTripPlaceId: 'booking',
          startSource: 'accommodation',
          endTripPlaceId: null,
          endSource: null,
        },
      }),
      plan,
    ),
  ).toEqual({ start: 'booking', end: 'marina' });
  expect(
    previewStayEndpoints(
      day('2026-10-19', {
        stayFallback: {
          startTripPlaceId: null,
          startSource: null,
          endTripPlaceId: null,
          endSource: null,
        },
      }),
      plan,
    ),
  ).toEqual({ start: null, end: 'marina' });
  expect(
    previewStayEndpoints(
      day('2026-10-18', {
        stayFallback: {
          startTripPlaceId: 'old-default',
          startSource: 'trip_default',
          endTripPlaceId: 'old-default',
          endSource: 'trip_default',
        },
      }),
      plan,
    ),
  ).toEqual({ start: 'ritz', end: 'ritz' });
});
