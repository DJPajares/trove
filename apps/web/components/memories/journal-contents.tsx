'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';

import { MediaFrame } from '@/components/media-frame';
import { Chip, ChipGroup } from '@/components/ui/chip';
import type { MemoryPhoto } from '@/lib/memories/api';
import type { JournalContentsDay, JournalLens } from '@/lib/memories/journal';
import { printTilts } from '@/lib/memories/photo-layout';
import type { RouteSketch } from '@/lib/maps/route-sketch';
import { cn } from '@/lib/utils';
import * as Icons from '@/lib/icons';

/** A ChipGroup value has to be a string; no real lens id is ever this literal. */
const ALL_LENS_VALUE = '__all__';

export type JournalLensChip = {
  count: number;
  highlight?: boolean;
  id: JournalLens;
  label: string;
};

function weekdayAndDate(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    timeZone: 'UTC',
    weekday: 'short',
  }).format(new Date(`${date}T00:00:00.000Z`));
}

/**
 * The route, drawn: one ink line through the places Memories were kept at, in
 * the order they were kept, with a mark at each. Decorative - the days above
 * it are how the journal is navigated - so it is hidden from assistive tech.
 */
function JournalRouteSketch({ sketch }: Readonly<{ sketch: RouteSketch }>) {
  const reduced = useReducedMotion();
  const last = sketch.points.at(-1);
  const first = sketch.points[0];

  return (
    <svg
      aria-hidden="true"
      className="h-auto w-full max-w-xl text-muted-foreground"
      data-slot="journal-route-sketch"
      viewBox={`0 0 ${sketch.width} ${sketch.height}`}
    >
      <motion.path
        d={sketch.path}
        fill="none"
        initial={reduced ? false : { pathLength: 0 }}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.25"
        transition={reduced ? { duration: 0 } : { duration: 1.6, ease: [0.65, 0, 0.35, 1] }}
        viewport={{ margin: '-40px', once: true }}
        whileInView={{ pathLength: 1 }}
      />
      {sketch.points.map((point, index) => (
        <circle
          className="text-accent-strong"
          cx={point.x}
          cy={point.y}
          fill="currentColor"
          key={`${point.x}-${point.y}-${index}`}
          r={2.25}
        />
      ))}
      {first ? (
        <circle
          className="text-accent-strong"
          cx={first.x}
          cy={first.y}
          fill="none"
          r={5.5}
          stroke="currentColor"
          strokeWidth="1"
        />
      ) : null}
      {last ? (
        <circle
          className="text-accent-strong"
          cx={last.x}
          cy={last.y}
          fill="none"
          r={5.5}
          stroke="currentColor"
          strokeWidth="1"
        />
      ) : null}
    </svg>
  );
}

function StripPrint({
  memoryId,
  onPhotoError,
  photo,
}: Readonly<{
  memoryId: string;
  onPhotoError: (photo: MemoryPhoto) => void;
  photo: MemoryPhoto;
}>) {
  const [tilt] = printTilts(memoryId, 1);

  return (
    <span
      className="block rotate-[var(--tilt)] rounded-[2px] bg-paper-print p-1 pb-2 shadow-[var(--shadow-print)] transition-transform duration-[var(--motion-standard)] ease-[var(--ease-standard)] group-hover/day:rotate-0 motion-reduce:transition-none"
      style={{ '--tilt': `${(tilt ?? 0) * 1.5}deg` } as CSSProperties}
    >
      <MediaFrame
        alt=""
        className="aspect-[4/5] rounded-[1px]"
        dataSlot="journal-strip-print"
        onUnreachable={() => onPhotoError(photo)}
        sizes="5rem"
        source={photo.url ? { kind: 'memory', url: photo.url } : { kind: 'fallback' }}
        variant="card"
      />
    </span>
  );
}

/**
 * The contents: every day of the trip in a strip, each as the photograph it is
 * remembered by, or a faint date stamp when nothing was kept - the trip's shape
 * at a glance, felt through its progression rather than counted (PRD 31.2).
 * Beneath it, the ways into the journal (Highlights, each Place), which filter
 * the one reading flow rather than listing it again.
 */
export function JournalContents({
  contents,
  lens,
  lensChips,
  onJump,
  onLensChange,
  onPhotoError,
  sketch,
}: Readonly<{
  contents: JournalContentsDay[];
  lens: JournalLens;
  lensChips: JournalLensChip[];
  onJump: (anchorId: string) => void;
  onLensChange: (chip: JournalLensChip) => void;
  onPhotoError: (photo: MemoryPhoto) => void;
  sketch: RouteSketch | null;
}>) {
  const t = useTranslations('memories.journal');
  const locale = useLocale();

  return (
    <section
      aria-labelledby="journal-contents-title"
      className="scroll-mt-[calc(var(--header-offset)+var(--journal-head-height)+1rem)] space-y-6"
      data-journal-contents
      id="journal-contents"
    >
      <h2
        className="font-journal text-[1.75rem] leading-none font-normal italic text-foreground outline-none scroll-mt-[calc(var(--header-offset)+var(--journal-head-height)+1.5rem)]"
        id="journal-contents-title"
        tabIndex={-1}
      >
        {t('days')}
      </h2>

      <nav aria-label={t('daysLabel')}>
        <ol className="interaction-scrollbar -mx-[var(--gutter-inline-start)] flex snap-x snap-mandatory gap-3 overflow-x-auto px-[var(--gutter-inline-start)] pt-2 pb-4 md:mx-0 md:px-1">
          {contents.map((entry) => {
            const label = entry.day.dayNumber
              ? t('dayNumber', { number: entry.day.dayNumber })
              : weekdayAndDate(entry.day.date, locale);

            return (
              <li className="snap-start" key={entry.day.date}>
                <a
                  className={cn(
                    'group/day relative flex w-[4.75rem] flex-col items-center gap-2 rounded-[var(--radius-md)] px-1 pt-1 pb-2 text-center outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                    entry.hasChapter ? 'text-foreground' : 'text-muted-foreground',
                  )}
                  href={`#${entry.anchorId}`}
                  onClick={(event) => {
                    event.preventDefault();
                    onJump(entry.anchorId);
                  }}
                >
                  {entry.leadPhoto ? (
                    <StripPrint
                      memoryId={entry.leadPhoto.memoryId}
                      onPhotoError={onPhotoError}
                      photo={entry.leadPhoto.photo}
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex aspect-[4/5] w-full flex-col items-center justify-center rounded-[2px] font-journal text-2xl',
                        entry.hasChapter
                          ? 'bg-paper-print text-accent-strong shadow-[var(--shadow-print)]'
                          : 'border border-dashed border-muted-foreground/45 text-muted-foreground',
                      )}
                    >
                      {entry.day.date.slice(8).replace(/^0/, '')}
                    </span>
                  )}
                  <span className="flex flex-col items-center leading-tight">
                    <span className="text-[0.65rem] font-semibold tracking-[0.16em] uppercase">
                      {entry.day.isToday ? t('today') : label}
                    </span>
                    <span className="text-[0.7rem] text-muted-foreground tabular-nums">
                      {weekdayAndDate(entry.day.date, locale)}
                    </span>
                  </span>
                  <span className="sr-only">
                    {entry.hasChapter
                      ? t('memoryCount', { count: entry.memoryCount })
                      : t('nothingKept')}
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
      </nav>

      {sketch ? <JournalRouteSketch sketch={sketch} /> : null}

      {lensChips.length > 1 ? (
        <ChipGroup
          aria-label={t('lensLabel')}
          className="interaction-scrollbar -m-1 flex-nowrap overflow-x-auto p-1 pr-6 [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] [&>*]:shrink-0"
          multiple={false}
          onValueChange={([value]) => {
            const chip = lensChips.find((candidate) => (candidate.id ?? ALL_LENS_VALUE) === value);
            if (chip) onLensChange(chip);
          }}
          value={[lens ?? ALL_LENS_VALUE]}
        >
          {lensChips.map((chip) => (
            <Chip
              aria-label={`${chip.label}, ${t('memoryCount', { count: chip.count })}`}
              className="bg-paper-print data-[pressed]:bg-brand/15"
              icon={chip.highlight ? <Icons.Highlight aria-hidden="true" /> : undefined}
              key={chip.id ?? ALL_LENS_VALUE}
              value={chip.id ?? ALL_LENS_VALUE}
            >
              {chip.label}
            </Chip>
          ))}
        </ChipGroup>
      ) : null}
    </section>
  );
}
