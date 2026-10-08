'use client';

import { motion, useReducedMotion } from 'motion/react';

import type { DaySketchPlace } from '@/lib/itinerary/day-sketch';
import type { RouteSketch } from '@/lib/maps/route-sketch';
import { cn } from '@/lib/utils';

/** The box the day's route is drawn into; the SVG scales to its container. */
export const DAY_SKETCH_BOX = { height: 80, padding: 11, width: 128 } as const;

/** Past this many stops a number in every mark is too small to read, so marks go plain. */
const MAX_NUMBERED = 9;

/**
 * The day's route, drawn rather than mapped: a line through where the day goes,
 * a square for its Stay at either end and a numbered mark for each stop - the
 * same numbers and the same shapes as the map, so the sketch reads as the map's
 * thumbnail. It costs nothing to draw, which is why a phone shows it and keeps
 * the billed map for when it is asked for.
 *
 * Decorative: the timeline beneath says everything the drawing does, so it is
 * hidden from assistive tech and the control around it carries the meaning.
 */
export function DayRouteSketch({
  className,
  places,
  sketch,
}: Readonly<{
  className?: string;
  places: readonly DaySketchPlace[];
  sketch: RouteSketch;
}>) {
  const reduced = useReducedMotion();
  const numbered = places.filter((place) => place.kind === 'stop').length <= MAX_NUMBERED;

  return (
    <svg
      aria-hidden="true"
      className={cn('h-auto w-full text-muted-foreground', className)}
      data-slot="day-route-sketch"
      viewBox={`0 0 ${sketch.width} ${sketch.height}`}
    >
      <motion.path
        animate={{ pathLength: 1 }}
        d={sketch.path}
        fill="none"
        initial={reduced ? false : { pathLength: 0 }}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        transition={reduced ? { duration: 0 } : { duration: 0.9, ease: [0.65, 0, 0.35, 1] }}
      />
      {places.map((place, index) => {
        const point = sketch.points[index];
        if (!point) return null;

        if (place.kind === 'stay') {
          return (
            <rect
              className="fill-card stroke-primary"
              height="9"
              key={place.key}
              rx="2"
              strokeWidth="1.75"
              width="9"
              x={point.x - 4.5}
              y={point.y - 4.5}
            />
          );
        }

        return (
          <g key={place.key}>
            <circle className="fill-primary" cx={point.x} cy={point.y} r={numbered ? 6 : 3.5} />
            {numbered ? (
              <text
                className="fill-primary-foreground font-semibold"
                dominantBaseline="central"
                fontSize="7"
                textAnchor="middle"
                x={point.x}
                y={point.y + 0.25}
              >
                {place.number}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
