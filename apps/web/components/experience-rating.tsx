'use client';

import { useTranslations } from 'next-intl';

import { EXPERIENCE_RATING_VALUES, experienceRatingWord } from '@/lib/experience-rating';
import { cn } from '@/lib/utils';

type RatingTone = 'default' | 'onImage';

/**
 * Five ink dots, filled up to the rating. Drawn in `currentColor` so forced
 * colours keep both states legible: a filled dot stays a disc and an empty one
 * stays a ring, so colour is never the only thing telling them apart.
 *
 * Filled dots take the rating's own gold (3:1 against every paper and surface
 * they land on). Empty ones take the muted ink rather than a border tone, which
 * would fall to 1.86:1 on the journal's paper.
 */
export function ExperienceRatingDots({
  className,
  rating,
  size = 'default',
  tone = 'default',
}: Readonly<{
  className?: string;
  rating: number | null;
  size?: 'default' | 'large';
  tone?: RatingTone;
}>) {
  const onImage = tone === 'onImage';
  const dot = size === 'large' ? 'size-3.5' : 'size-2';

  return (
    <span aria-hidden="true" className={cn('inline-flex items-center gap-1', className)}>
      {EXPERIENCE_RATING_VALUES.map((value) => {
        const filled = rating !== null && value <= rating;

        return (
          <svg
            className={cn(
              dot,
              'shrink-0',
              filled
                ? onImage
                  ? 'text-rating-on-media'
                  : 'text-rating'
                : onImage
                  ? 'text-media-fallback-foreground/75'
                  : 'text-muted-foreground',
            )}
            key={value}
            viewBox="0 0 10 10"
          >
            {filled ? (
              <circle cx="5" cy="5" fill="currentColor" r="4.5" />
            ) : (
              <circle cx="5" cy="5" fill="none" r="4" stroke="currentColor" strokeWidth="1.25" />
            )}
          </svg>
        );
      })}
    </span>
  );
}

/**
 * The dots with the word they stand for, and the number for a screen reader.
 * The word inherits its face, so the journal sets it in its serif and every
 * other surface in Trove's sans.
 */
export function ExperienceRatingMark({
  className,
  rating,
  tone = 'default',
  wordClassName,
}: Readonly<{
  className?: string;
  rating: number;
  tone?: RatingTone;
  wordClassName?: string;
}>) {
  const t = useTranslations('experienceRating');
  const word = experienceRatingWord(rating);
  if (!word) return null;

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <ExperienceRatingDots rating={rating} tone={tone} />
      <span className={wordClassName}>{t(`words.${word}`)}</span>
      <span className="sr-only">{t('outOf', { value: rating })}</span>
    </span>
  );
}

/**
 * A read-only echo of a rating already given, for surfaces that report rather
 * than collect - Home and the trip overview.
 */
export function ExperienceRatingSummary({
  className,
  label,
  rating,
  tone = 'default',
}: Readonly<{
  className?: string;
  label: string;
  rating: number;
  tone?: RatingTone;
}>) {
  return (
    <p className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}>
      <span>{label}</span>
      <ExperienceRatingMark
        rating={rating}
        tone={tone}
        wordClassName="font-medium text-foreground"
      />
    </p>
  );
}

/**
 * Rating offered, never asked (PRD 31.2). A rating already given shows as
 * itself - dots and a word - and one not yet given is five hollow dots, a
 * single quiet control rather than a question standing beside the page. Either
 * way it opens the place the rating is changed.
 */
export function ExperienceRatingControl({
  className,
  label,
  onOpen,
  rating,
  tone = 'default',
  wordClassName,
}: Readonly<{
  className?: string;
  /** What the control does, such as "Rate this day". */
  label: string;
  onOpen: () => void;
  rating: number | null;
  tone?: RatingTone;
  wordClassName?: string;
}>) {
  const t = useTranslations('experienceRating');
  const onImage = tone === 'onImage';
  const word = experienceRatingWord(rating);

  return (
    <button
      aria-label={
        word ? `${label}. ${t('current', { value: rating ?? 0, word: t(`words.${word}`) })}` : label
      }
      className={cn(
        // 44px tall at every size: a quiet control is still a touch target.
        '-mx-2 inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-md)] px-2 outline-none transition-colors duration-[var(--motion-standard)] ease-[var(--ease-standard)] focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none',
        onImage ? 'hover:bg-white/12' : 'hover:bg-surface-hover/70',
        className,
      )}
      onClick={onOpen}
      type="button"
    >
      <ExperienceRatingDots rating={rating} tone={tone} />
      {word ? (
        <span
          className={cn(
            onImage ? 'text-media-fallback-foreground' : 'text-foreground',
            wordClassName,
          )}
        >
          {t(`words.${word}`)}
        </span>
      ) : null}
    </button>
  );
}
