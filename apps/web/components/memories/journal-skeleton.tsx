'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import {
  JOURNAL_COVER_FRAME,
  JOURNAL_COVER_HEIGHT,
  JOURNAL_SHEET,
} from '@/components/memories/journal-cover';
import { JournalRunningHead } from '@/components/memories/journal-running-head';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The journal's frame before anything has arrived: the header and a cover
 * box at their final sizes, so what loads fills the frame rather than pushing
 * it (PRD 4.4). The route's loading file and the journal itself draw this same
 * frame, so the way in shows one shape, not two.
 */
export function JournalSkeleton() {
  const t = useTranslations('memories.journal');
  const params = useParams<{ tripId: string }>();

  return (
    <div
      aria-busy="true"
      className="mx-auto w-full max-w-5xl [--journal-head-height:calc(var(--safe-top)+4.25rem)] md:[--journal-head-height:3.25rem]"
      data-slot="journal-skeleton"
    >
      <span className="sr-only" role="status">
        {t('loading')}
      </span>
      <JournalRunningHead overCover title={null} tripId={params.tripId} />
      <div className={JOURNAL_COVER_FRAME}>
        <Skeleton className={`w-full rounded-none ${JOURNAL_COVER_HEIGHT}`} />
      </div>
      <div className={`${JOURNAL_SHEET} space-y-4 pt-12`} data-slot="journal-sheet">
        <Skeleton className="h-7 w-32" />
        <div className="flex gap-3">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton className="aspect-[4/5] w-[4.75rem] rounded-[2px]" key={index} />
          ))}
        </div>
      </div>
    </div>
  );
}
