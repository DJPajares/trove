import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateFeasibility,
  evaluateTravelEffort,
  type PlanScoreFeasibilityItem,
  type PlanScoreMinutes,
  type PlanScoreOpeningHours,
  type PlanScoreRouteSegment,
} from '../src/services/plan-score-factors.js';
import { scoreDay, type PlanScoreEvidenceSource } from '../src/services/plan-score-rules.js';

function at(value: number, source: PlanScoreEvidenceSource = 'USER_OWNED'): PlanScoreMinutes {
  return { minutes: value, source };
}

function item(
  overrides: Partial<PlanScoreFeasibilityItem> & { id: string },
): PlanScoreFeasibilityItem {
  return {
    duration: null,
    fixed: false,
    inboundTravel: null,
    openingHours: { status: 'UNKNOWN' },
    start: null,
    ...overrides,
  };
}

function local(minutes: number | null, id = `segment-${minutes}`): PlanScoreRouteSegment {
  return minutes === null
    ? { id, scope: 'LOCAL', status: 'UNKNOWN' }
    : { duration: at(minutes, 'FRESH_PROVIDER'), id, scope: 'LOCAL', status: 'KNOWN' };
}

function feasibilityScore(input: Parameters<typeof evaluateFeasibility>[0]) {
  const { factor } = evaluateFeasibility(input);
  return factor.state === 'EVALUATED' ? factor.score : null;
}

test('detects overlapping fixed commitments as a hard conflict', () => {
  const result = evaluateFeasibility({
    commitments: [],
    items: [
      item({ duration: at(120), fixed: true, id: 'museum', start: at(600) }),
      item({ duration: at(60), fixed: true, id: 'lunch', start: at(660) }),
    ],
  });

  assert.deepEqual(result.conflicts, [
    {
      deduction: 50,
      id: 'overlap:lunch:museum',
      kind: 'OVERLAPPING_COMMITMENTS',
      severity: 'HARD',
      subjectIds: ['lunch', 'museum'],
    },
  ]);
  assert.equal(result.factor.state === 'EVALUATED' && result.factor.score, 50);
});

test('deducts an overlapping reservation pair once rather than once per direction', () => {
  const result = evaluateFeasibility({
    commitments: [
      { endMinute: 720, id: 'tour', source: 'USER_OWNED', startMinute: 600 },
      { endMinute: 780, id: 'ferry', source: 'USER_OWNED', startMinute: 660 },
    ],
    items: [],
  });

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.factor.state === 'EVALUATED' && result.factor.score, 50);
});

test('separates visits entirely and partially outside known opening hours', () => {
  const hours: PlanScoreOpeningHours = {
    intervals: [{ endMinute: 1020, startMinute: 540 }],
    source: 'FRESH_PROVIDER',
    status: 'KNOWN',
  };

  const outside = evaluateFeasibility({
    commitments: [],
    items: [item({ duration: at(60), id: 'gallery', openingHours: hours, start: at(1200) })],
  });
  const partial = evaluateFeasibility({
    commitments: [],
    items: [item({ duration: at(120), id: 'gallery', openingHours: hours, start: at(960) })],
  });

  assert.equal(outside.conflicts[0]?.severity, 'HARD');
  assert.equal(outside.factor.state === 'EVALUATED' && outside.factor.score, 50);
  assert.equal(partial.conflicts[0]?.severity, 'MATERIAL');
  assert.equal(partial.factor.state === 'EVALUATED' && partial.factor.score, 75);
});

const feasibleDayItems = (
  hoursSource: PlanScoreEvidenceSource | null,
): PlanScoreFeasibilityItem[] => {
  const openingHours: PlanScoreOpeningHours =
    hoursSource === null
      ? { status: 'UNKNOWN' }
      : {
          intervals: [{ endMinute: 1020, startMinute: 540 }],
          source: hoursSource,
          status: 'KNOWN',
        };

  return [
    item({ duration: at(60), id: 'park', openingHours, start: at(540) }),
    item({
      duration: at(60),
      id: 'market',
      inboundTravel: at(30, 'FRESH_PROVIDER'),
      openingHours,
      start: at(660),
    }),
  ];
};

test('lets stale or missing opening hours lower confidence without penalizing the score', () => {
  const fresh = scoreDay({
    dayId: 'day',
    factors: {
      FEASIBILITY: evaluateFeasibility({
        commitments: [],
        items: feasibleDayItems('FRESH_PROVIDER'),
      }).factor,
    },
  });
  const stale = scoreDay({
    dayId: 'day',
    factors: {
      FEASIBILITY: evaluateFeasibility({ commitments: [], items: feasibleDayItems('STALE') })
        .factor,
    },
  });
  const missing = evaluateFeasibility({ commitments: [], items: feasibleDayItems(null) });

  assert.deepEqual(fresh.factors.FEASIBILITY, { confidence: 100, score: 100, state: 'EVALUATED' });
  assert.deepEqual(stale.factors.FEASIBILITY, { confidence: 79, score: 100, state: 'EVALUATED' });
  assert.deepEqual(missing.conflicts, []);
  assert.equal(missing.factor.state === 'EVALUATED' && missing.factor.score, 100);
});

test('uses each evidence point once even when several rubric checks read it', () => {
  const { factor } = evaluateFeasibility({
    commitments: [],
    items: feasibleDayItems('FRESH_PROVIDER'),
  });
  const refs = factor.state === 'EVALUATED' ? factor.evidence.map((entry) => entry.ref) : [];

  assert.deepEqual(refs.toSorted(), [
    'duration:market',
    'duration:park',
    'hours:market',
    'hours:park',
    'start:market',
    'start:park',
    'travel:market',
  ]);
});

function lateArrivalDay(fixedStartMinute: number, fixed = true) {
  return {
    commitments: [],
    items: [
      item({ duration: at(60), id: 'park', start: at(540) }),
      item({
        fixed,
        id: 'tour',
        inboundTravel: at(60, 'FRESH_PROVIDER'),
        start: at(fixedStartMinute),
      }),
    ],
  };
}

test('grades arrival against a fixed start using the 50/25/10 deduction contract', () => {
  assert.equal(feasibilityScore(lateArrivalDay(620)), 50);
  assert.equal(feasibilityScore(lateArrivalDay(650)), 75);
  assert.equal(feasibilityScore(lateArrivalDay(670)), 90);
  assert.equal(feasibilityScore(lateArrivalDay(700)), 100);
});

test('counts one late transition once instead of also charging it as tight', () => {
  const result = evaluateFeasibility(lateArrivalDay(620));

  assert.deepEqual(result.conflicts, [
    {
      deduction: 50,
      id: 'transition:tour',
      kind: 'ARRIVES_AFTER_FIXED_START',
      severity: 'HARD',
      subjectIds: ['park', 'tour'],
    },
  ]);
});

test('leaves a negative buffer before a movable item to pace rather than feasibility', () => {
  assert.equal(feasibilityScore(lateArrivalDay(620, false)), 100);
});

test('keeps known evidence usable when another item has no time or location', () => {
  const result = evaluateFeasibility({
    commitments: [],
    items: [...lateArrivalDay(620).items, item({ id: 'unplanned' })],
  });

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.factor.state === 'EVALUATED' && result.factor.score, 50);
});

test('reports feasibility as unknown when the day has no usable evidence', () => {
  const result = evaluateFeasibility({ commitments: [], items: [item({ id: 'unplanned' })] });

  assert.deepEqual(result.factor, { reason: 'MISSING_EVIDENCE', state: 'UNKNOWN' });
  assert.deepEqual(result.conflicts, []);
});

test('scores travel effort with the five known route-time bands', () => {
  const score = (segments: PlanScoreRouteSegment[]) => {
    const { factor } = evaluateTravelEffort(segments);
    return factor.state === 'EVALUATED' ? factor.score : null;
  };

  assert.equal(score([local(45)]), 100);
  assert.equal(score([local(60)]), 100);
  assert.equal(score([local(61)]), 85);
  assert.equal(score([local(30, 'a'), local(30, 'b'), local(30, 'c')]), 85);
  assert.equal(score([local(150)]), 70);
  assert.equal(score([local(200)]), 50);
  assert.equal(score([local(300)]), 30);
});

test('treats incomplete local route coverage as unknown rather than zero or worst case', () => {
  const partial = evaluateTravelEffort([local(30, 'known'), local(null, 'unknown')]);
  const none = evaluateTravelEffort([]);

  assert.deepEqual(partial, {
    factor: { reason: 'INSUFFICIENT_EVIDENCE', state: 'UNKNOWN' },
    totalMinutes: null,
  });
  assert.deepEqual(none, {
    factor: { reason: 'MISSING_EVIDENCE', state: 'UNKNOWN' },
    totalMinutes: null,
  });
});

test('scores a zero-minute total only when every required local segment is known', () => {
  const result = evaluateTravelEffort([local(0, 'a'), local(0, 'b')]);

  assert.equal(result.totalMinutes, 0);
  assert.equal(result.factor.state === 'EVALUATED' && result.factor.score, 100);
});

test('evaluates structured long-distance journeys as logistics, not local travel effort', () => {
  const withJourney = evaluateTravelEffort([
    local(30),
    { duration: at(300, 'USER_OWNED'), id: 'flight', scope: 'LONG_DISTANCE', status: 'KNOWN' },
    { id: 'ferry', scope: 'LONG_DISTANCE', status: 'UNKNOWN' },
  ]);
  const journeyOnly = evaluateTravelEffort([
    { duration: at(300, 'USER_OWNED'), id: 'flight', scope: 'LONG_DISTANCE', status: 'KNOWN' },
  ]);

  assert.equal(withJourney.totalMinutes, 30);
  assert.equal(withJourney.factor.state === 'EVALUATED' && withJourney.factor.score, 100);
  assert.deepEqual(journeyOnly.factor, { reason: 'MISSING_EVIDENCE', state: 'UNKNOWN' });
});

test('feeds both factors into the day contract without changing the inputs', () => {
  const feasibilityInput = lateArrivalDay(620);
  const segments = [local(30, 'a'), local(60, 'b')];
  const snapshot = structuredClone({ feasibilityInput, segments });

  const result = scoreDay({
    dayId: 'day',
    factors: {
      FEASIBILITY: evaluateFeasibility(feasibilityInput).factor,
      TRAVEL_EFFORT: evaluateTravelEffort(segments).factor,
    },
  });

  assert.equal(result.score, 65);
  assert.equal(result.completeness, 67);
  assert.deepEqual({ feasibilityInput, segments }, snapshot);
});

test('rejects impossible minute values instead of scoring them', () => {
  assert.throws(() => evaluateTravelEffort([local(Number.NaN)]), /invalid_plan_score_minutes/);
  assert.throws(
    () =>
      evaluateFeasibility({
        commitments: [{ endMinute: 600, id: 'tour', source: 'USER_OWNED', startMinute: -1 }],
        items: [],
      }),
    /invalid_plan_score_minutes/,
  );
});
