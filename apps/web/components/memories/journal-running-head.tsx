'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode, Ref } from 'react';

import { cn } from '@/lib/utils';

/**
 * The journal's header: Exit, and a running head the way a book has one.
 *
 * It rides over the cover while the cover - which carries the title itself -
 * is beneath it, then turns to paper and names the chapter being read.
 *
 * On a phone it is a bar across the top, under the status bar. Its rails are
 * equal so the running head stays on the screen's midline, and the right one
 * is left clear for the floating menu button, as Trip Mode's top bar leaves
 * it.
 *
 * From `md` it is a capsule floating on the page's centre line, no wider than
 * a line of reading, so the chapter's name never stretches across a wide
 * screen. Over the cover it is dark glass carrying Exit and, from `lg`, the
 * journal's own actions; past the cover it turns to paper and names the day.
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
  const motion =
    'transition-[background-color,border-color,box-shadow,color] duration-[var(--motion-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none';

  return (
    <header
      className={cn(
        // From `md` the main area's top padding is taken back, so the capsule
        // rests just under the app header, over the cover.
        'sticky top-[var(--header-offset)] z-[var(--layer-sticky)] -ms-[var(--gutter-inline-start)] -me-[var(--gutter-inline-end)] h-[var(--journal-head-height)] pt-[var(--safe-top)] md:pointer-events-none md:mx-0 md:-mt-12 md:flex md:items-center md:justify-center md:pt-0',
        'max-md:border-b',
        motion,
        overCover
          ? 'max-md:border-transparent max-md:bg-transparent'
          : 'max-md:border-border-subtle/80 max-md:bg-paper/92 max-md:backdrop-blur max-md:supports-[backdrop-filter]:bg-paper/80',
      )}
      data-slot="journal-running-head"
      data-translucent-surface
      ref={ref}
    >
      <div
        className={cn(
          'grid h-full grid-cols-[5rem_minmax(0,1fr)_5rem] items-center px-[max(var(--gutter-inline-start),var(--gutter-inline-end))]',
          'md:pointer-events-auto md:h-11 md:w-full md:max-w-2xl md:grid-cols-[minmax(4.5rem,1fr)_minmax(0,auto)_minmax(4.5rem,1fr)] md:gap-3 md:rounded-full md:border md:px-1.5',
          motion,
          overCover
            ? 'md:border-media-fallback-foreground/16 md:bg-neutral-950/40 md:text-media-fallback-foreground md:backdrop-blur-md'
            : 'md:border-border-subtle md:bg-paper/90 md:shadow-[var(--shadow-card)] md:backdrop-blur md:supports-[backdrop-filter]:bg-paper/80',
        )}
        data-slot="journal-running-head-bar"
      >
        <Link
          // The same control in the same place whether the header is over the
          // cover or over paper; only its colours change, so Exit never jumps.
          className={cn(
            'inline-flex min-h-11 items-center justify-self-start gap-1.5 rounded-full px-3 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-8',
            motion,
            'max-md:border',
            overCover
              ? 'max-md:border-media-fallback-foreground/18 max-md:bg-neutral-950/45 max-md:text-media-fallback-foreground max-md:backdrop-blur-sm max-md:hover:bg-neutral-950/65 md:text-media-fallback-foreground md:hover:bg-white/12'
              : 'max-md:border-transparent text-muted-foreground hover:text-foreground md:hover:bg-surface-hover',
          )}
          href={`/trips/${tripId}`}
        >
          <ArrowLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
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

        {/* Equal rails either side keep the running head on the midline. */}
        <div className="hidden items-center justify-self-end gap-1 lg:flex">{actions}</div>
      </div>
    </header>
  );
}
