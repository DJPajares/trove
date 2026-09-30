import { expect, test } from 'vitest';

import {
  planningMapLifecycle,
  retainWhileSuspended,
  tripModeMapLifecycle,
} from '@/lib/maps/map-retention';

const base = { desktopMapLayout: true, mobileView: 'list' as const };

test('on desktop the day view shows and builds the map', () => {
  expect(planningMapLifecycle({ ...base, activeView: 'day', mounted: false })).toStrictEqual({
    mount: true,
    renderDayView: true,
    visible: true,
  });
});

test('a built map survives a trip to Overview, hidden, and returns visible', () => {
  const away = planningMapLifecycle({ ...base, activeView: 'overview', mounted: true });
  expect(away).toStrictEqual({ mount: true, renderDayView: true, visible: false });

  const back = planningMapLifecycle({ ...base, activeView: 'day', mounted: true });
  expect(back.visible).toBe(true);
  expect(back.mount).toBe(true);
});

test('with no map ever built, Overview drops the day view as before', () => {
  expect(
    planningMapLifecycle({
      activeView: 'overview',
      desktopMapLayout: false,
      mobileView: 'list',
      mounted: false,
    }),
  ).toStrictEqual({ mount: false, renderDayView: false, visible: false });
});

test('a phone builds the map only when its Map tab is opened, and keeps it after', () => {
  const list = { activeView: 'day' as const, desktopMapLayout: false, mounted: false };
  expect(planningMapLifecycle({ ...list, mobileView: 'list' }).mount).toBe(false);
  expect(planningMapLifecycle({ ...list, mobileView: 'map' })).toStrictEqual({
    mount: true,
    renderDayView: true,
    visible: true,
  });

  const back = planningMapLifecycle({ ...list, mobileView: 'list', mounted: true });
  expect(back).toStrictEqual({ mount: true, renderDayView: true, visible: false });
});

test('the layout is not known yet: nothing is built on a guess', () => {
  expect(
    planningMapLifecycle({
      activeView: 'day',
      desktopMapLayout: null,
      mobileView: 'list',
      mounted: false,
    }).mount,
  ).toBe(false);
});

test('Trip Mode builds the map on the first visit and keeps it afterwards', () => {
  expect(tripModeMapLifecycle({ onMapView: false, visited: false })).toStrictEqual({
    active: false,
    render: false,
  });
  expect(tripModeMapLifecycle({ onMapView: true, visited: false })).toStrictEqual({
    active: true,
    render: true,
  });
  expect(tripModeMapLifecycle({ onMapView: false, visited: true })).toStrictEqual({
    active: false,
    render: true,
  });
});

test('a hidden map keeps working from what it last showed, even if the day empties', () => {
  const shown = { points: ['a', 'b'] };
  const emptied = { points: [] as string[] };

  expect(retainWhileSuspended(emptied, true, shown)).toBe(shown);
  expect(retainWhileSuspended(emptied, false, shown)).toBe(emptied);
});
