import { cva } from 'class-variance-authority';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

import type { RoutePresentationState } from '@/lib/itinerary/route-presentation';
import { cn } from '@/lib/utils';

type TimelineRowProps = {
  actions?: ReactNode;
  className?: string;
  connector?: 'after' | 'before' | 'both' | 'none';
  description?: ReactNode;
  marker?: ReactNode;
  meta?: ReactNode;
  state?: RoutePresentationState;
  title: ReactNode;
};

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

export function TimelineRow({
  actions,
  className,
  connector = 'both',
  description,
  marker,
  meta,
  state = 'estimated',
  title,
}: Readonly<TimelineRowProps>) {
  const before = connector === 'before' || connector === 'both';
  const after = connector === 'after' || connector === 'both';

  return (
    <div
      className={cn(
        'group/timeline-row grid min-h-14 grid-cols-[2rem_minmax(0,1fr)_auto] gap-x-3 text-sm',
        className,
      )}
      data-slot="timeline-row"
      data-state={state}
      role="listitem"
    >
      <div aria-hidden="true" className="row-span-2 flex flex-col items-center">
        <span className={cn('w-px flex-1 bg-border-subtle', !before && 'invisible')} />
        <span className="grid size-7 shrink-0 place-items-center rounded-full border border-border-strong bg-background text-brand shadow-[var(--shadow-control)]">
          {marker}
        </span>
        <span className={cn('w-px flex-1 bg-border-subtle', !after && 'invisible')} />
      </div>
      <div className="min-w-0 self-center py-3">
        <div className="min-w-0 font-medium text-foreground">{title}</div>
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
  destination: string;
  metrics: string;
  mode: ReactNode;
  origin: string;
  state: RoutePresentationState;
  stateLabel: string;
};

export function RouteTimelineRow({
  actions,
  className,
  destination,
  metrics,
  mode,
  origin,
  state,
  stateLabel,
}: Readonly<RouteTimelineRowProps>) {
  return (
    <TimelineRow
      actions={actions}
      className={cn('border-y border-border-subtle bg-surface-tint/55 px-2', className)}
      description={<span className="font-medium tabular-nums text-foreground">{metrics}</span>}
      marker={mode}
      meta={stateLabel}
      state={state}
      title={
        <span className="inline-flex max-w-full items-center gap-1.5">
          <span className="truncate">{origin}</span>
          <ArrowRight aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">{destination}</span>
        </span>
      }
    />
  );
}
