'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { ExperienceRatingMark } from '@/components/experience-rating';
import { JourneyPrintFan } from '@/components/journey-prints';
import { Button } from '@/components/ui/button';
import type { CompletedPromptKey } from '@/lib/home/completed-prompt';
import type { HomeJourney as HomeJourneyModel } from '@/lib/home/moment';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import type { Trip } from '@/lib/trips/api';
import { tripDayCount } from '@/lib/trips/facts';
import { cn } from '@/lib/utils';

const EYEBROW =
  'text-[length:var(--text-metadata)] font-semibold tracking-[0.12em] text-accent-strong uppercase';

function monthYear(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(`${date}T00:00:00.000Z`));
}

type HomeJourneyProps = {
  editorial: EditorialImageReference | null;
  trip: Trip;
} & (
  | {
      /** A past trip offered to return to, under its own name. */
      journey: HomeJourneyModel;
      variant: 'journey';
    }
  | {
      /** The trip Home leads with, just finished; the page's heading names it. */
      onDismissPrompt: (tripId: string) => void;
      promptKey: CompletedPromptKey | null;
      variant: 'returned';
    }
);

/**
 * A finished trip on Home, in the Memories journal's voice - its paper, its
 * serif, its prints - so the step from here into the story is no step at all.
 *
 * Two uses. A trip the traveller is just back from leads Home this way (PRD
 * 9.4): its photographs, their own words about it, and - once, dismissibly -
 * the Memories or rating it is still missing. Otherwise it is a past journey
 * offered to return to, and a trip taken this week in an earlier year is
 * offered as exactly that.
 */
export function HomeJourney(props: Readonly<HomeJourneyProps>) {
  const { editorial, trip } = props;
  const t = useTranslations('home.journey');
  const homeT = useTranslations('home');
  const itineraryT = useTranslations('itinerary');
  const locale = useLocale();
  const returned = props.variant === 'returned';
  const line = trip.experienceNote?.trim() || trip.description?.trim() || null;
  const headingId = returned ? 'home-heading' : 'home-journey-heading';

  const eyebrow = returned
    ? `${monthYear(trip.startDate, locale)} · ${itineraryT('dayCount', { count: tripDayCount(trip) })}`
    : props.journey.kind === 'anniversary'
      ? t('anniversary', { years: props.journey.years })
      : t('eyebrow');

  return (
    <section
      aria-labelledby={headingId}
      className="-ms-[var(--gutter-inline-start)] -me-[var(--gutter-inline-end)] bg-paper ps-[var(--gutter-inline-start)] pe-[var(--gutter-inline-end)] py-10 md:mx-0 md:rounded-[var(--radius-2xl)] md:px-10 md:py-12"
      data-slot={returned ? 'home-returned' : 'home-journey'}
    >
      <div className="group grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-12">
        <JourneyPrintFan editorial={editorial} sizes="(max-width: 767px) 52vw, 15rem" trip={trip} />

        <div className="min-w-0">
          <p className={cn(EYEBROW, 'tabular-nums')}>{eyebrow}</p>
          {returned ? null : (
            <h2
              className="mt-3 font-journal text-[clamp(2.25rem,7vw,3.25rem)] leading-[0.95] font-normal tracking-[-0.01em] text-balance text-foreground [overflow-wrap:anywhere]"
              id={headingId}
            >
              {trip.name}
            </h2>
          )}
          {line ? (
            <p
              className={cn(
                'line-clamp-3 font-journal leading-[1.35] font-normal text-pretty text-muted-foreground italic',
                returned ? 'mt-3 text-2xl text-foreground' : 'mt-4 text-xl',
              )}
            >
              {line}
            </p>
          ) : null}
          <p className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground tabular-nums">
            {returned ? null : <span>{monthYear(trip.startDate, locale)}</span>}
            {trip.memoryCount ? <span>{t('moments', { count: trip.memoryCount })}</span> : null}
            {trip.experienceRating === null ? null : (
              <ExperienceRatingMark
                rating={trip.experienceRating}
                wordClassName="font-journal text-base text-foreground italic"
              />
            )}
          </p>

          {returned && props.promptKey ? (
            <div className="mt-5 flex items-start gap-2 border-t border-paper-rule pt-4">
              <p className="min-w-0 flex-1 text-sm leading-6 text-muted-foreground">
                {homeT(props.promptKey)}
              </p>
              <Button
                aria-label={homeT('dismissPrompt')}
                className="shrink-0"
                onClick={() => props.onDismissPrompt(trip.id)}
                size="icon-sm"
                variant="ghost"
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-2">
            <Button nativeButton={false} render={<Link href={`/trips/${trip.id}/memories`} />}>
              {trip.memoryCount ? t('openStory') : homeT('addMemories')}
            </Button>
            <Button
              nativeButton={false}
              render={<Link href={`/trips/${trip.id}`} />}
              variant="ghost"
            >
              {t('tripDetails')}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
