import type { AiPlanningSessionStage } from './presentation';

/**
 * The generating takeover draws one route across four stops, and how much of it
 * is drawn is the server's own answer rather than a timer: the pipeline moves
 * the session `stage` as it generates, grounds, schedules and validates, and the
 * client already polls that every 1.5s. Reading the drawn fraction off the stage
 * keeps the picture honest — a slow grounding pass looks slow, and a route that
 * has reached its last stop really is one poll away from an itinerary.
 *
 * The gaps between the values are what the eye reads as pace. Grounding fans out
 * to a place lookup per candidate and is reliably the longest leg, so it earns
 * the longest stretch of route; validating is close to instant and gets a sliver,
 * because a stage that finishes before it is seen should not promise much.
 */
export function aiPlanningRouteProgress(stage: AiPlanningSessionStage) {
  switch (stage) {
    case 'created':
      return 0.14;
    case 'generating':
      return 0.32;
    case 'grounding':
      return 0.58;
    case 'scheduling':
      return 0.82;
    case 'validating':
      return 0.93;
    case 'reviewing':
    case 'complete':
      return 1;
  }
}

/** Where the four stops sit along the route, as a fraction of its length. */
export const aiPlanningRouteStops = [0.02, 0.3, 0.58, 0.99] as const;

/**
 * A stop lights up once the route has reached it. The small lead means the
 * drawn head arrives on a stop rather than stopping short of one, which is the
 * difference between a route being built and a route being interrupted.
 */
export function aiPlanningReachedStops(progress: number) {
  return aiPlanningRouteStops.filter((stop) => progress >= stop - 0.04).length;
}

/** The days only start stacking up once there is a schedule to stack. */
export function aiPlanningShowsItineraryCards(stage: AiPlanningSessionStage) {
  return (
    stage === 'scheduling' ||
    stage === 'validating' ||
    stage === 'reviewing' ||
    stage === 'complete'
  );
}

export const aiPlanningGeneratingHints = [
  'discovering',
  'planning',
  'optimising',
  'assembling',
] as const;

export type AiPlanningGeneratingHint = (typeof aiPlanningGeneratingHints)[number];

/**
 * Stages are the truth, but grounding alone can hold the screen for half a
 * minute, and a line of text that never changes for that long reads as a stall.
 * The hint rotates underneath the stage label to keep the screen alive, starting
 * from whichever hint the current stage is actually about so the two lines never
 * contradict each other.
 */
export function aiPlanningGeneratingHint(stage: AiPlanningSessionStage, tick: number) {
  const start = aiPlanningShowsItineraryCards(stage)
    ? stage === 'scheduling'
      ? 1
      : stage === 'validating'
        ? 2
        : 3
    : 0;
  const offset =
    (((start + tick) % aiPlanningGeneratingHints.length) + aiPlanningGeneratingHints.length) %
    aiPlanningGeneratingHints.length;
  return aiPlanningGeneratingHints[offset];
}
