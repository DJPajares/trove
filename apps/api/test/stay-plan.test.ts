import { describe, expect, test } from 'vitest';
import {
  dayStayUpdateSchema,
  replaceStayRange,
  stayPlanUpdateSchema,
  stayLeaveDate,
} from '@trove/types';
import { stayDayTimeZone } from '../src/services/stay-time-zone.js';
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
  test('day one has no invented previous stay, while explicit and booked starts remain known', () => {
    const firstDayPlan = { ...plan, startDate: day.date };
    expect(endpoints(resolveDayStay(day, [], firstDayPlan))).toEqual([null, 'c']);
    expect(
      endpoints(resolveDayStay(day, [], { startDate: day.date, defaultStayTripPlace: a })),
    ).toEqual([null, 'a']);
    expect(endpoints(resolveDayStay(day, [booking], firstDayPlan))).toEqual(['b', 'c']);
    expect(
      endpoints(resolveDayStay(day, [{ ...booking, checkInDate: day.date }], firstDayPlan)),
    ).toEqual([null, 'c']);
    expect(endpoints(resolveDayStay({ ...day, dailyBaseTripPlace: b }, [], firstDayPlan))).toEqual([
      'b',
      'b',
    ]);
    expect(
      endpoints(resolveDayStay({ ...day, date: new Date('2026-10-16') }, [], firstDayPlan)),
    ).toEqual(['c', 'a']);
  });
  test('arrival keeps the previous stay in the morning and departure starts at the new stay', () => {
    expect(endpoints(resolveDayStay(day, [], plan))).toEqual(['a', 'c']);
    expect(endpoints(resolveDayStay({ ...day, date: new Date('2026-10-16') }, [], plan))).toEqual([
      'c',
      'a',
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
    ).toEqual(['b', 'a']);
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
  test('adjacent stays automatically split the transition day without a day override', () => {
    const adjacent = {
      stayRanges: [
        ...plan.stayRanges,
        { startDate: new Date('2026-10-16'), endDate: new Date('2026-10-18'), tripPlace: b },
      ],
    };
    expect(
      endpoints(
        resolveDayStay(
          {
            ...day,
            date: new Date('2026-10-16'),
            stayStartMode: 'INHERIT',
            stayEndMode: 'INHERIT',
          },
          [],
          adjacent,
        ),
      ),
    ).toEqual(['c', 'b']);
  });
  test('ambiguous bookings do not guess or quietly use the default', () => {
    expect(
      endpoints(
        resolveDayStay(day, [booking, { ...booking, tripPlace: c }], { defaultStayTripPlace: a }),
      ),
    ).toEqual([null, null]);
    expect(endpoints(resolveDayStay(day, [booking, { ...booking, tripPlace: c }], plan))).toEqual([
      null,
      'c',
    ]);
  });
});

test('overlapping range replacement retains both fragments without mutating input', () => {
  const old = [{ startDate: '2026-10-01', endDate: '2026-10-10', tripPlaceId: 'a' }];
  expect(
    replaceStayRange(old, { startDate: '2026-10-04', endDate: '2026-10-06', tripPlaceId: 'b' }),
  ).toEqual([
    { startDate: '2026-10-01', endDate: '2026-10-04', tripPlaceId: 'a' },
    { startDate: '2026-10-04', endDate: '2026-10-06', tripPlaceId: 'b' },
    { startDate: '2026-10-06', endDate: '2026-10-10', tripPlaceId: 'a' },
  ]);
  expect(old[0]!.endDate).toBe('2026-10-10');
});

test('the Ritz-to-Marina example applies identically to a hotel and a friend’s home', () => {
  for (const next of [{ id: 'Marina Bay Sands' }, { id: 'Friend’s home' }]) {
    const stays = {
      defaultStayTripPlace: { id: 'Ritz-Carlton' },
      stayRanges: [
        { startDate: new Date('2026-10-19'), endDate: new Date('2026-10-20'), tripPlace: next },
      ],
    };
    expect(endpoints(resolveDayStay({ ...day, date: new Date('2026-10-19') }, [], stays))).toEqual([
      'Ritz-Carlton',
      next.id,
    ]);
    expect(endpoints(resolveDayStay({ ...day, date: new Date('2026-10-20') }, [], stays))).toEqual([
      next.id,
      'Ritz-Carlton',
    ]);
    expect(endpoints(resolveDayStay({ ...day, date: new Date('2026-10-21') }, [], stays))).toEqual([
      'Ritz-Carlton',
      'Ritz-Carlton',
    ]);
  }
  expect(
    endpoints(
      resolveDayStay({ ...day, date: new Date('2026-10-19') }, [], {
        stayRanges: [
          { startDate: new Date('2026-10-19'), endDate: new Date('2026-10-20'), tripPlace: b },
        ],
      }),
    ),
  ).toEqual([null, 'b']);
});

test('legacy single-day ranges remain a usable one-night stay', () => {
  expect(stayLeaveDate({ startDate: '2026-10-19', endDate: '2026-10-19' })).toBe('2026-10-20');
  const legacy = {
    stayRanges: [
      { startDate: new Date('2026-10-19'), endDate: new Date('2026-10-19'), tripPlace: b },
    ],
  };
  expect(endpoints(resolveDayStay({ ...day, date: new Date('2026-10-19') }, [], legacy))).toEqual([
    null,
    'b',
  ]);
  expect(endpoints(resolveDayStay({ ...day, date: new Date('2026-10-20') }, [], legacy))).toEqual([
    'b',
    null,
  ]);
});

test('adjacent ranges can leave on the last travel day, but never after it or on arrival', () => {
  const input = {
    expectedRevision: 0,
    defaultTripPlaceId: null,
    ranges: [
      { startDate: '2026-10-19', endDate: '2026-10-20', tripPlaceId: 'a' },
      { startDate: '2026-10-20', endDate: '2026-10-22', tripPlaceId: 'b' },
    ],
  };
  expect(validateStayRanges(input, '2026-10-18', '2026-10-22')).toHaveLength(2);
  expect(() => validateStayRanges(input, '2026-10-18', '2026-10-21')).toThrow('invalid_stay_plan');
  expect(() =>
    validateStayRanges(
      { ...input, ranges: [{ startDate: '2026-10-19', endDate: '2026-10-19', tripPlaceId: 'a' }] },
      '2026-10-18',
      '2026-10-21',
    ),
  ).toThrow('invalid_stay_plan');
});

test('current morning location determines the timezone, with item and trip fallbacks', () => {
  const places = [
    { id: 'a', place: { kind: 'CUSTOM' as const, customTimeZone: 'Asia/Singapore' } },
    { id: 'b', place: { kind: 'CUSTOM' as const, customTimeZone: 'Asia/Tokyo' } },
  ];
  expect(
    stayDayTimeZone({
      start: { place: a, source: 'trip_default' },
      places,
      items: [],
      tripTimeZone: 'UTC',
    }),
  ).toMatchObject({ timeZone: 'Asia/Singapore', sourceTripPlaceId: 'a' });
  expect(
    stayDayTimeZone({
      start: null,
      places,
      items: [{ id: 'stop', tripPlaceId: 'b' }],
      tripTimeZone: 'UTC',
    }),
  ).toMatchObject({ timeZone: 'Asia/Tokyo', source: 'FIRST_LOCATED_ITEM' });
  expect(stayDayTimeZone({ start: null, places, items: [], tripTimeZone: 'UTC' }).timeZone).toBe(
    'UTC',
  );
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
    expect(grouped.ranges.every((range) => range.endDate <= days.at(-1)!.date)).toBe(true);
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
              startDate: new Date(days[0]!.date),
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
          { startDate: '2026-10-09', endDate: '2026-10-11', tripPlaceId: 'b' },
        ],
      },
      '2026-10-01',
      '2026-10-12',
    ),
  ).toThrow();
});

test('main stays cover trip nights, with no invented final evening', () => {
  const bounded = {
    startDate: new Date('2026-10-14'),
    endDate: new Date('2026-10-17'),
    defaultStayTripPlace: a,
  };
  const final = { ...day, date: bounded.endDate };
  expect(endpoints(resolveDayStay(final, [], bounded))).toEqual(['a', null]);
  expect(
    endpoints(resolveDayStay({ ...final, stayEndMode: 'SAME_AS_START' }, [], bounded)),
  ).toEqual(['a', 'a']);
  expect(
    endpoints(
      resolveDayStay(final, [{ ...booking, checkOutDate: new Date('2026-10-18') }], bounded),
    ),
  ).toEqual(['b', 'b']);
});

test('linked dated bookings honor arrival, transfer and checkout boundaries', () => {
  const linked = { ...booking, linkedDayIds: ['day'] };
  const start = { ...day, date: linked.checkInDate! };
  const end = { ...day, date: linked.checkOutDate! };
  expect(endpoints(resolveDayStay(start, [linked]))).toEqual([null, 'b']);
  expect(endpoints(resolveDayStay(end, [linked]))).toEqual(['b', null]);
  expect(
    endpoints(
      resolveDayStay(end, [
        linked,
        { ...linked, tripPlace: c, checkInDate: end.date, checkOutDate: new Date('2026-10-19') },
      ]),
    ),
  ).toEqual(['b', 'c']);
  expect(
    endpoints(resolveDayStay(end, [{ ...linked, checkInDate: null, checkOutDate: null }])),
  ).toEqual(['b', 'b']);
});

test('a linked checkout can hand over to a dated booking without a day link', () => {
  const final = { ...day, date: booking.checkOutDate! };
  expect(
    endpoints(
      resolveDayStay(final, [
        { ...booking, linkedDayIds: ['day'] },
        { ...booking, tripPlace: c, checkInDate: final.date, checkOutDate: new Date('2026-10-19') },
      ]),
    ),
  ).toEqual(['b', 'c']);
});
