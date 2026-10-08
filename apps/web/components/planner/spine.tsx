import type { CSSProperties, ReactNode, Ref } from 'react';

import { cn } from '@/lib/utils';

export type SpineLine = 'dashed' | 'none' | 'solid';

function Segment({ className, line }: Readonly<{ className?: string; line: SpineLine }>) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'w-0 border-l',
        line === 'solid' && 'border-border-strong/70',
        line === 'dashed' && 'border-dashed border-border-strong',
        line === 'none' && 'border-transparent',
        className,
      )}
    />
  );
}

/**
 * One row of the day on its spine: a line that runs down the left of the whole
 * day, a mark where this row sits on it, and the row itself.
 *
 * The line is drawn per row, above and below the mark, so the day reads as one
 * continuous route however its rows are shaped - and so a stretch can change
 * its style: dashed where the day leaves or returns to its Stay, solid between
 * stops, the same distinction the legs make in words (PRD 18.4.1).
 *
 * `align` puts the mark level with a card's title (`top`) or in the middle of a
 * short row (`center`), which is what a leg is.
 */
export function SpineRow({
  above = 'solid',
  align = 'top',
  below = 'solid',
  children,
  className,
  id,
  marker,
  ref,
  style,
  tabIndex,
}: Readonly<{
  above?: SpineLine;
  align?: 'center' | 'top';
  below?: SpineLine;
  children: ReactNode;
  className?: string;
  id?: string;
  marker?: ReactNode;
  /** A stop that can be dragged is measured and moved through these. */
  ref?: Ref<HTMLLIElement>;
  style?: CSSProperties;
  tabIndex?: number;
}>) {
  return (
    <li
      className={cn('grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 outline-none', className)}
      data-slot="planner-row"
      id={id}
      ref={ref}
      style={style}
      tabIndex={tabIndex}
    >
      <div className="flex flex-col items-center">
        <Segment className={align === 'top' ? 'h-4 shrink-0' : 'flex-1'} line={above} />
        {marker ?? <Segment className="h-1.5 shrink-0" line={above === 'none' ? below : above} />}
        <Segment className="flex-1" line={below} />
      </div>
      <div className="min-w-0">{children}</div>
    </li>
  );
}
