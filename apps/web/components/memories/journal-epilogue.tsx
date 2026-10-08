'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { BrandMark } from '@/components/brand-logo';
import { ExperienceRatingMark } from '@/components/experience-rating';
import { buttonVariants } from '@/components/ui/button';
import type { Trip } from '@/lib/trips/api';

/**
 * The end of the journal. If the traveller has said how the trip felt - its
 * rating, the note they wrote with it - that is the last thing on the page,
 * set as closing words. It only reads them: the trip's one rating control is
 * on the cover, so nothing here asks for anything. Then the Keepsake as an end
 * mark, the privacy line as a colophon, and the way back to the trip.
 */
export function JournalEpilogue({ trip }: Readonly<{ trip: Trip }>) {
  const t = useTranslations('memories.journal');
  const note = trip.experienceNote?.trim();
  const rating = trip.experienceRating;

  return (
    <footer className="mx-auto flex max-w-[36rem] flex-col items-center gap-8 text-center">
      {rating !== null || note ? (
        <section aria-labelledby="journal-epilogue-title" className="space-y-4">
          <h2
            className="text-[0.68rem] font-semibold tracking-[0.2em] text-accent-strong uppercase"
            id="journal-epilogue-title"
          >
            {t('epilogue')}
          </h2>
          {rating !== null ? (
            <ExperienceRatingMark
              className="justify-center"
              rating={rating}
              wordClassName="font-journal text-[2rem] leading-none font-normal italic text-foreground"
            />
          ) : null}
          {note ? (
            <p className="font-journal text-2xl leading-[1.4] font-normal whitespace-pre-wrap text-pretty text-foreground italic [overflow-wrap:anywhere]">
              {note}
            </p>
          ) : null}
        </section>
      ) : null}

      <BrandMark aria-hidden="true" className="size-7 text-muted-foreground" tone="mono" />

      <div className="space-y-3">
        <p className="text-xs leading-5 text-muted-foreground">{t('privacyNote')}</p>
        <Link
          className={buttonVariants({ size: 'sm', variant: 'ghost' })}
          href={`/trips/${trip.id}`}
        >
          {t('backToTrip')}
        </Link>
      </div>
    </footer>
  );
}
