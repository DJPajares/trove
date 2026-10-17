'use client';

import { motion, useReducedMotion } from 'motion/react';

import type { DayRouteDrawing, DaySketchPlace } from '@/lib/itinerary/day-sketch';
import * as Icons from '@/lib/icons';
import { cn } from '@/lib/utils';

/** The box the day's route is drawn into; the SVG scales to its container. */
export const DAY_SKETCH_BOX = { height: 80, padding: 11, width: 128 } as const;

/** Past this many stops a number in every mark is too small to read, so marks go plain. */
const MAX_NUMBERED = 9;

const EASE = [0.65, 0, 0.35, 1] as const;

/**
 * The day's route, drawn rather than mapped: a line through where the day goes,
 * a square for its Stay at either end and a numbered mark for each stop - the
 * same numbers and the same shapes as the map, so the sketch reads as the map's
 * thumbnail. It costs nothing to draw, which is why a phone shows it and keeps
 * the billed map for when it is asked for.
 *
 * Each leg says how much is known about it: the road itself when the day's
 * legs already carry it, a straight line for a measured leg without one, a
 * dashed line to and from the Stay as the timeline draws it, and a faint
 * dotted line where nothing measured the way. A day with one located place
 * shows that place alone; a day with none shows a quiet map mark.
 *
 * Decorative: the timeline beneath says everything the drawing does, so it is
 * hidden from assistive tech and the control around it carries the meaning.
 */
export function DayRouteSketch({
  className,
  drawing,
  places,
}: Readonly<{
  className?: string;
  drawing: DayRouteDrawing | null;
  places: readonly DaySketchPlace[];
}>) {
  const reduced = useReducedMotion();
  const box = DAY_SKETCH_BOX;

  if (!drawing && !places.length) {
    return (
      <span
        aria-hidden="true"
        className={cn('grid h-full w-full place-items-center text-muted-foreground', className)}
      >
        <Icons.MapView className="size-5" />
      </span>
    );
  }

  // One place, or several too close together to draw apart: a single mark,
  // with the count when it stands for more than one.
  if (!drawing) {
    const only = places.length === 1 ? places[0] : null;
    return (
      <svg
        aria-hidden="true"
        className={cn('h-full w-full', className)}
        data-slot="day-route-sketch"
        viewBox={`0 0 ${box.width} ${box.height}`}
      >
        <circle className="fill-primary/10" cx={box.width / 2} cy={box.height / 2} r="17" />
        <circle className="fill-primary/15" cx={box.width / 2} cy={box.height / 2} r="11" />
        {only?.kind === 'stay' ? (
          <rect
            className="fill-card stroke-primary"
            height="11"
            rx="2.5"
            strokeWidth="2"
            width="11"
            x={box.width / 2 - 5.5}
            y={box.height / 2 - 5.5}
          />
        ) : (
          <g>
            <circle className="fill-primary" cx={box.width / 2} cy={box.height / 2} r="7" />
            <text
              className="fill-primary-foreground font-semibold"
              dominantBaseline="central"
              fontSize="7.5"
              textAnchor="middle"
              x={box.width / 2}
              y={box.height / 2 + 0.25}
            >
              {only ? only.number : places.length}
            </text>
          </g>
        )}
      </svg>
    );
  }

  const numbered = places.filter((place) => place.kind === 'stop').length <= MAX_NUMBERED;

  return (
    <svg
      aria-hidden="true"
      className={cn('h-full w-full text-primary/60', className)}
      data-slot="day-route-sketch"
      viewBox={`0 0 ${drawing.width} ${drawing.height}`}
    >
      {drawing.legs.map((leg, index) => {
        const dashed = leg.style === 'unknown' || leg.stay;
        return (
          <motion.path
            animate={dashed ? { opacity: leg.style === 'unknown' ? 0.6 : 1 } : { pathLength: 1 }}
            d={leg.path}
            fill="none"
            initial={reduced ? false : dashed ? { opacity: 0 } : { pathLength: 0 }}
            key={leg.key}
            stroke="currentColor"
            strokeDasharray={leg.style === 'unknown' ? '0.1 3.5' : leg.stay ? '3 2.5' : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={leg.style === 'unknown' ? 1.75 : 1.5}
            transition={
              reduced
                ? { duration: 0 }
                : {
                    delay: (index / Math.max(1, drawing.legs.length)) * 0.5,
                    duration: dashed ? 0.4 : 0.7,
                    ease: EASE,
                  }
            }
          />
        );
      })}
      {places.map((place, index) => {
        const point = drawing.points[index];
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
            {/* A ring of the card's own colour keeps a mark legible over a line. */}
            <circle
              className="fill-primary stroke-card"
              cx={point.x}
              cy={point.y}
              r={numbered ? 6.5 : 3.75}
              strokeWidth="1.5"
            />
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
