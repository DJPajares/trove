import { useState, type CSSProperties } from 'react';

/**
 * Each entrance reads its start from `--entrance-offset`, a negative delay set
 * once on the page. A page mounted a second time mid-entrance carries the
 * time already spent, so the new elements pick the animation up where the old
 * ones were rather than starting it over.
 */
const OFFSET = 'motion-safe:[--tw-animation-delay:var(--entrance-offset,0ms)]';

/**
 * How a page with a cover arrives: the photograph settles from a slight zoom,
 * the words on it rise into place, and the sheet beneath rises over it. Home,
 * the Trips library and a trip's own screens share these, so arriving anywhere
 * feels the same. Each is `motion-safe:` only, so reduced motion arrives still.
 */
export const pageEntrance = {
  /** The cover photograph. */
  media: `motion-safe:animate-in motion-safe:duration-[1400ms] motion-safe:ease-out motion-safe:zoom-in-105 ${OFFSET}`,
  /** The words set on the cover. */
  rise: `motion-safe:animate-in motion-safe:fill-mode-both motion-safe:duration-700 motion-safe:ease-[var(--ease-standard)] motion-safe:fade-in motion-safe:slide-in-from-bottom-4 ${OFFSET}`,
  /**
   * The sheet beneath the cover. It belongs to the real sheet only: a skeleton
   * wearing it would rise, be replaced, and rise again.
   */
  sheet: `motion-safe:animate-in motion-safe:duration-700 motion-safe:ease-[var(--ease-standard)] motion-safe:slide-in-from-bottom-6 ${OFFSET}`,
} as const;

/** The longest of the entrances above; after it, an entrance is over. */
const ENTRANCE_MS = 1400;

/** When the entrance it keeps time for began, shared by every mount of a page. */
export type EntranceClock = { startedAt: number | null };

export type Entrance = {
  /** Whether the page wears the entrance classes. */
  enter: boolean;
  /** Set on the page's root: how far into the entrance this mount begins. */
  style: CSSProperties | undefined;
};

const NO_ENTRANCE: Entrance = { enter: false, style: undefined };

/** Exported for tests: `now` is a monotonic clock in milliseconds. */
export function decideEntrance(clock: EntranceClock, replay: boolean, now: number): Entrance {
  const elapsed = clock.startedAt === null ? null : now - clock.startedAt;
  // A second mount while the first is still arriving: continue it.
  if (elapsed !== null && elapsed < ENTRANCE_MS) {
    return {
      enter: true,
      style: { '--entrance-offset': `${-Math.round(elapsed)}ms` } as CSSProperties,
    };
  }
  // Already arrived, and this page arrives only once.
  if (elapsed !== null && !replay) return NO_ENTRANCE;
  clock.startedAt = now;
  return { enter: true, style: undefined };
}

/**
 * Whether, and from where, this mount of a page makes its entrance.
 *
 * A route whose loading boundary renders the page itself mounts it twice in
 * production: once from the prefetched boundary, again when the page arrives.
 * Starting the entrance over on the second mount played it twice; dropping it
 * cut it off halfway. Both mounts read one clock, so the second continues the
 * first.
 *
 * The decision is made on the first render where the page is `ready` to show
 * what animates, not when it mounts behind a skeleton. With `replay`, an
 * entrance that has finished starts again the next time the page opens; without
 * it, the page makes its entrance once per clock.
 */
export function useEntrance(
  clock: EntranceClock | null,
  { ready, replay }: { ready: boolean; replay: boolean },
): Entrance {
  const [entrance, setEntrance] = useState<Entrance | null>(null);
  if (ready && entrance === null) {
    const next = clock ? decideEntrance(clock, replay, performance.now()) : NO_ENTRANCE;
    setEntrance(next);
    return next;
  }
  return entrance ?? NO_ENTRANCE;
}
