/**
 * Experience Rating is the traveller's own reflection on how something felt:
 * an optional 1-5 for a completed day or the whole trip (PRD section 30). It is
 * shown as five ink dots and a word rather than as stars, so it never reads as
 * a review site's score, and never as Plan Score's computed signal.
 */
export const EXPERIENCE_RATING_VALUES = [1, 2, 3, 4, 5] as const;

export type ExperienceRatingValue = (typeof EXPERIENCE_RATING_VALUES)[number];

/** Each value's message key under `experienceRating.words`. */
export type ExperienceRatingWordKey = `${ExperienceRatingValue}`;

/** The word a rating is spoken as, or null for anything that is not a rating. */
export function experienceRatingWord(
  value: number | null | undefined,
): ExperienceRatingWordKey | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) {
    return null;
  }

  return String(value) as ExperienceRatingWordKey;
}

/**
 * Choosing the value already given clears it rather than keeping it, so a
 * rating can always be taken back without a separate control for it.
 */
export function nextExperienceRating(
  current: number | null,
  chosen: ExperienceRatingValue,
): ExperienceRatingValue | null {
  return current === chosen ? null : chosen;
}
