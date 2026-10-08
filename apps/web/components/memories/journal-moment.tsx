'use client';

import { useTranslations } from 'next-intl';

import { JournalFieldNote } from '@/components/memories/journal-field-note';
import { JournalPrint } from '@/components/memories/journal-print';
import type { Memory, MemoryPhoto } from '@/lib/memories/api';
import { printTilts, selectPhotoLayout } from '@/lib/memories/photo-layout';
import { cn } from '@/lib/utils';
import * as Icons from '@/lib/icons';

const PRINT_SIZES = '(max-width: 640px) 88vw, 36rem';
const STRIP_SIZES = '(max-width: 640px) 40vw, 14rem';

/**
 * One kept moment, read rather than logged: the traveller's photographs first,
 * laid down as prints, then what they wrote in the journal's hand, then the
 * quiet context - when, and where - beneath it rather than above it as a
 * heading (PRD 31.2).
 *
 * The prints' arrangement is chosen once from the Memory's own id, so a moment
 * looks the same on every visit and no two neighbours read as one template
 * repeated. Moments lean to alternate sides down the page. Every print, and a
 * note with no photograph, opens the moment; this is the one place a Memory is
 * drawn, so it carries the anchor a search result points at.
 */
export function JournalMoment({
  context,
  focused,
  lean,
  memory,
  onOpen,
  onPhotoError,
}: Readonly<{
  /** When and where, already composed: "4:12 PM · Fushimi Inari". */
  context: string;
  focused: boolean;
  lean: 'end' | 'start';
  memory: Memory;
  onOpen: (photoIndex: number) => void;
  onPhotoError: (photo: MemoryPhoto) => void;
}>) {
  const t = useTranslations('memories.journal');
  const photos = memory.photos;
  const tilts = printTilts(memory.id, Math.max(1, photos.length));
  const template = selectPhotoLayout(memory.id, photos.length);
  const label = (index: number) => t('openPhoto', { count: photos.length, index: index + 1 });
  const print = (photo: MemoryPhoto, index: number, aspect: string) => (
    <JournalPrint
      aspect={aspect}
      label={label(index)}
      lip={index === 0 && template?.kind !== 'pair'}
      onOpen={() => onOpen(index)}
      onPhotoError={onPhotoError}
      photo={photo}
      sizes={index === 0 || template?.kind === 'pair' ? PRINT_SIZES : STRIP_SIZES}
      tilt={tilts[index] ?? 0}
    />
  );

  return (
    <article
      className={cn(
        'w-full scroll-mt-[calc(var(--header-offset)+var(--journal-head-height)+2rem)] rounded-[var(--radius-lg)] outline-none sm:w-[88%]',
        lean === 'end' ? 'sm:ms-auto' : 'sm:me-auto',
        focused && 'ring-2 ring-accent-strong/45 ring-offset-8 ring-offset-paper',
      )}
      data-slot="journal-moment"
      id={`memory-${memory.id}`}
      tabIndex={-1}
    >
      {template?.kind === 'single' && photos[0] ? print(photos[0], 0, template.aspect) : null}

      {template?.kind === 'pair' ? (
        // A pair laid down by hand: the second print overlaps the first and
        // sits a little lower, leaning the other way.
        <div className="grid grid-cols-2 items-start px-1">
          {photos.map((photo, index) => (
            <div className={index === 1 ? '-ms-[16%] mt-[18%]' : undefined} key={photo.id}>
              {print(photo, index, template.aspect)}
            </div>
          ))}
        </div>
      ) : null}

      {template?.kind === 'spread' && photos[0] ? (
        <div className="space-y-4">
          {print(photos[0], 0, template.leadAspect)}
          <ul className="interaction-scrollbar flex snap-x snap-mandatory gap-5 overflow-x-auto px-2 py-4">
            {photos.slice(1).map((photo, offset) => (
              <li className="w-[44%] shrink-0 snap-start sm:w-[36%]" key={photo.id}>
                {print(photo, offset + 1, template.stripAspect)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!photos.length && memory.note ? (
        <JournalFieldNote note={memory.note} onOpen={() => onOpen(0)} tilt={tilts[0] ?? 0} />
      ) : null}

      {photos.length && memory.note ? (
        <p className="mt-5 font-journal text-[1.375rem] leading-[1.4] font-normal whitespace-pre-wrap text-pretty text-foreground italic [overflow-wrap:anywhere]">
          {memory.note}
        </p>
      ) : null}

      <p
        className={cn(
          'flex items-center gap-2 text-[0.68rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase',
          photos.length && memory.note ? 'mt-2' : 'mt-4',
        )}
      >
        {memory.isHighlight ? (
          <>
            <Icons.Highlight aria-hidden="true" className="size-3 shrink-0 text-accent-strong" />
            <span className="sr-only">{t('highlight')}</span>
          </>
        ) : null}
        <span className="min-w-0 truncate">{context}</span>
      </p>
    </article>
  );
}
