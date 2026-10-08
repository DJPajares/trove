'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode, Ref } from 'react';

import { cn } from '@/lib/utils';

/**
 * The journal's header: Exit, and a running head the way a book has one.
 *
 * It rides over the cover, see-through, while the cover - which carries the
 * title itself - is beneath it, then turns to paper and names the chapter
 * being read. The rails either side are equal so the running head stays on
 * the screen's midline, and on a phone the right rail is left clear for the
 * floating menu button, exactly as Trip Mode's top bar leaves it. From `lg`
 * that rail is free, and the journal's own actions take it.
 *
 * Exit goes back to the trip this journal belongs to, from which the global
 * navigation is one tap away (PRD 4.5).
 */
export function JournalRunningHead({
  actions,
  overCover,
  ref,
  title,
  tripId,
}: Readonly<{
  /** The journal's own actions, shown in the header from `lg` up. */
  actions?: ReactNode;
  overCover: boolean;
  ref?: Ref<HTMLElement>;
  /** What the running head reads once the cover has passed. */
  title: string | null;
  tripId: string;
}>) {
  const t = useTranslations('memories.journal');

  return (
    <header
      className={cn(
        'sticky top-[var(--header-offset)] z-[var(--layer-sticky)] -ms-[var(--gutter-inline-start)] -me-[var(--gutter-inline-end)] grid h-[var(--journal-head-height)] grid-cols-[5rem_minmax(0,1fr)_5rem] items-center px-[max(var(--gutter-inline-start),var(--gutter-inline-end))] pt-[var(--safe-top)] transition-[background-color,border-color,box-shadow] duration-[var(--motion-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none md:mx-0 md:pt-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)] lg:px-4',
        overCover
          ? 'border-b border-transparent bg-transparent'
          : 'border-b border-border-subtle/80 bg-paper/92 backdrop-blur supports-[backdrop-filter]:bg-paper/80',
      )}
      data-slot="journal-running-head"
      data-translucent-surface
      ref={ref}
    >
      <Link
        // The same pill in the same place whether the header is over the cover
        // or over paper; only its colours change, so Exit never jumps.
        className={cn(
          'inline-flex min-h-11 items-center justify-self-start gap-1.5 rounded-full border px-3 text-sm font-medium outline-none transition-colors duration-[var(--motion-standard)] ease-[var(--ease-standard)] focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none',
          overCover
            ? 'border-media-fallback-foreground/18 bg-neutral-950/45 text-media-fallback-foreground backdrop-blur-sm hover:bg-neutral-950/65'
            : 'border-transparent text-muted-foreground hover:text-foreground',
        )}
        href={`/trips/${tripId}`}
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('exit')}
      </Link>

      <p
        aria-hidden={overCover || !title}
        className={cn(
          'min-w-0 truncate text-center font-journal text-[1.0625rem] font-normal italic text-foreground transition-opacity duration-[var(--motion-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none',
          overCover || !title ? 'opacity-0' : 'opacity-100',
        )}
      >
        {title}
      </p>

      <div className="hidden items-center justify-self-end gap-1 lg:flex">{actions}</div>
    </header>
  );
}
