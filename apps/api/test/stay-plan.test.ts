import { describe, expect, test } from 'vitest';
import { dayStayUpdateSchema, replaceStayRange, stayPlanUpdateSchema } from '@trove/types';
import { resolveDayStay, type StayDay, type StayAccommodation } from '../src/services/day-stay.js';
import { groupAppliedStays } from '../src/services/stay-plan-rules.js';
import { validateStayRanges } from '../src/services/stay-plan.js';

const a = { id: 'a' },
  b = { id: 'b' },
  c = { id: 'c' };
const day: StayDay<typeof a> = {
  id: 'day',
  date: new Date('2026-10-15'),
  dailyBaseTripPlace: null,
  dailyBaseDepartureTripPlace: null,
};
const booking: StayAccommodation<typeof a> = {
  checkInDate: new Date('2026-10-14'),
  checkOutDate: new Date('2026-10-17'),
  tripPlace: b,
  linkedDayIds: [],
};
const plan = {
  defaultStayTripPlace: a,
  stayRanges: [
    { startDate: new Date('2026-10-15'), endDate: new Date('2026-10-16'), tripPlace: c },
  ],
};
const endpoints = (resolved: ReturnType<typeof resolveDayStay>) => [
  resolved.start?.place.id ?? null,
  resolved.end?.place.id ?? null,
];

describe('a single stay decision across surfaces', () => {
  test('ranges cover both inclusive boundary days and otherwise fall back to booking/default', () => {
    expect(endpoints(resolveDayStay(day, [], plan))).toEqual(['c', 'c']);
    expect(endpoints(resolveDayStay({ ...day, date: new Date('2026-10-16') }, [], plan))).toEqual([
      'c',
      'c',
    ]);
    expect(endpoints(resolveDayStay({ ...day, date: new Date('2026-10-18') }, [], plan))).toEqual([
      'a',
      'a',
    ]);
    expect(endpoints(resolveDayStay(day, [booking], { defaultStayTripPlace: a }))).toEqual([
      'b',
      'b',
    ]);
    expect(resolveDayStay(day, [], { defaultStayTripPlace: a }).start?.source).toBe('trip_default');
  });
  test('manual day values preserve legacy symmetry and take priority over ranges and bookings', () => {
    expect(endpoints(resolveDayStay({ ...day, dailyBaseTripPlace: a }, [booking], plan))).toEqual([
      'a',
      'a',
    ]);
    expect(
      endpoints(resolveDayStay({ ...day, dailyBaseDepartureTripPlace: a }, [booking], plan)),
    ).toEqual(['c', 'a']);
    expect(
      endpoints(
        resolveDayStay(
          { ...day, dailyBaseTripPlace: a, stayStartMode: 'PLACE', stayEndMode: 'INHERIT' },
          [booking],
          plan,
        ),
      ),
    ).toEqual(['a', 'c']);
  });
  test('no stay suppresses defaults, ranges, bookings and same-start returns independently', () => {
    expect(
      endpoints(
        resolveDayStay({ ...day, stayStartMode: 'NONE', stayEndMode: 'NONE' }, [booking], plan),
      ),
    ).toEqual([null, null]);
    expect(
      endpoints(
        resolveDayStay({ ...day, stayStartMode: 'NONE', stayEndMode: 'INHERIT' }, [], plan),
      ),
    ).toEqual([null, 'c']);
    expect(
      endpoints(
        resolveDayStay({ ...day, stayStartMode: 'NONE', stayEndMode: 'SAME_AS_START' }, [], plan),
      ),
    ).toEqual([null, null]);
  });
  test('automatic restores inference and adjacent full-day ranges do not invent transfers', () => {
    const adjacent = {
      stayRanges: [
        ...plan.stayRanges,
        { startDate: new Date('2026-10-17'), endDate: new Date('2026-10-18'), tripPlace: b },
      ],
    };
    expect(
      endpoints(
        resolveDayStay(
          {
            ...day,
            date: new Date('2026-10-17'),
            stayStartMode: 'INHERIT',
            stayEndMode: 'INHERIT',
          },
          [],
          adjacent,
        ),
      ),
    ).toEqual(['b', 'b']);
  });
  test('ambiguous bookings do not guess or quietly use the default', () => {
    expect(
      endpoints(
        resolveDayStay(day, [booking, { ...booking, tripPlace: c }], { defaultStayTripPlace: a }),
      ),
    ).toEqual([null, null]);
    expect(endpoints(resolveDayStay(day, [booking, { ...booking, tripPlace: c }], plan))).toEqual([
      'c',
      'c',
    ]);
  });
});

test('overlapping range replacement retains both fragments without mutating input', () => {
  const old = [{ startDate: '2026-10-01', endDate: '2026-10-10', tripPlaceId: 'a' }];
  expect(
    replaceStayRange(old, { startDate: '2026-10-04', endDate: '2026-10-06', tripPlaceId: 'b' }),
  ).toEqual([
    { startDate: '2026-10-01', endDate: '2026-10-03', tripPlaceId: 'a' },
    { startDate: '2026-10-04', endDate: '2026-10-06', tripPlaceId: 'b' },
    { startDate: '2026-10-07', endDate: '2026-10-10', tripPlaceId: 'a' },
  ]);
  expect(old[0]!.endDate).toBe('2026-10-10');
});

test('AI grouping preserves every resolved endpoint, including empty boundaries', () => {
  for (const days of [
    [
      { date: '2026-10-01', start: null, end: 'a' },
      { date: '2026-10-02', start: 'a', end: 'a' },
      { date: '2026-10-03', start: 'a', end: null },
    ],
    [
      { date: '2026-10-01', start: 'a', end: 'a' },
      { date: '2026-10-02', start: 'a', end: 'b' },
      { date: '2026-10-03', start: 'b', end: 'b' },
      { date: '2026-10-04', start: null, end: 'b' },
    ],
    [{ date: '2026-10-01', start: null, end: null }],
  ]) {
    const grouped = groupAppliedStays(days);
    for (const input of days) {
      const override = grouped.overrides.get(input.date)!;
      // Empty draft boundaries remain empty even if a default is added later.
      if (!input.start) expect(override.stayStartMode).toBe('NONE');
      if (!input.end) expect(override.stayEndMode).toBe('NONE');
      expect(
        endpoints(
          resolveDayStay(
            {
              ...day,
              date: new Date(input.date),
              ...override,
              dailyBaseTripPlace: override.dailyBaseTripPlaceId
                ? { id: override.dailyBaseTripPlaceId }
                : null,
              dailyBaseDepartureTripPlace: override.dailyBaseDepartureTripPlaceId
                ? { id: override.dailyBaseDepartureTripPlaceId }
                : null,
            },
            [],
            {
              defaultStayTripPlace: grouped.defaultTripPlaceId
                ? { id: grouped.defaultTripPlaceId }
                : null,
              stayRanges: grouped.ranges.map((r) => ({
                startDate: new Date(r.startDate),
                endDate: new Date(r.endDate),
                tripPlace: { id: r.tripPlaceId },
              })),
            },
          ),
        ),
      ).toEqual([input.start, input.end]);
    }
  }
});

test('contracts reject impossible dates, end-only start modes, overlapping and out-of-trip ranges', () => {
  expect(
    stayPlanUpdateSchema.safeParse({
      expectedRevision: 0,
      defaultTripPlaceId: null,
      ranges: [
        {
          startDate: '2026-02-30',
          endDate: '2026-03-01',
          tripPlaceId: '00000000-0000-4000-8000-000000000001',
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    dayStayUpdateSchema.safeParse({
      expectedRevision: 0,
      start: { mode: 'same_as_start' },
      end: { mode: 'none' },
    }).success,
  ).toBe(false);
  const input = {
    expectedRevision: 0,
    defaultTripPlaceId: null,
    ranges: [{ startDate: '2026-10-01', endDate: '2026-10-10', tripPlaceId: 'a' }],
  };
  expect(() => validateStayRanges(input, '2026-10-02', '2026-10-10')).toThrow();
  expect(() =>
    validateStayRanges(
      {
        ...input,
        ranges: [
          ...input.ranges,
          { startDate: '2026-10-10', endDate: '2026-10-11', tripPlaceId: 'b' },
        ],
      },
      '2026-10-01',
      '2026-10-12',
    ),
  ).toThrow();
});
