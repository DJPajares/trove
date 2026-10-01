import { expect, test } from 'vitest';
import type { PlanScoreDayItem } from '../src/services/plan-score-factors.js';
import {
  evaluateScoredDay,
  type ScoredDayInput,
  type ScoringPlace,
  type ScoringRouteSegment,
} from '../src/services/plan-score-evaluation.js';
import { scoreDay } from '../src/services/plan-score-rules.js';
import { buildPlanScoreFromEvaluations } from '../src/services/plan-score.js';

/**
 * Rubric 11: detail only the traveller can add - a stop's location, time or
 * duration - scores low instead of standing aside, while provider gaps stay
 * neutral. These fixtures pin how strongly.
 */
const at = (minutes: number) => ({ minutes, source: 'USER_OWNED' as const });
const routed = (minutes: number) => ({ minutes, source: 'CACHED_PROVIDER' as const });
const hours = {
  status: 'KNOWN' as const,
  source: 'CACHED_PROVIDER' as const,
  intervals: [{ startMinute: 480, endMinute: 1260 }],
};
const place = (id: string, index: number, types = ['museum']): ScoringPlace => ({
  tripPlaceId: id,
  linked: true,
  coordinates: { latitude: 1.3, longitude: 103.8 + index * 0.01 },
  types,
  rating: { status: 'KNOWN', rating: 4.6, reviewCount: 900, source: 'CACHED_PROVIDER' },
  source: 'CACHED_PROVIDER',
});
const item = (id: string, extra: Partial<PlanScoreDayItem> = {}): PlanScoreDayItem => ({
  id,
  blockType: 'activity',
  fixed: false,
  start: null,
  duration: null,
  startWindow: null,
  inboundTravel: null,
  openingHours: { status: 'UNKNOWN' },
  ...extra,
});
const leg = (from: string, to: string, minutes: number | null): ScoringRouteSegment =>
  minutes === null
    ? { id: `${from}-${to}`, scope: 'LOCAL', status: 'UNKNOWN', itemIds: [from, to] }
    : {
        id: `${from}-${to}`,
        scope: 'LOCAL',
        status: 'KNOWN',
        duration: routed(minutes),
        mode: 'transit',
        itemIds: [from, to],
      };
const evaluate = (input: Partial<ScoredDayInput>) =>
  evaluateScoredDay({
    dayId: 'day',
    date: '2026-10-01',
    commitments: [],
    items: [],
    places: [],
    segments: [],
    preferences: { pace: 'balanced', interests: [], unmatchedInterests: [] },
    ...input,
  });
const score = (input: Partial<ScoredDayInput>) => scoreDay(evaluate(input).input).score;

const ids = ['anchor', 's1', 's2', 's3'];
const kinds = (index: number) => (index % 2 ? ['park'] : ['museum']);
/** Every stop linked, timed, measured and routed. */
const detailed = (): Partial<ScoredDayInput> => ({
  items: ids.map((id, index) =>
    item(id, {
      placeId: id,
      fixed: index === 0,
      start: at(540 + index * 150),
      duration: at(90),
      inboundTravel: index ? routed(20) : null,
      openingHours: hours,
    }),
  ),
  places: ids.map((id, index) => place(id, index, kinds(index))),
  segments: ids.slice(1).map((id, index) => leg(ids[index]!, id, 20)),
});
const anchor = () =>
  item('anchor', {
    placeId: 'anchor',
    fixed: true,
    start: at(540),
    duration: at(90),
    openingHours: hours,
  });
/** One timed, linked anchor; every other stop a bare label with no time or length. */
const reference = (): Partial<ScoredDayInput> => ({
  items: [anchor(), ...ids.slice(1).map((id) => item(id))],
  places: [place('anchor', 0)],
  segments: ids.slice(1).map((id, index) => leg(ids[index]!, id, null)),
});

test('a fully detailed day keeps its score and asks for nothing', () => {
  const evaluated = evaluate(detailed());
  expect(scoreDay(evaluated.input).score).toBe(100);
  expect(evaluated.detailNudges).toEqual([]);
});

test('a day of unlocated, untimed stops lands in the low 80s, never a perfect score', () => {
  const evaluated = evaluate(reference());
  const result = scoreDay(evaluated.input);
  expect(result.score).toBeGreaterThanOrEqual(80);
  expect(result.score).toBeLessThanOrEqual(84);
  expect(result.factors.ROUTE_EFFICIENCY).toMatchObject({ state: 'EVALUATED' });
  expect(evaluated.detailNudges).toMatchObject([
    {
      code: 'STOPS_NOT_LOCATED',
      action: 'LINK_PLACE',
      references: ['s1', 's2', 's3'],
      values: { count: 3 },
    },
    {
      code: 'STOPS_WITHOUT_TIMING',
      action: 'ADD_TIMING',
      references: ['s1', 's2', 's3'],
      values: { count: 3 },
    },
  ]);
});

test('each kind of detail is worth adding on its own', () => {
  const timedUnlocated = score({
    ...reference(),
    items: [
      anchor(),
      ...ids
        .slice(1)
        .map((id, index) =>
          item(id, { fixed: true, start: at(690 + index * 150), duration: at(90) }),
        ),
    ],
  });
  const locatedUntimed = score({
    ...detailed(),
    items: [
      anchor(),
      ...ids
        .slice(1)
        .map((id) => item(id, { placeId: id, inboundTravel: routed(20), openingHours: hours })),
    ],
  });
  const floor = score(reference())!;
  for (const partial of [timedUnlocated, locatedUntimed]) {
    expect(partial).toBeGreaterThan(floor);
    expect(partial).toBeLessThan(100);
  }
});

test('locating or timing one more stop never lowers the day', () => {
  const steps: Partial<ScoredDayInput>[] = [reference()];
  // Locate the stops one at a time, then time them one at a time.
  for (let located = 1; located <= 3; located++)
    steps.push({
      items: [
        anchor(),
        ...ids
          .slice(1)
          .map((id, index) =>
            index < located
              ? item(id, { placeId: id, inboundTravel: routed(20), openingHours: hours })
              : item(id),
          ),
      ],
      places: ids.slice(0, located + 1).map((id, index) => place(id, index, kinds(index))),
      segments: ids.slice(1).map((id, index) => leg(ids[index]!, id, index < located ? 20 : null)),
    });
  for (let timed = 1; timed <= 3; timed++)
    steps.push({
      ...detailed(),
      items: [
        anchor(),
        ...ids.slice(1).map((id, index) =>
          item(id, {
            placeId: id,
            inboundTravel: routed(20),
            openingHours: hours,
            ...(index < timed
              ? { fixed: false, start: at(690 + index * 150), duration: at(90) }
              : {}),
          }),
        ),
      ],
    });
  const scores = steps.map(score);
  for (let index = 1; index < scores.length; index++)
    expect(scores[index]).toBeGreaterThanOrEqual(scores[index - 1]!);
  expect(scores.at(-1)).toBe(100);
});

test('provider gaps stay neutral: unpublished hours and no rating cost nothing', () => {
  const quiet = detailed();
  const evaluated = evaluate({
    ...quiet,
    items: quiet.items!.map((entry) => ({
      ...entry,
      openingHours: { status: 'UNKNOWN' as const },
    })),
    places: quiet.places!.map((entry) => ({ ...entry, rating: { status: 'UNKNOWN' as const } })),
  });
  expect(scoreDay(evaluated.input).score).toBe(100);
  expect(evaluated.detailNudges).toEqual([]);
});

test('a linked place whose snapshot lapsed, or a custom place on the map, counts as located', () => {
  const lapsed = evaluate({
    items: [anchor(), item('s1', { placeId: 's1', fixed: true, start: at(690), duration: at(90) })],
    places: [
      place('anchor', 0),
      { tripPlaceId: 's1', linked: true, coordinates: null, rating: { status: 'UNKNOWN' } },
    ],
  });
  expect(lapsed.detailNudges).toEqual([]);
  const custom = evaluate({
    items: [anchor(), item('s1', { placeId: 's1', fixed: true, start: at(690), duration: at(90) })],
    places: [
      place('anchor', 0),
      {
        tripPlaceId: 's1',
        linked: false,
        coordinates: { latitude: 1.31, longitude: 103.81 },
        rating: { status: 'UNKNOWN' },
      },
    ],
  });
  expect(custom.detailNudges).toEqual([]);
  const pinless = evaluate({
    items: [anchor(), item('s1', { placeId: 's1', fixed: true, start: at(690), duration: at(90) })],
    places: [
      place('anchor', 0),
      { tripPlaceId: 's1', linked: false, coordinates: null, rating: { status: 'UNKNOWN' } },
    ],
  });
  expect(pinless.detailNudges).toMatchObject([{ code: 'STOPS_NOT_LOCATED', references: ['s1'] }]);
});

test('an untyped stop is no longer assumed to be indoors in a wet month', () => {
  const wet = { temperatureMaxC: 24, temperatureMinC: 18, wetDayShare: 0.8 };
  const park = item('park', { placeId: 'park', fixed: true, start: at(540), duration: at(120) });
  const alone = evaluate({ items: [park], places: [place('park', 0, ['park'])], climate: wet });
  const withLabel = evaluate({
    items: [park, item('label', { fixed: true, start: at(720), duration: at(120) })],
    places: [place('park', 0, ['park'])],
    climate: wet,
  });
  expect(withLabel.seasonalFit).toEqual(alone.seasonalFit);
  expect(alone.seasonalFit).toMatchObject({ state: 'EVALUATED' });
});

test('missing detail never softens a proven conflict or a proven overload', () => {
  const overlapping = [
    item('a', { placeId: 'a', fixed: true, start: at(540), duration: at(120) }),
    item('b', { placeId: 'b', fixed: true, start: at(600), duration: at(60) }),
  ];
  const places = [place('a', 0), place('b', 1)];
  const conflict = evaluate({ items: overlapping, places });
  const conflictWithGaps = evaluate({
    items: [...overlapping, item('c'), item('d')],
    places,
  });
  const feasibility = (evaluated: ReturnType<typeof evaluate>) =>
    evaluated.input.factors.FEASIBILITY?.state === 'EVALUATED'
      ? evaluated.input.factors.FEASIBILITY.score
      : null;
  expect(feasibility(conflictWithGaps)).toBeLessThanOrEqual(feasibility(conflict)!);

  const heavy = evaluate({
    items: [item('long', { placeId: 'a', duration: at(720) }), item('unmeasured')],
    places: [place('a', 0)],
  });
  // 720 known minutes against a 480-minute balanced day already scores 40;
  // the unmeasured stop can only add to that load, never lift the score.
  expect(heavy.pace.factor).toMatchObject({ state: 'EVALUATED', score: 40 });
});

test('a withheld day still asks for the detail it needs', () => {
  const labels = evaluate({ items: [item('a'), item('b')] });
  expect(scoreDay(labels.input).score).toBeNull();
  const score = buildPlanScoreFromEvaluations({
    days: [{ date: '2026-10-01', evaluation: labels }],
    mustGoIds: [],
    scheduledIds: [],
  });
  const codes = (reasons: { code: string }[]) => reasons.map((reason) => reason.code);
  expect(codes(score.days[0]!.explanations.worthImproving)).toEqual([
    'STOPS_NOT_LOCATED',
    'STOPS_WITHOUT_TIMING',
  ]);
  expect(score.days[0]!.explanations.worthImproving[0]!.values).toMatchObject({ count: 2, day: 1 });
  // The trip names every such stop once per kind, not once per day.
  const twoDays = buildPlanScoreFromEvaluations({
    days: [
      { date: '2026-10-01', evaluation: labels },
      { date: '2026-10-02', evaluation: evaluate({ dayId: 'next', items: [item('c')] }) },
    ],
    mustGoIds: [],
    scheduledIds: [],
  });
  expect(
    twoDays.explanations.worthImproving.filter((reason) => reason.code.startsWith('STOPS_')),
  ).toMatchObject([
    {
      code: 'STOPS_NOT_LOCATED',
      messageKey: 'missing.locationsTrip',
      references: ['a', 'b', 'c'],
      values: { count: 3 },
    },
    {
      code: 'STOPS_WITHOUT_TIMING',
      messageKey: 'missing.timingTrip',
      references: ['a', 'b', 'c'],
      values: { count: 3 },
    },
  ]);
});
