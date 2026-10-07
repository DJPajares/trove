'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { journalSerif } from '@/components/memories/journal-font';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  EXPERIENCE_RATING_VALUES,
  type ExperienceRatingValue,
  experienceRatingWord,
  nextExperienceRating,
} from '@/lib/experience-rating';
import { cn } from '@/lib/utils';

/**
 * Where a rating is given, changed or taken back - only ever opened on
 * purpose, from the quiet control on the cover or on a day's chapter.
 *
 * Five large dots rather than stars, with the word the chosen one stands for
 * set large in the journal's serif. A dot saves the moment it is chosen and
 * choosing the same one again clears it; the note saves when it is left.
 */
export function ExperienceRatingSheet({
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
  const [rating, setRating] = useState(initialRating);
  const [note, setNote] = useState(initialNote ?? '');
  const [noteVisible, setNoteVisible] = useState(Boolean(initialNote));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRating(initialRating);
    setNote(initialNote ?? '');
    setNoteVisible(Boolean(initialNote));
    setError(false);
  }, [initialNote, initialRating, open]);

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

  function choose(value: ExperienceRatingValue) {
    const next = nextExperienceRating(rating, value);
    setRating(next);
    void commit(next, note);
  }

  const word = experienceRatingWord(rating);

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className={cn(journalSerif.variable, 'bg-paper')} closeLabel={t('close')}>
        <SheetHeader className="border-b-0 pb-2">
          <SheetTitle className="font-journal text-[length:var(--text-section-title)] font-normal tracking-normal">
            {title}
          </SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 pb-6">
          {/* Toggle buttons rather than radios: choosing the current value
              clears the rating, which a radio group cannot express. */}
          <div aria-label={title} className="-mx-2 flex items-center gap-1" role="group">
            {EXPERIENCE_RATING_VALUES.map((value) => {
              const filled = rating !== null && value <= rating;
              const valueWord = experienceRatingWord(value);

              return (
                <button
                  aria-label={t('valueLabel', {
                    value,
                    word: valueWord ? t(`words.${valueWord}`) : String(value),
                  })}
                  aria-pressed={rating === value}
                  className="group/dot flex size-11 items-center justify-center rounded-full outline-none transition-colors duration-[var(--motion-standard)] ease-[var(--ease-standard)] hover:bg-surface-hover/70 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60 motion-reduce:transition-none"
                  disabled={saving}
                  key={value}
                  onClick={() => choose(value)}
                  type="button"
                >
                  <svg aria-hidden="true" className="size-5" viewBox="0 0 10 10">
                    {filled ? (
                      <circle className="text-rating" cx="5" cy="5" fill="currentColor" r="4.5" />
                    ) : (
                      <circle
                        className="text-muted-foreground group-hover/dot:text-rating"
                        cx="5"
                        cy="5"
                        fill="none"
                        r="4"
                        stroke="currentColor"
                        strokeWidth="1"
                      />
                    )}
                  </svg>
                </button>
              );
            })}
          </div>

          <p
            aria-live="polite"
            className={cn(
              'min-h-[1.2em] font-journal text-[2.5rem] leading-none font-normal italic',
              word ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {word ? t(`words.${word}`) : t('unrated')}
          </p>

          {noteVisible ? (
            <Textarea
              aria-label={t('noteLabel', { label: title })}
              className="max-w-md bg-paper-print"
              disabled={saving}
              maxLength={2000}
              onBlur={() => void commit(rating, note)}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t('notePlaceholder')}
              rows={3}
              value={note}
            />
          ) : (
            <Button onClick={() => setNoteVisible(true)} size="sm" type="button" variant="ghost">
              {t('addNote')}
            </Button>
          )}

          {error ? <p className="text-xs text-destructive">{t('saveError')}</p> : null}
        </div>

        <SheetFooter>
          <SheetClose render={<Button variant="outline" />}>{t('done')}</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
