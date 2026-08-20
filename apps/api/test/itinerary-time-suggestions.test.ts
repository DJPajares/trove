import { expect, test } from 'vitest';

import {
  DEFAULT_DAY_START_MINUTE,
  SUGGESTED_TIME_ROUNDING_MINUTES,
  suggestItemStart,
  type SuggestItemStartInput,
} from '../src/services/itinerary-time-suggestions-rules.js';
import type {
  PlanScoreDayItem,
  PlanScoreOpeningHours,
} from '../src/services/plan-score-factors.js';

function item(overrides: Partial<PlanScoreDayItem> & { id: string }): PlanScoreDayItem {
  return {
    duration: null,
    fixed: false,
    inboundTravel: null,
    openingHours: { status: 'UNKNOWN' },
    start: null,
    startWindow: null,
    ...overrides,
  };
}

function at(minutes: number): { minutes: number; source: 'USER_OWNED' } {
  return { minutes, source: 'USER_OWNED' };
}

function travel(minutes: number): { minutes: number; source: 'FRESH_PROVIDER' } {
  return { minutes, source: 'FRESH_PROVIDER' };
}

function open(...ranges: Array<[number, number]>): PlanScoreOpeningHours {
  return {
    intervals: ranges.map(([startMinute, endMinute]) => ({ endMinute, startMinute })),
    source: 'FRESH_PROVIDER',
    status: 'KNOWN',
  };
}

/** Google gave a full week and this weekday is not in it: the place is shut. */
const CLOSED_ALL_DAY: PlanScoreOpeningHours = {
  intervals: [],
  source: 'FRESH_PROVIDER',
  status: 'KNOWN',
};

function suggest(
  items: PlanScoreDayItem[],
  overrides: Partial<SuggestItemStartInput> = {},
): ReturnType<typeof suggestItemStart> {
  return suggestItemStart({
    commitments: [],
    dayStartMinute: DEFAULT_DAY_START_MINUTE,
    items,
    roundingMinutes: SUGGESTED_TIME_ROUNDING_MINUTES,
    targetItemId: 'target',
    ...overrides,
  });
}

const MORNING = { earliestMinute: 0, latestMinute: 720, source: 'ESTIMATED' } as const;
const EVENING = { earliestMinute: 1020, latestMinute: 1440, source: 'ESTIMATED' } as const;

test('anchors to when the place opens', () => {
  const result = suggest([
    item({ duration: at(60), id: 'target', openingHours: open([600, 1020]) }),
  ]);

  expect(result.status).toBe('ok');
  expect(result.status === 'ok' && result.startMinute).toBe(600);
  expect(result.status === 'ok' && result.reasons.map((reason) => reason.code)).toStrictEqual([
    'DAY_START',
    'OPENING_HOURS',
  ]);
});

test('follows the previous item once travel and duration are known', () => {
  const result = suggest([
    item({ duration: at(90), id: 'museum', start: at(540) }),
    item({
      duration: at(60),
      id: 'target',
      inboundTravel: travel(20),
      openingHours: open([0, 1440]),
    }),
  ]);

  // 09:00 + 90 min + 20 min travel = 10:50.
  expect(result.status === 'ok' && result.startMinute).toBe(650);
  expect(result.status === 'ok' && result.reasons.map((reason) => reason.code)).toStrictEqual([
    'DAY_START',
    'AFTER_PREVIOUS_ITEM',
  ]);
});

test('chains through an intermediate item with complete evidence', () => {
  const result = suggest([
    item({ duration: at(60), id: 'museum', start: at(540) }),
    item({ duration: at(30), id: 'cafe', inboundTravel: travel(10) }),
    item({ duration: at(60), id: 'target', inboundTravel: travel(15) }),
  ]);

  // 09:00 + 60 museum + 10 travel + 30 cafe + 15 travel = 10:55.
  expect(result.status === 'ok' && result.startMinute).toBe(655);
});

test('a broken travel chain degrades with a caveat instead of guessing across the gap', () => {
  const result = suggest([
    item({ duration: at(60), id: 'museum', start: at(540) }),
    // No inboundTravel: Trove cannot know when arrival happens.
    item({ duration: at(60), id: 'target', openingHours: open([600, 1020]) }),
  ]);

  expect(result.status).toBe('ok');
  expect(result.status === 'ok' && result.startMinute).toBe(600);
  expect(result.status === 'ok' && result.caveats).toStrictEqual(['TRAVEL_UNKNOWN']);
  expect(
    result.status === 'ok' &&
      result.reasons.some((reason) => reason.code === 'AFTER_PREVIOUS_ITEM'),
  ).toBe(false);
});

test('clamps to the daypart the traveller chose', () => {
  const result = suggest([
    item({
      duration: at(60),
      id: 'target',
      openingHours: open([0, 1440]),
      startWindow: EVENING,
    }),
  ]);

  expect(result.status === 'ok' && result.startMinute).toBe(1020);
  expect(
    result.status === 'ok' && result.reasons.some((reason) => reason.code === 'DAY_PART_WINDOW'),
  ).toBe(true);
});

test('rounding never lands the visit past a tight closing time', () => {
  // Opens 10:02, closes 11:00, visit is 55 min. Rounding 602 up to 605 leaves
  // only 55 minutes exactly, which still fits; a naive round would overshoot.
  const result = suggest([
    item({ duration: at(55), id: 'target', openingHours: open([602, 660]) }),
  ]);

  expect(result.status === 'ok' && result.startMinute).toBe(605);
  expect(result.status === 'ok' && result.startMinute + 55 <= 660).toBe(true);
});

test('rounding that no longer fits reports no feasible time rather than a bad one', () => {
  // Opens 10:02, closes 10:58, visit 55 min. Only 602-603 work, and both round
  // away to 605, which overshoots.
  const result = suggest([
    item({ duration: at(55), id: 'target', openingHours: open([602, 658]) }),
  ]);

  expect(result).toStrictEqual({ blockedBy: ['OPENING_HOURS'], status: 'no_feasible_time' });
});

test('a place shut all day blocks rather than passing as unknown', () => {
  const result = suggest([item({ duration: at(60), id: 'target', openingHours: CLOSED_ALL_DAY })]);

  expect(result).toStrictEqual({ blockedBy: ['OPENING_HOURS'], status: 'no_feasible_time' });
});

test('steps past a fixed commitment that occupies the slot', () => {
  const result = suggest(
    [item({ duration: at(60), id: 'target', openingHours: open([540, 1200]) })],
    { commitments: [{ endMinute: 700, id: 'ferry', source: 'USER_OWNED', startMinute: 540 }] },
  );

  expect(result.status === 'ok' && result.startMinute).toBe(700);
  expect(
    result.status === 'ok' &&
      result.reasons.find((reason) => reason.code === 'CLEARS_COMMITMENT')?.references,
  ).toStrictEqual(['ferry']);
});

test('steps past another item the traveller pinned in place', () => {
  // The tour holds 09:00-11:00 and the place opens at 10:00, so the first open
  // slot is inside the tour and has to give way to it.
  const result = suggest([
    item({ duration: at(120), fixed: true, id: 'tour', start: at(540) }),
    item({ duration: at(60), id: 'target', openingHours: open([600, 1200]) }),
  ]);

  expect(result.status === 'ok' && result.startMinute).toBe(660);
  expect(
    result.status === 'ok' &&
      result.reasons.find((reason) => reason.code === 'CLEARS_COMMITMENT')?.references,
  ).toStrictEqual(['tour']);
});

test('a start that merely abuts a pinned item is not displaced by it', () => {
  // 08:00-09:00 ends exactly as the tour begins. Nothing constrains the answer
  // beyond the day start, so Trove declines rather than dressing up its default.
  const result = suggest([
    item({ duration: at(120), fixed: true, id: 'tour', start: at(540) }),
    item({ duration: at(60), id: 'target', openingHours: open([0, 1440]) }),
  ]);

  expect(result.status).toBe('insufficient_evidence');
});

test('an unreachable following anchor blocks, since the earliest start is already too late', () => {
  const result = suggest([
    item({ duration: at(60), id: 'target', openingHours: open([600, 1200]) }),
    item({ fixed: true, id: 'dinner', inboundTravel: travel(30), start: at(620) }),
  ]);

  expect(result).toStrictEqual({ blockedBy: ['BEFORE_FIXED_ITEM'], status: 'no_feasible_time' });
});

test('a reachable following anchor is recorded as a reason, not a block', () => {
  const result = suggest([
    item({ duration: at(60), id: 'target', openingHours: open([600, 1200]) }),
    item({ fixed: true, id: 'dinner', inboundTravel: travel(30), start: at(1080) }),
  ]);

  expect(result.status === 'ok' && result.startMinute).toBe(600);
  expect(
    result.status === 'ok' &&
      result.reasons.find((reason) => reason.code === 'BEFORE_FIXED_ITEM')?.references,
  ).toStrictEqual(['dinner']);
});

test('a day with nothing to reason from admits it rather than proposing a default', () => {
  // Only the fallback day start applies. 08:00 here would be invention.
  const result = suggest([item({ id: 'target' })]);

  expect(result.status).toBe('insufficient_evidence');
});

test('an unknown duration qualifies the suggestion without blocking it', () => {
  const result = suggest([item({ id: 'target', openingHours: open([600, 1020]) })]);

  expect(result.status === 'ok' && result.startMinute).toBe(600);
  expect(result.status === 'ok' && result.caveats).toStrictEqual(['DURATION_UNKNOWN']);
});

test('unknown opening hours are reported but do not stop a suggestion', () => {
  const result = suggest([
    item({ duration: at(60), id: 'museum', start: at(540) }),
    item({ duration: at(60), id: 'target', inboundTravel: travel(30) }),
  ]);

  expect(result.status === 'ok' && result.startMinute).toBe(630);
  expect(result.status === 'ok' && result.caveats).toStrictEqual(['OPENING_HOURS_UNKNOWN']);
});

test('a missing target is insufficient evidence rather than a crash', () => {
  const result = suggest([item({ id: 'other' })], { targetItemId: 'nope' });

  expect(result.status).toBe('insufficient_evidence');
});

test('the same day always produces the same answer', () => {
  const build = () => [
    item({ duration: at(60), id: 'museum', start: at(540) }),
    item({
      duration: at(45),
      id: 'target',
      inboundTravel: travel(20),
      openingHours: open([540, 700], [780, 1020]),
      startWindow: MORNING,
    }),
  ];

  expect(suggest(build())).toStrictEqual(suggest(build()));
});

test('a daypart window excludes its own end, since noon is not morning', () => {
  // The only opening slot starts exactly when Morning ends. Half-open windows
  // mean that is already afternoon, so Morning has no workable placement.
  const result = suggest([
    item({
      duration: at(60),
      id: 'target',
      openingHours: open([720, 1020]),
      startWindow: MORNING,
    }),
  ]);

  expect(result.status).toBe('no_feasible_time');
});

test('the last minute inside a daypart window is still usable', () => {
  const result = suggest([
    item({
      duration: at(60),
      id: 'target',
      openingHours: open([715, 1020]),
      startWindow: MORNING,
    }),
  ]);

  expect(result.status === 'ok' && result.startMinute).toBe(715);
});

test('a window the day has already run past says so, rather than blaming opening hours', () => {
  // The previous stop ends mid-afternoon, so Morning is unreachable. Reporting
  // OPENING_HOURS here would send the traveller to check a schedule that is fine.
  const result = suggest([
    item({ duration: at(120), id: 'museum', start: at(840) }),
    item({
      duration: at(60),
      id: 'target',
      inboundTravel: travel(20),
      startWindow: MORNING,
    }),
  ]);

  expect(result).toStrictEqual({ blockedBy: ['DAY_PART_WINDOW'], status: 'no_feasible_time' });
});

test('a commitment that pushes the visit past closing blames the hours', () => {
  const result = suggest(
    [item({ duration: at(60), id: 'target', openingHours: open([540, 700]) })],
    { commitments: [{ endMinute: 690, id: 'ferry', source: 'USER_OWNED', startMinute: 540 }] },
  );

  expect(result).toStrictEqual({ blockedBy: ['OPENING_HOURS'], status: 'no_feasible_time' });
});
