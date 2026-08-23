import { cva } from 'class-variance-authority';
import type { ReactNode } from 'react';

import type { RoutePresentationState } from '@/lib/itinerary/route-presentation';
import { cn } from '@/lib/utils';

/**
 * The day's rows, on one spine.
 *
 * A day used to be three vocabularies stacked in one list — stops as `Item`
 * rows, bases as differently-shaped `Item` rows, legs on a rail of their own —
 * so the eye had to reassemble a sequence the markup had already taken apart.
 * Everything a day contains now hangs off the same connector, and the only
 * thing that varies between a stop and the leg that reaches it is weight.
 */

const markerVariants = cva(
  'grid shrink-0 place-items-center font-semibold tabular-nums select-none',
  {
    variants: {
      variant: {
        /** Squared off and outlined, the way the map draws a base. */
        base: 'size-10 rounded-[var(--radius-md)] border-2 border-primary bg-card text-sm text-primary',
        /** A base with nothing to point at on the map. */
        'base-unlocated':
          'size-10 rounded-[var(--radius-md)] border-2 border-border bg-muted text-sm text-muted-foreground',
        /** The connector's own punctuation: a mark on the spine, not a badge on
            it. A leg used to wear the same circle a stop does, holding a copy of
            the mode icon its own control was already showing one column over —
            two drawings of one fact on the quietest row of the day. */
        leg: 'size-2 rounded-full bg-border-strong',
        /** A stop with a pin to match. */
        stop: 'size-10 rounded-full bg-primary text-sm text-primary-foreground',
        /** A stop with no location has no pin to match, and says so by not looking like one. */
        'stop-unlocated':
          'size-10 rounded-full border border-border bg-muted text-sm text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'stop' },
  },
);

export type TimelineMarkerVariant = 'base' | 'base-unlocated' | 'leg' | 'stop' | 'stop-unlocated';

export function TimelineMarker({
  children,
  label,
  variant,
}: Readonly<{ children?: ReactNode; label?: string; variant: TimelineMarkerVariant }>) {
  return (
    <span className={markerVariants({ variant })}>
      {label ? <span className="sr-only">{label}</span> : null}
      {children ? <span aria-hidden="true">{children}</span> : null}
    </span>
  );
}

/** The list a timeline's rows are items of. `TimelineRow` is a `listitem`. */
export function TimelineGroup({
  children,
  className,
  label,
}: Readonly<{ children: ReactNode; className?: string; label: string }>) {
  return (
    <div
      aria-label={label}
      className={cn('flex w-full flex-col border-y border-border-subtle', className)}
      data-slot="timeline-group"
      role="list"
    >
      {children}
    </div>
  );
}

const stateVariants = cva('', {
  variants: {
    state: {
      cached: 'text-status-warning',
      estimated: 'text-foreground',
      'not-estimated': 'text-muted-foreground',
      unavailable: 'text-muted-foreground',
    },
  },
  defaultVariants: { state: 'estimated' },
});

const rowVariants = cva(
  'group/timeline-row grid grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-x-3 px-3',
  {
    variants: {
      tone: {
        /** Connective tissue. Quieter and shorter than the stops it joins. */
        leg: 'min-h-12 text-xs',
        stop: 'min-h-16 text-sm',
      },
    },
    defaultVariants: { tone: 'stop' },
  },
);

type TimelineRowProps = {
  actions?: ReactNode;
  className?: string;
  connector?: 'after' | 'before' | 'both' | 'none';
  description?: ReactNode;
  /** Plan Score deep-links focus a stop by id, so this has to reach the row. */
  id?: string;
  marker?: ReactNode;
  meta?: ReactNode;
  selected?: boolean;
  state?: RoutePresentationState;
  tabIndex?: number;
  title: ReactNode;
  tone?: 'leg' | 'stop';
};

export function TimelineRow({
  actions,
  className,
  connector = 'both',
  description,
  id,
  marker,
  meta,
  selected = false,
  state,
  tabIndex,
  title,
  tone = 'stop',
}: Readonly<TimelineRowProps>) {
  const before = connector === 'before' || connector === 'both';
  const after = connector === 'after' || connector === 'both';

  return (
    <div
      className={cn(rowVariants({ tone }), selected && 'bg-secondary/70', className)}
      data-slot="timeline-row"
      data-state={state}
      data-tone={tone}
      id={id}
      role="listitem"
      tabIndex={tabIndex}
    >
      <div aria-hidden="true" className="flex flex-col items-center">
        <span className={cn('w-px flex-1 bg-border-subtle', !before && 'invisible')} />
        {marker}
        <span className={cn('w-px flex-1 bg-border-subtle', !after && 'invisible')} />
      </div>
      <div className={cn('min-w-0 self-center', tone === 'leg' ? 'py-2' : 'py-3')}>
        <div
          className={cn(
            'min-w-0 text-foreground',
            tone === 'leg' ? 'font-medium' : 'text-base font-medium',
          )}
        >
          {title}
        </div>
        {description ? (
          <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
        ) : null}
        {meta ? <div className={cn('mt-1 text-xs', stateVariants({ state }))}>{meta}</div> : null}
      </div>
      {actions ? <div className="flex items-center self-center py-2">{actions}</div> : null}
    </div>
  );
}

type RouteTimelineRowProps = {
  actions?: ReactNode;
  className?: string;
  connector?: 'after' | 'before' | 'both' | 'none';
  /** Why this leg exists, when that is not already obvious from the stops around it. */
  context?: ReactNode;
  metrics: string;
  modeLabel: string;
  state: RoutePresentationState;
  /** Only when the estimate is stale or missing — "current" is what silence means. */
  stateLabel?: string;
};

/**
 * A leg, led by what it costs rather than by where it runs.
 *
 * The old row put `origin → destination` on one nowrap line with both ends
 * truncating, inside a column a trailing control had already taken width from.
 * At 375px that gave each end about half of what it needed, so a leg's primary
 * label was reliably the one thing on the row you could not read — and the leg
 * role, which had been prefixed onto the origin string, was eaten first.
 *
 * Mode, duration and distance are a short fixed vocabulary that fits, so they
 * lead. Where the leg runs is already stated by the stops directly above and
 * below it; the only legs that say more are the ones whose reason for existing
 * is not visible from those stops, which is exactly the distinction PRD 18.4.1
 * asks a route row to make.
 */
export function RouteTimelineRow({
  actions,
  className,
  connector,
  context,
  metrics,
  modeLabel,
  state,
  stateLabel,
}: Readonly<RouteTimelineRowProps>) {
  return (
    <TimelineRow
      actions={actions}
      className={cn('bg-surface-tint/40', className)}
      connector={connector}
      description={context}
      marker={<TimelineMarker variant="leg" />}
      meta={stateLabel}
      state={state}
      title={
        <span className="flex flex-wrap items-baseline gap-x-1.5 tabular-nums">
          <span>{modeLabel}</span>
          <span aria-hidden="true" className="text-text-subtle">
            ·
          </span>
          <span className="text-muted-foreground">{metrics}</span>
        </span>
      }
      tone="leg"
    />
  );
}
