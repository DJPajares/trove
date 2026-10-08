'use client';

import { Plus } from 'lucide-react';

import { cn } from '@/lib/utils';

import { SpineRow, type SpineLine } from './spine';

/**
 * A "+" on the day's spine: add a stop exactly here. It sits where the new
 * stop would go - on the leg it would split, or in the gap between two stops
 * when no leg is shown - so where it lands is never a question. Small to the
 * eye, but its hit area is a full 44px.
 */
export function InsertButton({
  className,
  label,
  onInsert,
}: Readonly<{ className?: string; label: string; onInsert: () => void }>) {
  return (
    <button
      aria-label={label}
      className={cn(
        'relative z-10 grid size-6 shrink-0 place-items-center rounded-full border border-border-strong/70 bg-background text-muted-foreground outline-none transition-colors duration-[var(--motion-fast)] after:absolute after:-inset-2.5 hover:border-primary hover:bg-primary hover:text-primary-foreground focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none',
        className,
      )}
      data-slot="insert-stop"
      onClick={onInsert}
      title={label}
      type="button"
    >
      <Plus aria-hidden="true" className="size-3.5" />
    </button>
  );
}

/** A gap between two rows with nothing in it but the way to add a stop there. */
export function InsertGap({
  above,
  below = above,
  label,
  onInsert,
}: Readonly<{ above: SpineLine; below?: SpineLine; label: string; onInsert: () => void }>) {
  return (
    <SpineRow
      above={above}
      align="center"
      below={below}
      className="min-h-8"
      marker={<InsertButton label={label} onInsert={onInsert} />}
    >
      {null}
    </SpineRow>
  );
}
