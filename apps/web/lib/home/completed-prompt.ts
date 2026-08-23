import type { Trip } from '@/lib/trips/api';

export type CompletedPromptKey =
  'completedPrompt' | 'completedPromptMemories' | 'completedPromptRating';

/**
 * What, if anything, to suggest about a trip the traveller has just finished.
 *
 * Only what is actually still missing, only once, and never after they have
 * said no: a traveller who skips Memories or a rating should be asked a single
 * time rather than every time they open Home.
 */
export function selectCompletedPrompt(
  trip: Trip | null,
  dismissedTripIds: readonly string[],
): CompletedPromptKey | null {
  if (!trip || trip.lifecycle !== 'completed') return null;
  if (dismissedTripIds.includes(trip.id)) return null;

  const hasMemories = trip.memoryCount > 0;
  // A rating of zero is a rating. Testing for absence rather than falsiness is
  // the difference between "not rated yet" and "rated it poorly".
  const hasRating = trip.experienceRating !== null;

  if (!hasMemories && !hasRating) return 'completedPrompt';
  if (!hasMemories) return 'completedPromptMemories';
  if (!hasRating) return 'completedPromptRating';

  return null;
}
