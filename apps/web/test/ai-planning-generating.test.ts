import { expect, test } from 'vitest';

import {
  aiPlanningGeneratingHint,
  aiPlanningGeneratingHints,
  aiPlanningReachedStops,
  aiPlanningRouteProgress,
  aiPlanningRouteStops,
  aiPlanningShowsItineraryCards,
} from '../lib/ai-planning/generating.ts';
import type { AiPlanningSessionStage } from '../lib/ai-planning/presentation.ts';

const stages: AiPlanningSessionStage[] = [
  'created',
  'generating',
  'grounding',
  'scheduling',
  'validating',
  'reviewing',
  'complete',
];

test('the route only ever moves forward, and only finishes when the draft does', () => {
  const drawn = stages.map(aiPlanningRouteProgress);

  for (const [index, progress] of drawn.entries()) {
    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThanOrEqual(1);
    if (index > 0) expect(progress).toBeGreaterThanOrEqual(drawn[index - 1]!);
  }
  expect(aiPlanningRouteProgress('validating')).toBeLessThan(1);
  expect(aiPlanningRouteProgress('reviewing')).toBe(1);
  expect(aiPlanningRouteProgress('complete')).toBe(1);
});

test('every stage lights at least one stop, and only a finished route lights them all', () => {
  expect(aiPlanningReachedStops(aiPlanningRouteProgress('created'))).toBe(1);
  expect(aiPlanningReachedStops(aiPlanningRouteProgress('validating'))).toBeLessThan(
    aiPlanningRouteStops.length,
  );
  expect(aiPlanningReachedStops(1)).toBe(aiPlanningRouteStops.length);
});

test('the days only stack up once there is a schedule to stack', () => {
  expect(aiPlanningShowsItineraryCards('generating')).toBe(false);
  expect(aiPlanningShowsItineraryCards('grounding')).toBe(false);
  expect(aiPlanningShowsItineraryCards('scheduling')).toBe(true);
  expect(aiPlanningShowsItineraryCards('reviewing')).toBe(true);
});

test('a hint always resolves, and starts from what its stage is actually doing', () => {
  expect(aiPlanningGeneratingHint('grounding', 0)).toBe('discovering');
  expect(aiPlanningGeneratingHint('scheduling', 0)).toBe('planning');
  expect(aiPlanningGeneratingHint('validating', 0)).toBe('optimising');
  expect(aiPlanningGeneratingHint('reviewing', 0)).toBe('assembling');

  // A stage that outlasts the whole set keeps cycling rather than stalling.
  for (const stage of stages) {
    for (let tick = 0; tick < 12; tick += 1) {
      expect(aiPlanningGeneratingHints).toContain(aiPlanningGeneratingHint(stage, tick));
    }
  }
  expect(aiPlanningGeneratingHint('grounding', 4)).toBe('discovering');
});
