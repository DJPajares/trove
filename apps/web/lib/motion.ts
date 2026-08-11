export const motionDuration = {
  fast: 0.15,
  standard: 0.2,
  slow: 0.32,
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
