import { expect, test } from 'vitest';
import {
  scheduleItinerary,
  suggestScheduledTarget,
  type SchedulingInput,
  type SchedulingItem,
} from '../src/services/itinerary-scheduling-rules.js';
const minutes = (value: number) => ({ minutes: value, source: 'USER_OWNED' as const });
function stop(
  id: string,
  start: number | null = null,
  duration: number | null = 60,
  travel: number | null = 0,
  fixed = false,
): SchedulingItem {
  return {
    id,
    fixed,
    start: start === null ? null : minutes(start),
    duration: duration === null ? null : minutes(duration),
    inboundRequired: travel !== 0,
    inboundTravel: travel === null ? null : minutes(travel),
    openingHours: { status: 'UNKNOWN' },
    startWindow: null,
  };
}
function input(items: SchedulingItem[], targetIds: string[] = []): SchedulingInput {
  return {
    items,
    targetIds: new Set(targetIds),
    availability: { startMinute: 480, endMinute: 1200 },
    dayStartMinute: 480,
    dayEndMinute: 1440,
    commitments: [],
    returnTravel: { required: false, minutes: null },
  };
}
const start = (result: ReturnType<typeof scheduleItinerary>, id: string) =>
  result.slots.get(id)?.startMinute;
test('complete slot between anchors reserves both new legs and never shortens a visit', () => {
  const day = input(
    [stop('a', 540, 60, 0, true), stop('new', null, 90, 21), stop('b', 750, 60, 18, true)],
    ['new'],
  );
  const result = scheduleItinerary(day);
  expect(result.slots.get('new')).toMatchObject({
    startMinute: 625,
    endMinute: 715,
    durationMinutes: 90,
  });
  day.items[2]!.start = minutes(700);
  const noFit = scheduleItinerary(day);
  expect(noFit.slots.size).toBe(0);
  expect(noFit.issues).toContainEqual(expect.objectContaining({ itemId: 'new', code: 'NO_ROOM' }));
});
test('first insertion reserves travel out of the stay and last reserves return within availability', () => {
  const first = scheduleItinerary(
    input([stop('new', null, 60, 23), stop('booked', 600, 60, 12, true)], ['new']),
  );
  expect(start(first, 'new')).toBe(505);
  const lastDay = input([stop('booked', 1080, 60, 0, true), stop('new', null, 45, 10)], ['new']);
  lastDay.returnTravel = { required: true, minutes: 20 };
  expect(scheduleItinerary(lastDay).slots.size).toBe(0);
  lastDay.availability!.endMinute = 1220;
  expect(scheduleItinerary(lastDay).slots.get('new')).toMatchObject({
    startMinute: 1150,
    endMinute: 1195,
  });
});
test('split hours fit the entire duration in one interval; closed days remain conflicts', () => {
  const place = {
    ...stop('place', null, 90),
    openingHours: {
      status: 'KNOWN' as const,
      source: 'CACHED_PROVIDER' as const,
      intervals: [
        { startMinute: 540, endMinute: 600 },
        { startMinute: 840, endMinute: 1020 },
      ],
    },
  };
  expect(start(scheduleItinerary(input([place], ['place'])), 'place')).toBe(840);
  place.openingHours.intervals = [];
  expect(scheduleItinerary(input([place], ['place'])).issues[0]?.code).toBe('OPENING_HOURS');
});
test('preserves gaps and non-rounded workable times instead of packing the day', () => {
  const result = scheduleItinerary(
    input([stop('a', 553), stop('b', 900, 60, 20), stop('fixed', 1100, 60, 20, true)]),
  );
  expect(start(result, 'a')).toBe(553);
  expect(start(result, 'b')).toBe(900);
});
test('propagates only necessary changes through flexible stops, bounded by fixed anchors', () => {
  const result = scheduleItinerary(
    input(
      [
        stop('a', 540, 60, 0, true),
        stop('moved', 960, 60, 10),
        stop('b', 660, 60, 15),
        stop('c', 900, 60, 15),
        stop('fixed', 1080, 60, 15, true),
      ],
      ['moved'],
    ),
  );
  expect(start(result, 'moved')).toBe(610);
  expect(start(result, 'b')).toBe(685);
  expect(start(result, 'c')).toBe(900);
  expect(result.slots.has('fixed')).toBe(false);
});
test('failed blocks leave neighbors untouched; unknown duration or travel never creates precision', () => {
  for (const uncertain of [stop('new', null, null, 10), stop('new', null, 60, null)]) {
    const result = scheduleItinerary(
      input(
        [
          stop('a', 540, 60, 0, true),
          uncertain,
          stop('neighbor', 650, 60, 10),
          stop('fixed', 720, 60, 10, true),
        ],
        ['new'],
      ),
    );
    expect(result.slots.size).toBe(0);
    expect(result.issues.some((i) => i.severity === 'review')).toBe(true);
  }
});
test('retains daypart intent and five minute rounding', () => {
  const place = {
    ...stop('new', null, 90),
    startWindow: { earliestMinute: 722, latestMinute: 900, source: 'ESTIMATED' as const },
  };
  expect(start(scheduleItinerary(input([place], ['new'])), 'new')).toBe(725);
});
test('prefers slack but accepts a tighter feasible connection with a notice', () => {
  const result = scheduleItinerary(
    input([stop('new', null, 60, 0), stop('fixed', 550, 60, 5, true)], ['new']),
  );
  expect(start(result, 'new')).toBe(480);
  expect(result.issues).toContainEqual(
    expect.objectContaining({ code: 'TIGHT_TRANSITION', severity: 'notice' }),
  );
});
test('fixed commitments and protected history never receive automatic slots', () => {
  const day = input(
    [stop('first', 540, 60, 0, true), { ...stop('history', 550, 60, 5), protected: true }],
    ['history'],
  );
  expect(scheduleItinerary(day)).toMatchObject({
    slots: new Map(),
    issues: [expect.objectContaining({ code: 'FIXED_CONFLICT' })],
  });
});
test('fallback alone does not support a suggestion, but a following anchor does', () => {
  const day = input([stop('new')], ['new']);
  day.availability = null;
  expect(scheduleItinerary(day).issues[0]?.code).toBe('CONTEXT_UNKNOWN');
  day.items.push(stop('fixed', 600, 60, 0, true));
  expect(start(scheduleItinerary(day), 'new')).toBe(480);
});
test('reserves unknown return travel as review, and excludes a linked reservation from self-collision', () => {
  const day = input([stop('new', null, 60, 0)], ['new']);
  day.returnTravel = { required: true, minutes: null };
  expect(scheduleItinerary(day).issues[0]?.code).toBe('TRAVEL_UNKNOWN');
  day.returnTravel.required = false;
  day.commitments = [
    { id: 'booking', itemId: 'new', startMinute: 480, endMinute: 540, source: 'USER_OWNED' },
  ];
  expect(start(scheduleItinerary(day), 'new')).toBe(480);
});

test('a retimed predecessor is checked against the anchor using its resolved slot', () => {
  const result = scheduleItinerary(
    input([stop('moved', 1000, 60, 0), stop('fixed', 700, 60, 10, true)], ['moved']),
  );
  expect(start(result, 'moved')).toBe(480);
  expect(result.issues).toEqual([]);
});
test('fixed arrivals must respect availability and unknown inbound travel', () => {
  const result = scheduleItinerary(input([stop('fixed', 460, 60, null, true)]));
  expect(result.issues.map((issue) => issue.code)).toEqual(['TRAVEL_UNKNOWN', 'FIXED_CONFLICT']);
  expect(result.slots.size).toBe(0);
});

test('an explicit move can adjust flexible dayparts without crossing fixed anchors or hours', () => {
  const day = input(
    [
      {
        ...stop('evening', null, 90),
        startWindow: { earliestMinute: 1020, latestMinute: 1440, source: 'ESTIMATED' as const },
      },
      {
        ...stop('afternoon', null, 120, 12),
        startWindow: { earliestMinute: 720, latestMinute: 1020, source: 'ESTIMATED' as const },
      },
      stop('booking', 1020, 60, 14, true),
    ],
    ['evening'],
  );
  day.items[0]!.openingHours = {
    status: 'KNOWN',
    source: 'CACHED_PROVIDER',
    intervals: [{ startMinute: 480, endMinute: 1080 }],
  };
  expect(scheduleItinerary(day).slots.size).toBe(0);
  day.allowDayPartAdjustment = true;
  const result = scheduleItinerary(day);
  expect(start(result, 'evening')).toBe(480);
  expect(start(result, 'afternoon')).toBe(720);
  expect(result.slots.has('booking')).toBe(false);
  expect(result.issues).toEqual([]);
});

test('an impossible move has one conflict on the moved stop and does not accuse the next anchor', () => {
  const day = input(
    [
      stop('before', 540, 60, 0, true),
      stop('moved', 1000, 120, 10),
      stop('neighbor', 650, 60, 10),
      stop('booking', 720, 60, 10, true),
    ],
    ['moved'],
  );
  day.allowDayPartAdjustment = true;
  const result = scheduleItinerary(day);
  expect(result.slots.size).toBe(0);
  expect(result.issues).toEqual([
    { itemId: 'moved', code: 'NO_ROOM', severity: 'conflict', references: ['booking', 'neighbor'] },
  ]);
});

test('uncertain connections report a single review without fabricating a fit', () => {
  const result = scheduleItinerary(
    input(
      [stop('moved', 900, 60, null), stop('neighbor', 1000), stop('booking', 1100, 60, 0, true)],
      ['moved'],
    ),
  );
  expect(result.slots.size).toBe(0);
  expect(result.issues).toHaveLength(1);
  expect(result.issues[0]).toMatchObject({
    itemId: 'moved',
    code: 'TRAVEL_UNKNOWN',
    severity: 'review',
  });
});

test('reassessment retains a moved exact slot when it still fits its new neighbors', () => {
  const result = scheduleItinerary(
    input([stop('moved', 540), stop('neighbor', 800, 60, 15)], ['moved']),
  );
  expect(start(result, 'moved')).toBe(540);
  expect(start(result, 'neighbor')).toBe(800);
  expect(result.issues).toEqual([]);
});

test('dependent suggestions keep prior starts, durations, known hours and return travel as constraints', () => {
  const day = input(
    [
      stop('previous', 600, 120, 0, false),
      stop('shelf', 720, 240, 5, false),
      stop('photo', 960, 30, 5, true),
    ],
    ['shelf'],
  );
  const proposed = suggestScheduledTarget(day, 'shelf');
  expect(proposed.slots.get('shelf')).toMatchObject({
    startMinute: 725,
    endMinute: 965,
    durationMinutes: 240,
  });
  expect(proposed.slots.get('photo')).toMatchObject({
    startMinute: 970,
    endMinute: 1000,
    durationMinutes: 30,
  });
  expect(proposed.slots.has('previous')).toBe(false);
  day.items[2]!.openingHours = {
    status: 'KNOWN',
    source: 'CACHED_PROVIDER',
    intervals: [{ startMinute: 900, endMinute: 990 }],
  };
  expect(suggestScheduledTarget(day, 'shelf').slots.has('shelf')).toBe(false);
  day.items[2]!.openingHours = { status: 'UNKNOWN' };
  day.returnTravel = { required: true, minutes: 30 };
  day.availability!.endMinute = 1020;
  expect(suggestScheduledTarget(day, 'shelf').slots.has('shelf')).toBe(false);
});
