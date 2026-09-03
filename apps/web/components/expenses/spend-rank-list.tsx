'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The column template every spending row shares.
 *
 * A fixed bar column is not enough on its own: put a variable-width amount after
 * it and the bar slides left and right by however wide that amount happens to
 * be, so no two rows line up. Fixing both columns is what makes the bars read as
 * one chart rather than as a stack of unrelated widths.
 *
 * The bar is hidden below `sm` and `display: none` takes it out of grid flow, so
 * the narrow breakpoint has exactly two items for its two columns.
 */
export const SPEND_ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_6rem_7rem]';

export type SpendRankRow = {
  /** The tint the bar is filled with, as a complete Tailwind class. */
  barClassName: string;
  count: number;
  icon?: ReactNode;
  id: string;
  label: string;
  /** Already formatted; this component never decides how money reads. */
  amount: string;
  /** 0-1 of the trip's spending. */
  share: number;
};

/**
 * A ranked list of where money went, shared by the category and place views so
 * the two stay visually identical rather than merely similar.
 *
 * The bars are decoration: each one is `aria-hidden`, and the amount and share
 * beside it carry the meaning - the same division of labour as the Plan Score
 * meters. Fifteen `progressbar` roles in a column would be noise to anyone
 * listening to the page rather than looking at it.
 */
export function SpendRankList({
  activeId,
  emptyLabel,
  onSelect,
  rowLabel,
  rows,
}: Readonly<{
  activeId: string | null;
  emptyLabel: string;
  onSelect: (id: string) => void;
  /** A full sentence describing one row, for anyone not seeing the bar. */
  rowLabel: (row: SpendRankRow) => string;
  rows: readonly SpendRankRow[];
}>) {
  if (!rows.length) {
    return <p className="py-2 text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  // Widths are relative to the biggest row rather than to the trip, or a long
  // trip's rows would all be slivers and the ranking would stop being readable.
  const largest = Math.max(...rows.map((row) => row.share), 0);

  return (
    <ul className="space-y-0.5">
      {rows.map((row) => {
        const active = row.id === activeId;

        return (
          <li key={row.id}>
            <button
              aria-label={rowLabel(row)}
              aria-pressed={active}
              className={cn(
                SPEND_ROW_GRID,
                'min-h-11 w-full items-center gap-3 rounded-[var(--radius-md)] px-2 py-1.5 text-left outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40',
                active && 'bg-secondary',
              )}
              onClick={() => onSelect(row.id)}
              type="button"
            >
              <span className="flex min-w-0 items-center gap-2">
                {row.icon ? (
                  <span className="shrink-0 text-muted-foreground [&_svg]:size-4">{row.icon}</span>
                ) : null}
                <span className="min-w-0 flex-1 truncate text-sm">{row.label}</span>
              </span>
              <span
                aria-hidden="true"
                className="hidden h-1.5 self-center overflow-hidden rounded-full bg-muted sm:block"
              >
                <span
                  className={cn(
                    'block h-full rounded-full transition-[width] duration-[var(--motion-slow)] ease-[var(--ease-standard)] motion-reduce:transition-none',
                    row.barClassName,
                  )}
                  style={{ width: `${largest > 0 ? Math.round((row.share / largest) * 100) : 0}%` }}
                />
              </span>
              <span className="text-right text-sm font-medium tabular-nums">{row.amount}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
