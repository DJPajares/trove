'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { MediaFrame } from '@/components/media-frame';
import { COVER_BLEED, COVER_HEIGHT, MEASURE, SCRIM } from '@/components/saved/finds-cover';
import { useCoverUnderHeader } from '@/hooks/use-cover-under-header';
import { dayHeaderFallback } from '@/lib/media/day-header-fallback';
import type { TripMediaSource } from '@/lib/media/trip-media';
import { pageEntrance } from '@/lib/page-entrance';
import { cn } from '@/lib/utils';

export type KitShortcut = {
  detail: string;
  /** The detail is a caution, such as a rate that may have changed. */
  detailWarning?: boolean;
  href: string;
  icon: ReactNode;
  title: string;
};

/**
 * The top of Kit, in the same frame as Home, Trips and Finds. With a trip
 * ahead it is that trip's photograph and countdown, and the two things this
 * page does for it - its currency, and a checklist - sit on the photograph as
 * glass cards, a tap each. With no trip ahead it is Trove's bundled artwork and
 * the page's own name.
 */
export function KitCover({
  description,
  destination,
  enter,
  lead,
  media,
  shortcuts,
  title,
}: Readonly<{
  description: string;
  /** Where the next trip goes, set large; null with no trip ahead. */
  destination: string | null;
  /** The page's entrance, already decided for this mount. */
  enter: boolean;
  /** The countdown line above the destination. */
  lead: string | null;
  media: TripMediaSource | null;
  shortcuts: KitShortcut[];
  title: string;
}>) {
  const t = useTranslations('tools.cover');
  useCoverUnderHeader();
  const trip = destination !== null;

  return (
    <section
      aria-labelledby="kit-heading"
      className={cn(
        'relative isolate flex flex-col justify-end overflow-hidden bg-surface-media text-white',
        COVER_BLEED,
        COVER_HEIGHT,
      )}
      data-slot="kit-cover"
    >
      <MediaFrame
        alt=""
        className={cn(
          'absolute inset-0 -z-20 h-full w-full rounded-none',
          enter && pageEntrance.media,
        )}
        dataSlot="kit-cover-media"
        photographicPlaceholder={media ? undefined : dayHeaderFallback.preview}
        preload
        sizes="100vw"
        source={media ?? { kind: 'local', src: dayHeaderFallback.src }}
        variant="cover"
      />
      <div aria-hidden="true" className={SCRIM} />

      {trip ? (
        // The page names itself where Home shows the weather on a phone; from
        // `md` the header's own "Kit" does.
        <h1
          className="absolute start-[var(--gutter-inline-start)] top-[calc(var(--safe-top)+0.75rem)] z-20 flex h-11 items-center text-base font-semibold tracking-[-0.01em] md:sr-only"
          id="kit-heading"
        >
          {title}
        </h1>
      ) : null}

      <div className={MEASURE}>
        <div
          className={cn(
            'mx-auto w-full max-w-5xl pt-[calc(var(--safe-top)+5rem)] pb-16 md:pt-[calc(var(--safe-top)+var(--header-height)+3rem)] md:pb-24',
            enter && pageEntrance.rise,
          )}
        >
          {trip ? (
            <>
              <p className="text-[0.6875rem] font-semibold tracking-[0.14em] text-white/80 uppercase">
                {t('kicker')}
              </p>
              {lead ? <p className="mt-3 text-base text-white/85 tabular-nums">{lead}</p> : null}
              <h2 className="mt-1 max-w-[14ch] font-journal text-[clamp(3.25rem,14vw,5.5rem)] leading-[0.92] font-normal tracking-[-0.01em] text-balance [overflow-wrap:anywhere]">
                {destination}
              </h2>
              {shortcuts.length ? (
                <ul className="mt-6 grid max-w-2xl gap-2.5 sm:grid-cols-2">
                  {shortcuts.map((shortcut) => (
                    <li className="min-w-0" key={shortcut.href}>
                      <GlassShortcut shortcut={shortcut} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <div className="space-y-3">
              <h1
                className="font-journal text-[clamp(3rem,12vw,5rem)] leading-[0.95] font-normal tracking-[-0.01em]"
                id="kit-heading"
              >
                {title}
              </h1>
              <p className="max-w-md text-base leading-[1.55] text-pretty text-white/90">
                {description}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** A shortcut set on the photograph: frosted glass, the way into one tool. */
function GlassShortcut({ shortcut }: Readonly<{ shortcut: KitShortcut }>) {
  return (
    <Link
      className="flex min-h-14 items-center gap-3 rounded-[var(--radius-xl)] border border-white/20 bg-white/12 px-3.5 py-2.5 text-white backdrop-blur-md outline-none transition-colors duration-[var(--motion-standard)] hover:bg-white/20 focus-visible:ring-3 focus-visible:ring-white/70 motion-reduce:transition-none"
      href={shortcut.href}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-white/14">
        {shortcut.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold tabular-nums">{shortcut.title}</span>
        <span
          className={cn(
            'block truncate text-sm',
            shortcut.detailWarning ? 'text-[oklch(0.86_0.12_80)]' : 'text-white/75',
          )}
        >
          {shortcut.detail}
        </span>
      </span>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-white/70" />
    </Link>
  );
}
