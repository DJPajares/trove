'use client';

import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';

/**
 * A Memory with words and no photograph, kept as a field note: a slip of ruled
 * paper with a terracotta margin, the note written across its lines in the
 * journal's italic. Like a print, it opens the moment.
 */
export function JournalFieldNote({
  className,
  note,
  onOpen,
  tilt,
}: Readonly<{ className?: string; note: string; onOpen: () => void; tilt: number }>) {
  return (
    <button
      className={cn(
        'relative block w-full rotate-[var(--tilt)] rounded-[2px] bg-paper-print py-[1.125rem] ps-12 pe-6 text-start shadow-[var(--shadow-print)] outline-none transition-transform duration-[var(--motion-slow)] ease-[var(--ease-standard)] focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none [@media(hover:hover)]:hover:rotate-[calc(var(--tilt)*0.35)]',
        className,
      )}
      onClick={onOpen}
      style={{ '--tilt': `${tilt}deg` } as CSSProperties}
      type="button"
    >
      <span aria-hidden="true" className="absolute inset-y-0 start-8 w-px bg-accent-strong/55" />
      <span className="block bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_calc(2rem-1px),var(--paper-rule)_calc(2rem-1px),var(--paper-rule)_2rem)] font-journal text-[1.375rem] leading-[2rem] font-normal whitespace-pre-wrap text-pretty text-foreground italic [overflow-wrap:anywhere]">
        {note}
      </span>
    </button>
  );
}
