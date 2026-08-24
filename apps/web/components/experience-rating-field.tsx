'use client';

import { Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const VALUES = [1, 2, 3, 4, 5] as const;

/**
 * The five stars on their own, for tight surfaces that already carry their own
 * label — a day heading, or a cover where the rating sits over the photograph.
 * `onImage` swaps the palette for one that survives a dark scrim.
 */
export function ExperienceRatingStars({
  'aria-label': ariaLabel,
  className,
  rating,
  tone = 'default',
}: Readonly<{
  'aria-label'?: string;
  className?: string;
  rating: number;
  tone?: 'default' | 'onImage';
}>) {
  const onImage = tone === 'onImage';

  return (
    <span aria-label={ariaLabel} className={cn('flex items-center gap-0.5', className)}>
      {VALUES.map((value) => (
        <Star
          aria-hidden="true"
          className={cn(
            'size-4',
            value <= rating
              ? onImage
                ? 'fill-current text-white'
                : 'fill-current text-brand'
              : onImage
                ? 'text-white/40'
                : 'text-border',
          )}
          key={value}
        />
      ))}
    </span>
  );
}

/**
 * A read-only echo of a rating already given, for surfaces that report rather
 * than collect. Uses the same stars as the field so the concept stays visually
 * consistent, and stays distinct from Plan Score wherever both could appear.
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
  tone?: 'default' | 'onImage';
}>) {
  const t = useTranslations('experienceRating');

  return (
    <p className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}>
      <span>{label}</span>
      <ExperienceRatingStars
        aria-label={t('starLabel', { value: rating })}
        rating={rating}
        tone={tone}
      />
    </p>
  );
}

/**
 * Experience Rating is the traveller's private reflection on how something
 * felt: five plain stars, no numeric score, no meters. That's deliberate — it
 * keeps this visually unmistakable from Plan Score's computed 0-100 signal and
 * from any provider/public Place rating (PRD section 30).
 */
export function ExperienceRatingField({
  disabled,
  initialNote,
  initialRating,
  label,
  onSave,
}: Readonly<{
  disabled?: boolean;
  initialNote: string | null;
  initialRating: number | null;
  label: string;
  onSave: (rating: number | null, note: string | null) => Promise<void>;
}>) {
  const t = useTranslations('experienceRating');
  const [rating, setRating] = useState(initialRating);
  const [note, setNote] = useState(initialNote ?? '');
  const [noteVisible, setNoteVisible] = useState(Boolean(initialNote));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setRating(initialRating);
    setNote(initialNote ?? '');
    setNoteVisible(Boolean(initialNote));
  }, [initialNote, initialRating]);

  async function commit(nextRating: number | null, nextNote: string) {
    setSaving(true);
    setError(false);
    try {
      await onSave(nextRating, nextNote.trim() ? nextNote.trim() : null);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  function selectStar(value: number) {
    const next = rating === value ? null : value;
    setRating(next);
    void commit(next, note);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {/* Toggle buttons, not radios: selecting the current value clears the rating. */}
        <div aria-label={label} className="flex items-center gap-0.5" role="group">
          {VALUES.map((value) => (
            <button
              aria-label={t('starLabel', { value })}
              aria-pressed={rating !== null && value <= rating}
              className="rounded-[var(--radius-sm)] p-0.5 text-muted-foreground outline-none transition-colors hover:text-brand focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-60"
              disabled={disabled || saving}
              key={value}
              onClick={() => selectStar(value)}
              type="button"
            >
              <Star
                aria-hidden="true"
                className={cn(
                  'size-5',
                  rating !== null && value <= rating ? 'fill-current text-brand' : undefined,
                )}
              />
            </button>
          ))}
        </div>
        {!noteVisible ? (
          <Button
            disabled={disabled}
            onClick={() => setNoteVisible(true)}
            size="xs"
            type="button"
            variant="ghost"
          >
            {t('addNote')}
          </Button>
        ) : null}
      </div>
      {noteVisible ? (
        <Textarea
          aria-label={t('noteLabel', { label })}
          className="max-w-md"
          disabled={disabled || saving}
          maxLength={2000}
          onBlur={() => void commit(rating, note)}
          onChange={(event) => setNote(event.target.value)}
          placeholder={t('notePlaceholder')}
          rows={2}
          value={note}
        />
      ) : null}
      {error ? <p className="text-xs text-destructive">{t('saveError')}</p> : null}
    </div>
  );
}

/**
 * Rating as a deliberate act. Surfaces that are being read rather than filled in
 * — a finished trip's story — offer the rating behind a quiet affordance and
 * collect it here, instead of standing a prompt beside everything on the page.
 * Saving is unchanged: a star commits on click, a note commits on blur.
 */
export function ExperienceRatingDialog({
  description,
  initialNote,
  initialRating,
  onOpenChange,
  onSave,
  open,
  title,
}: Readonly<{
  description: string;
  initialNote: string | null;
  initialRating: number | null;
  onOpenChange: (open: boolean) => void;
  onSave: (rating: number | null, note: string | null) => Promise<void>;
  open: boolean;
  title: string;
}>) {
  const t = useTranslations('experienceRating');

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent closeLabel={t('close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ExperienceRatingField
          initialNote={initialNote}
          initialRating={initialRating}
          label={t('summaryLabel')}
          onSave={onSave}
        />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t('done')}</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
