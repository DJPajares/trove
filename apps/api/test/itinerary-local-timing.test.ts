import { expect, test } from 'vitest';
import { resolvePlannedItemTiming } from '../src/services/itinerary-local-timing.js';
import { floatingLocalTimeToInstant, parseLocalTime } from '../src/services/itinerary-rules.js';

const context = {
  date: '2026-09-10',
  dayTimeZone: 'Pacific/Auckland',
  placeTimeZone: 'Pacific/Auckland',
};
const stop = () => ({
  localStartTime: parseLocalTime('12:05'),
  startInstant: floatingLocalTimeToInstant('2026-09-10', '12:05', 'Asia/Singapore'),
  timeZone: 'Asia/Singapore',
  timeZoneSource: 'DAY_DEFAULT',
  timeSemantics: 'FLOATING_LOCAL',
  travelStatus: 'UPCOMING',
  durationMinutes: 210,
});
test('a located floating plan keeps its clock and duration, and corrects the derived instant', () => {
  const original = stop();
  const resolved = resolvePlannedItemTiming(original, context);
  expect(resolved).toMatchObject({
    localStartTime: parseLocalTime('12:05'),
    durationMinutes: 210,
    timeZone: 'Pacific/Auckland',
    timeZoneSource: 'PLACE',
    startInstant: new Date('2026-09-10T00:05:00Z'),
  });
  expect(original.timeZone).toBe('Asia/Singapore');
  expect(resolvePlannedItemTiming(resolved, context)).toBe(resolved);
});
test('a stale derived instant cannot override a floating clock even when the zone label is correct', () => {
  const item = { ...stop(), timeZone: 'Pacific/Auckland', timeZoneSource: 'PLACE' };
  expect(resolvePlannedItemTiming(item, context).startInstant).toEqual(
    new Date('2026-09-10T00:05:00Z'),
  );
});
test.each([
  { timeZoneSource: 'EXPLICIT' },
  { customLocationTimeZone: 'Asia/Singapore' },
  { timeSemantics: 'AUTHORITATIVE_INSTANT' },
  { travelStatus: 'COMPLETED' },
  { travelStatus: 'SKIPPED' },
  { reservationCount: 1 },
  { _count: { reservations: 1 } },
])('explicit or protected timing stays stable: %j', (protection) => {
  const item = { ...stop(), ...protection };
  expect(resolvePlannedItemTiming(item, context)).toBe(item);
});
test('an unavailable place keeps a persisted zone and never follows the device', () => {
  const original = stop();
  expect(resolvePlannedItemTiming(original, { ...context, placeTimeZone: null })).toBe(original);
  const unresolved = { ...stop(), timeZone: null, timeZoneSource: null };
  expect(resolvePlannedItemTiming(unresolved, { ...context, placeTimeZone: null }).timeZone).toBe(
    'Pacific/Auckland',
  );
});
test('a DST gap remains unresolved instead of fabricating a valid instant', () => {
  const item = { ...stop(), localStartTime: parseLocalTime('02:30') };
  expect(
    resolvePlannedItemTiming(item, { ...context, date: '2026-09-27' }).startInstant,
  ).toBeNull();
});
