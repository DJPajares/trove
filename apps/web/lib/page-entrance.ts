/**
 * How a page with a cover arrives: the photograph settles from a slight zoom,
 * the words on it rise into place, and the sheet beneath rises over it. Home,
 * the Trips library and a trip's own screens share these, so arriving anywhere
 * feels the same. Each is `motion-safe:` only, so reduced motion arrives still.
 */
export const pageEntrance = {
  /** The cover photograph. */
  media:
    'motion-safe:animate-in motion-safe:duration-[1400ms] motion-safe:ease-out motion-safe:zoom-in-105',
  /** The words set on the cover. */
  rise: 'motion-safe:animate-in motion-safe:fill-mode-both motion-safe:duration-700 motion-safe:ease-[var(--ease-standard)] motion-safe:fade-in motion-safe:slide-in-from-bottom-4',
  /**
   * The sheet beneath the cover. It belongs to the real sheet only: a skeleton
   * wearing it would rise, be replaced, and rise again.
   */
  sheet:
    'motion-safe:animate-in motion-safe:duration-700 motion-safe:ease-[var(--ease-standard)] motion-safe:slide-in-from-bottom-6',
} as const;
