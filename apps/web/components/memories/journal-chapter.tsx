'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';

import { ExperienceRatingControl } from '@/components/experience-rating';
import { DateStamp } from '@/components/memories/date-stamp';
import { JournalMoment } from '@/components/memories/journal-moment';
import type { Memory, MemoryPhoto } from '@/lib/memories/api';
import type {
  JournalChapter as Chapter,
  JournalDay,
  JournalInterlude,
} from '@/lib/memories/journal';
import { momentLean } from '@/lib/memories/photo-layout';
import { motionEase } from '@/lib/motion';

const KICKER = 'text-[0.68rem] font-semibold tracking-[0.2em] text-accent-strong uppercase';

export function longDate(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
    weekday: 'long',
  }).format(new Date(`${date}T00:00:00.000Z`));
}

/** A chapter's title: the traveller's own name for the day, else the day itself. */
export function chapterTitle(day: JournalDay, locale: string) {
  return day.name ?? longDate(day.date, locale);
}

/**
 * One day of the trip as a chapter: a kicker with the day's number, its title
 * - the traveller's own name for the day, or the date - a date stamp, the
 * traveller's reflection on the day if they wrote one, and its moments.
 *
 * The day's rating is reachable from the chapter's own marker, offered and
 * never asked: the rating itself once given, five hollow dots until then.
 *
 * On a wide screen the marker becomes a margin that stays in view beside the
 * moments, the way a spread keeps its chapter title on the facing page. The
 * chapter settles in once as it is reached; with reduced motion it is simply
 * there.
 */
export function JournalChapter({
  chapter,
  contextFor,
  focusedMemoryId,
  leanOffset,
  onOpenMoment,
  onPhotoError,
  onRate,
  rateable,
}: Readonly<{
  chapter: Chapter;
  contextFor: (memory: Memory) => string;
  focusedMemoryId: string | null;
  /** How many moments came before this chapter, so the lean alternates down the whole journal. */
  leanOffset: number;
  onOpenMoment: (memory: Memory, photoIndex: number) => void;
  onPhotoError: (photo: MemoryPhoto) => void;
  onRate: () => void;
  rateable: boolean;
}>) {
  const t = useTranslations('memories.journal');
  const locale = useLocale();
  const reduced = useReducedMotion();
  const { day, experience, memories } = chapter;
  const titleId = `${chapter.id}-title`;
  const reflection = experience?.note?.trim() ? experience.note : null;

  // A day kept only as a rating has nothing to read, so it takes a single
  // line in the flow - its title and its rating - rather than a full chapter.
  if (!memories.length && !reflection) {
    return (
      <section
        aria-labelledby={titleId}
        className="flex scroll-mt-[calc(var(--header-offset)+var(--journal-head-height)+1rem)] flex-wrap items-center gap-x-4 gap-y-1 outline-none lg:ms-[calc(15rem+3.5rem)]"
        data-journal-chapter=""
        id={chapter.id}
        tabIndex={-1}
      >
        {day.dayNumber !== null ? (
          <p className={KICKER}>
            {day.isToday
              ? t('todayDayNumber', { number: day.dayNumber })
              : t('dayNumber', { number: day.dayNumber })}
          </p>
        ) : null}
        <h2
          className="font-journal text-2xl leading-tight font-normal text-foreground"
          id={titleId}
        >
          {chapterTitle(day, locale)}
        </h2>
        {rateable ? (
          <ExperienceRatingControl
            label={t('rateDay', { date: longDate(day.date, locale) })}
            onOpen={onRate}
            rating={experience?.rating ?? null}
            wordClassName="font-journal text-lg italic"
          />
        ) : null}
      </section>
    );
  }

  return (
    <motion.section
      aria-labelledby={titleId}
      className="scroll-mt-[calc(var(--header-offset)+var(--journal-head-height)+1rem)] outline-none lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-14"
      data-journal-chapter=""
      id={chapter.id}
      tabIndex={-1}
      initial={reduced ? false : { opacity: 0, y: 16 }}
      transition={reduced ? { duration: 0 } : { duration: 0.5, ease: motionEase }}
      viewport={{ margin: '-80px', once: true }}
      whileInView={{ opacity: 1, y: 0 }}
    >
      <header className="lg:sticky lg:top-[calc(var(--header-offset)+var(--journal-head-height)+1.5rem)] lg:self-start">
        <div className="flex items-start justify-between gap-5 lg:flex-col-reverse lg:items-start lg:gap-6">
          <div className="min-w-0">
            {day.dayNumber !== null ? (
              <p className={KICKER}>
                {day.isToday
                  ? t('todayDayNumber', { number: day.dayNumber })
                  : t('dayNumber', { number: day.dayNumber })}
              </p>
            ) : null}
            <h2
              className="mt-2 font-journal text-[clamp(2rem,7vw,2.6rem)] leading-[1.05] font-normal text-balance text-foreground [overflow-wrap:anywhere]"
              id={titleId}
            >
              {chapterTitle(day, locale)}
            </h2>
            {day.name ? (
              <p className="mt-2 text-sm text-muted-foreground">{longDate(day.date, locale)}</p>
            ) : null}
          </div>
          <DateStamp date={day.date} place={day.place} />
        </div>

        {reflection ? (
          <p className="mt-5 font-journal text-xl leading-[1.45] font-normal whitespace-pre-wrap text-pretty text-foreground italic [overflow-wrap:anywhere]">
            {reflection}
          </p>
        ) : null}

        {rateable ? (
          <ExperienceRatingControl
            className="mt-3"
            label={t('rateDay', { date: longDate(day.date, locale) })}
            onOpen={onRate}
            rating={experience?.rating ?? null}
            wordClassName="font-journal text-lg italic"
          />
        ) : null}
      </header>

      {memories.length ? (
        <div className="mt-10 space-y-16 lg:mt-2">
          {memories.map((memory, index) => (
            <JournalMoment
              context={contextFor(memory)}
              focused={memory.id === focusedMemoryId}
              key={memory.id}
              lean={momentLean(leanOffset + index)}
              memory={memory}
              onOpen={(photoIndex) => onOpenMoment(memory, photoIndex)}
              onPhotoError={onPhotoError}
            />
          ))}
        </div>
      ) : null}
    </motion.section>
  );
}

/**
 * Days with nothing kept, folded into one quiet line between chapters: they
 * were part of the trip and the journal says so, but it never asks for them to
 * be filled in (PRD 31.1).
 */
export function JournalQuietDays({ interlude }: Readonly<{ interlude: JournalInterlude }>) {
  const t = useTranslations('memories.journal');
  const first = interlude.days[0];
  const last = interlude.days.at(-1);
  if (!first || !last || first.dayNumber === null || last.dayNumber === null) return null;

  const places = [...new Set(interlude.days.map((day) => day.place).filter(Boolean))].slice(0, 2);
  const span =
    first.date === last.date
      ? t('quietDay', { number: first.dayNumber })
      : t('quietDays', { end: last.dayNumber, start: first.dayNumber });

  return (
    <div
      className="flex scroll-mt-[calc(var(--header-offset)+var(--journal-head-height)+1rem)] items-center gap-4 text-muted-foreground outline-none"
      data-slot="journal-quiet-days"
      id={interlude.id}
      tabIndex={-1}
    >
      <span aria-hidden="true" className="h-px flex-1 bg-border/80" />
      <p className="max-w-[80%] text-center font-journal text-lg font-normal italic">
        {span}
        {places.length ? ` · ${places.join(' · ')}` : null}
      </p>
      <span aria-hidden="true" className="h-px flex-1 bg-border/80" />
    </div>
  );
}
