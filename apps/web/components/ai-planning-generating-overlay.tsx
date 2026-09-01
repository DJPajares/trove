'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  aiPlanningGeneratingHint,
  aiPlanningReachedStops,
  aiPlanningRouteProgress,
  aiPlanningShowsItineraryCards,
} from '@/lib/ai-planning/generating';
import type { AiPlanningSessionStage } from '@/lib/ai-planning/presentation';
import { motionEase } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * How long a hint holds before the next one takes over. Long enough to read
 * twice without hurrying, short enough that a stage which outlasts three of them
 * still looks like it is going somewhere.
 */
const HINT_INTERVAL_MS = 3_600;

/**
 * The route redraws at roughly the pace a hand would take to trace it. Slower
 * than the standard duration on purpose: this is the one thing on screen the
 * traveller is meant to watch, and a transition they can follow is what makes
 * the wait feel worked rather than parked.
 */
const ROUTE_DRAW_S = 1.3;

/** The four stops, hand-placed on the route below rather than measured at runtime. */
const STOP_POSITIONS = [
  { x: 26, y: 162 },
  { x: 104, y: 122 },
  { x: 184, y: 138 },
  { x: 296, y: 46 },
] as const;

const ROUTE_PATH =
  'M 26 162 C 58 158 74 128 104 122 C 138 115 150 146 184 138 C 222 129 226 74 258 58 C 274 50 284 48 296 46';

/** Places the route has not reached for. Static, and quiet enough to stay ground. */
const CANDIDATE_DOTS = [
  { x: 62, y: 96 },
  { x: 138, y: 74 },
  { x: 150, y: 176 },
  { x: 214, y: 168 },
  { x: 238, y: 110 },
  { x: 268, y: 148 },
] as const;

type AiPlanningGeneratingOverlayProps = {
  cancelling: boolean;
  onCancel: () => void;
  phase: 'landing' | 'working';
  stage: AiPlanningSessionStage;
};

/**
 * The full-screen takeover that holds the wait between a prompt and an
 * itinerary.
 *
 * It is one picture: a route drawn across four stops, with the drawn fraction
 * read off the server's own pipeline stage. Nothing here is on a timer that
 * pretends to know how long the model will take — when grounding is slow, the
 * route sits at its third stop and the traveller is looking at the truth.
 *
 * It lives above the creation sheet rather than inside it because it has to
 * outlast it: the sheet closes when the draft is ready, and this stays mounted
 * across the redirect so its fade-out is what covers the review screen's first
 * paint.
 */
export function AiPlanningGeneratingOverlay({
  cancelling,
  onCancel,
  phase,
  stage,
}: Readonly<AiPlanningGeneratingOverlayProps>) {
  const t = useTranslations('trips.aiPlanning');
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [tick, setTick] = useState(0);

  const landing = phase === 'landing';
  const progress = landing ? 1 : aiPlanningRouteProgress(stage);
  const reachedStops = aiPlanningReachedStops(progress);
  const showCards = landing || aiPlanningShowsItineraryCards(stage);
  const headline = landing ? t('generating.ready') : t(`stages.${stage}`);
  const hint = t(`generating.hints.${aiPlanningGeneratingHint(stage, tick)}`);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((current) => current + 1), HINT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  // The screen behind this one is still in the tab order, and a takeover the
  // keyboard can walk out of behind is not a takeover. Nothing is moved or
  // hidden — focus is simply brought back to the one thing there is to do.
  useEffect(() => {
    cancelRef.current?.focus();

    function onFocusIn(event: FocusEvent) {
      const container = containerRef.current;
      if (!container || !(event.target instanceof Node)) return;
      if (container.contains(event.target)) return;
      cancelRef.current?.focus();
    }

    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  const swap = reducedMotion
    ? {
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        initial: { opacity: 1 },
        transition: { duration: 0 },
      }
    : {
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -6 },
        initial: { opacity: 0, y: 6 },
        transition: { duration: 0.24, ease: motionEase },
      };

  return (
    <motion.div
      animate={{ opacity: 1 }}
      aria-label={t('generating.label')}
      aria-modal="true"
      className="fixed inset-0 z-[var(--layer-takeover)] flex flex-col items-center justify-center bg-background bg-[radial-gradient(120%_80%_at_50%_0%,var(--surface-tint),var(--background))] px-[max(1.5rem,var(--safe-left))] pt-[max(2rem,var(--safe-top))] pb-[max(2rem,var(--safe-bottom))]"
      exit={{ opacity: 0 }}
      initial={{ opacity: reducedMotion ? 1 : 0 }}
      ref={containerRef}
      role="dialog"
      transition={{ duration: reducedMotion ? 0 : 0.24, ease: motionEase }}
    >
      <div className="flex w-full max-w-[32rem] flex-col items-center gap-7">
        <svg
          aria-hidden="true"
          className="w-full max-w-[26rem]"
          fill="none"
          viewBox="0 26 320 156"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Ground: contours and unvisited candidates, so the route has somewhere to be. */}
          <g opacity="0.55" stroke="var(--border-subtle)" strokeWidth="1.25">
            <path d="M -10 60 C 60 34 120 82 190 58 S 300 22 340 40" />
            <path d="M -10 108 C 70 88 118 132 196 106 S 300 76 340 92" />
            <path d="M -10 178 C 80 156 140 190 210 172 S 302 140 340 154" />
          </g>
          {CANDIDATE_DOTS.map((dot) => (
            <circle
              cx={dot.x}
              cy={dot.y}
              fill="var(--border-strong)"
              key={`${dot.x}-${dot.y}`}
              opacity="0.5"
              r="2"
            />
          ))}

          {/* The route, undrawn then drawn. The faint copy underneath is the
              journey that is still ahead, which is what makes the bright half
              read as progress rather than as a line. */}
          <path
            d={ROUTE_PATH}
            opacity="0.28"
            stroke="var(--border-strong)"
            strokeLinecap="round"
            strokeWidth="2.5"
          />
          <motion.path
            animate={{ pathLength: progress }}
            d={ROUTE_PATH}
            initial={{ pathLength: reducedMotion ? progress : 0 }}
            stroke="var(--brand)"
            strokeLinecap="round"
            strokeWidth="2.5"
            transition={{ duration: reducedMotion ? 0 : ROUTE_DRAW_S, ease: motionEase }}
          />

          {STOP_POSITIONS.map((stop, index) => {
            const reached = index < reachedStops;
            const leading = reached && index === reachedStops - 1;

            return (
              <g key={`${stop.x}-${stop.y}`}>
                {leading && !reducedMotion ? (
                  <motion.circle
                    animate={{ opacity: [0.45, 0, 0.45], scale: [1, 2.1, 1] }}
                    cx={stop.x}
                    cy={stop.y}
                    fill="var(--accent)"
                    r="6"
                    style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                    transition={{ duration: 2.4, ease: motionEase, repeat: Infinity }}
                  />
                ) : null}
                <motion.circle
                  animate={{ opacity: reached ? 1 : 0.3, scale: reached ? 1 : 0.6 }}
                  cx={stop.x}
                  cy={stop.y}
                  fill={reached ? 'var(--card)' : 'var(--background)'}
                  initial={false}
                  r="5"
                  stroke={reached ? 'var(--brand)' : 'var(--border-strong)'}
                  strokeWidth="2.5"
                  style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                  transition={{ duration: reducedMotion ? 0 : 0.32, ease: motionEase }}
                />
              </g>
            );
          })}
        </svg>

        {/* The days. They are there from the start as empty slots — the trip
            always had this shape — and fill in once there is a schedule to put
            in them, so their settling is itself a piece of progress. */}
        <div aria-hidden="true" className="flex w-full max-w-[26rem] gap-3">
          {[0, 1, 2].map((index) => (
            <motion.div
              animate={{ opacity: showCards ? 1 : 0.4, y: showCards ? 0 : 6 }}
              className="flex-1 space-y-2 rounded-[var(--radius-sm)] border border-border-subtle bg-card p-3 shadow-[var(--shadow-control)]"
              initial={false}
              key={index}
              transition={{
                delay: reducedMotion || !showCards ? 0 : index * 0.08,
                duration: reducedMotion ? 0 : 0.36,
                ease: motionEase,
              }}
            >
              <span
                className={cn(
                  'block size-1.5 rounded-full transition-colors duration-[var(--motion-slow)] ease-[var(--ease-standard)]',
                  showCards ? 'bg-brand' : 'bg-border-strong',
                )}
              />
              <span className="block h-1.5 w-full rounded-full bg-muted" />
              <span className="block h-1.5 w-2/3 rounded-full bg-muted" />
            </motion.div>
          ))}
        </div>

        <div className="flex flex-col items-center gap-1.5 text-center">
          {/* Only the stage is announced. The hint underneath rotates on a timer
              and would turn a live region into a metronome. */}
          <div aria-busy="true" aria-live="polite" className="grid" role="status">
            <AnimatePresence initial={false}>
              <motion.p
                className={cn(
                  '[grid-area:1/1] text-[length:var(--text-section-title)] leading-tight font-semibold tracking-[-0.025em] text-balance',
                  landing ? 'text-brand' : 'text-foreground',
                )}
                key={landing ? 'ready' : stage}
                {...swap}
              >
                {headline}
              </motion.p>
            </AnimatePresence>
          </div>

          <div aria-hidden="true" className="grid min-h-6">
            <AnimatePresence initial={false}>
              <motion.p
                className="[grid-area:1/1] text-sm text-muted-foreground"
                key={landing ? 'landing' : hint}
                {...swap}
              >
                {landing ? t('generating.opening') : hint}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>

        {/* The fade lives on the wrapper: `disabled:opacity-50` on the button
            outranks an `opacity-0` of its own, and there is nothing to cancel
            once the draft has landed. */}
        <motion.div
          animate={{ opacity: landing ? 0 : 1 }}
          className={cn(landing && 'pointer-events-none')}
          initial={false}
          transition={{ duration: reducedMotion ? 0 : 0.24, ease: motionEase }}
        >
          <Button
            disabled={cancelling || landing}
            onClick={onCancel}
            ref={cancelRef}
            type="button"
            variant="ghost"
          >
            {cancelling ? t('cancelling') : t('cancel')}
          </Button>
        </motion.div>
      </div>
    </motion.div>
  );
}
