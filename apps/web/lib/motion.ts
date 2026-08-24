/**
 * The motion scale, for the handful of places that animate through motion/react
 * rather than through CSS.
 *
 * `globals.css` holds the same two values as `--motion-standard` and
 * `--ease-standard`, because a CSS transition needs a duration string and
 * motion/react needs seconds, and neither can read the other. `motion-tokens`
 * in the test suite asserts the two agree, so the pair cannot drift unnoticed.
 *
 * Only the standard duration has a twin. `--motion-fast` and `--motion-slow`
 * live in CSS alone, which is the cheapest kind of single source there is.
 */
export const motionDuration = {
  standard: 0.2,
} as const;

export const motionEase = [0.2, 0, 0, 1] as const;

export const pageTransition = {
  duration: motionDuration.standard,
  ease: motionEase,
} as const;

export const navigationTransition = {
  duration: motionDuration.standard,
  ease: motionEase,
} as const;
