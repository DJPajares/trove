import type { AiPlannerLegMode } from '@trove/types';
import { haversineKm } from './plan-score-route-comparison.js';

type Coordinates = { latitude: number; longitude: number };

/**
 * Straight-line distances a generated leg is walked or ridden within. Walking
 * 1.2 km is about twenty minutes on the walk model Plan Score estimates with;
 * beyond 40 km a leg is no longer local public transport.
 */
export const AI_WALK_MAX_KM = 1.2;
export const AI_TRANSIT_MAX_KM = 40;

/**
 * How a generated leg is travelled when nothing more is known: on foot where
 * that is a short walk, by public transport across a city, and by car only
 * beyond it. Travellers rarely drive between neighbouring sights, so a plan
 * that defaults to driving misdescribes most city days.
 */
export function preferredLegMode(from: Coordinates, to: Coordinates): AiPlannerLegMode {
  const km = haversineKm(from, to);
  if (!Number.isFinite(km)) return 'drive';
  if (km <= AI_WALK_MAX_KM) return 'walk';
  if (km <= AI_TRANSIT_MAX_KM) return 'transit';
  return 'drive';
}
