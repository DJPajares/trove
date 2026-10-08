import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * A day laid out: the day itself - its header, its timeline and what follows -
 * and the map beside it from `lg`. On a phone the map takes the day's place
 * only while it is open, so the day is hidden rather than unmounted and comes
 * back exactly where the traveller left it.
 */
export function PlannerDayView({
  children,
  map,
  phoneMapOpen,
}: Readonly<{ children: ReactNode; map: ReactNode; phoneMapOpen: boolean }>) {
  return (
    <div
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.85fr)] lg:items-start lg:gap-8"
      data-slot="planner-day"
    >
      <div className={cn('min-w-0 space-y-6', phoneMapOpen && 'hidden lg:block')}>{children}</div>
      {map}
    </div>
  );
}
