import { expect, test } from 'vitest';
import type { PlanScoreExplanation, PlanScoreExplanationGroups, TripContext } from '@trove/types';

import { climateAdvice, composeInsights } from '../lib/insights/compose';

const context: TripContext = {
  version: 2,
  days: [
    { id: 'd1', date: '2026-10-11' },
    { id: 'd2', date: '2026-10-12' },
    { id: 'd3', date: '2026-10-13' },
  ],
  holidays: [
    {
      date: '2026-10-12',
      dayIds: ['d2'],
      countryCode: 'JP',
      name: 'Sports Day',
      certainty: 'official',
    },
  ],
  climate: [
    {
      dayIds: ['d1', 'd2', 'd3'],
      month: 10,
      years: { from: 2021, to: 2025 },
      temperatureMaxC: 22.4,
      temperatureMinC: 15.1,
      wetDayShare: 0.34,
    },
  ],
};

function advisory(code: string): PlanScoreExplanation {
  return {
    factor: 'EXPERIENCE_QUALITY',
    severity: 'RISK',
    code,
    messageKey: 'unused',
    references: ['item'],
    values: {},
    action: 'REVIEW_TIMING',
  };
}
const groups = (...codes: string[]): PlanScoreExplanationGroups => ({
  whatWorks: [],
  uncertainty: [],
  // A scoring issue sits alongside the advisories and must not become an insight.
  worthImproving: [advisory('HIGH_ACTIVE_LOAD'), ...codes.map(advisory)],
});

test('a trip ranks forecasts, then holidays, then advisories, then the month, naming days', () => {
  const insights = composeInsights({
    context,
    explanations: new Map([
      ['d1', groups('WALKING_LOAD', 'RAIN_FORECAST')],
      ['d3', groups('RAIN_FORECAST')],
    ]),
    scope: { kind: 'trip' },
  });
  expect(insights.map((insight) => [insight.kind, insight.dayNumbers])).toEqual([
    ['rain', [1, 3]],
    ['holiday', [2]],
    ['walking', [1]],
    ['climate', [1, 2, 3]],
  ]);
  expect(insights.map((insight) => insight.certainty)).toEqual([
    'forecast',
    'official',
    'estimate',
    'pattern',
  ]);
});

test('a day shows only what applies to it', () => {
  const insights = composeInsights({
    context,
    explanations: new Map([['d1', groups('RAIN_FORECAST')]]),
    scope: { kind: 'day', dayId: 'd3' },
  });
  expect(insights.map((insight) => insight.kind)).toEqual(['climate']);
  expect(insights[0]?.climate).toMatchObject({ wetDays: 3, advice: 'none' });
});

test('moon-sighted holidays are expected, not official', () => {
  const [holiday] = composeInsights({
    context: {
      ...context,
      climate: [],
      holidays: [{ ...context.holidays[0]!, certainty: 'expected', name: 'Eid al-Fitr' }],
    },
    scope: { kind: 'trip' },
  });
  expect(holiday?.certainty).toBe('expected');
});

test('a month suggests one hedged takeaway at most', () => {
  expect(climateAdvice({ temperatureMaxC: 31, wetDayShare: 0.78 })).toBe('indoor');
  expect(climateAdvice({ temperatureMaxC: 34, wetDayShare: 0.2 })).toBe('heat');
  expect(climateAdvice({ temperatureMaxC: 6, wetDayShare: 0.3 })).toBe('cold');
  expect(climateAdvice({ temperatureMaxC: 22, wetDayShare: 0.3 })).toBe('none');
});

test('nothing worth saying yields no insights, and natural downtime is not one', () => {
  expect(composeInsights({ context: null, scope: { kind: 'trip' } })).toEqual([]);
  expect(
    composeInsights({
      context: { ...context, holidays: [], climate: [] },
      explanations: new Map([
        ['d1', { whatWorks: [advisory('NATURAL_DOWNTIME')], worthImproving: [], uncertainty: [] }],
      ]),
      scope: { kind: 'trip' },
    }),
  ).toEqual([]);
});

test('stops with special hours or a holiday check are named, on their own day, after rain', () => {
  const insights = composeInsights({
    context,
    hoursNotices: [
      {
        date: '2026-10-12',
        dayId: 'd2',
        holidayCertainty: 'official',
        holidayName: 'Sports Day',
        kind: 'holiday_check',
        name: 'Tokyo National Museum',
        tripPlaceId: 'museum',
      },
      {
        asOf: '2026-10-01T00:00:00.000Z',
        date: '2026-10-13',
        dayId: 'd3',
        kind: 'special_hours',
        name: 'Kinkaku-ji',
        spans: [{ close: '15:00', open: '10:00' }],
        tripPlaceId: 'temple',
      },
    ],
    scope: { kind: 'trip' },
  });

  const hours = insights.filter((insight) => insight.kind === 'hours');
  expect(
    hours.map((insight) => [insight.hours?.name, insight.dayNumbers, insight.certainty]),
  ).toStrictEqual([
    ['Tokyo National Museum', [2], 'official'],
    ['Kinkaku-ji', [3], 'published'],
  ]);
  // Ahead of the day-wide holiday note, which says less.
  expect(insights.findIndex((insight) => insight.kind === 'hours')).toBeLessThan(
    insights.findIndex((insight) => insight.kind === 'holiday'),
  );

  const dayThree = composeInsights({
    context,
    hoursNotices: hours.map((insight) => insight.hours!),
    scope: { dayId: 'd3', kind: 'day' },
  });
  expect(dayThree.filter((insight) => insight.kind === 'hours')).toHaveLength(1);
});
