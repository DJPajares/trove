'use client';

import { reassignedDayNotes, type DayNoteResolution, type TripShrinkImpact } from '@trove/types';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function TripShrinkReview({
  impact,
  busy,
  feedback,
  onCancel,
  onConfirm,
}: {
  impact: TripShrinkImpact;
  busy: boolean;
  feedback: string | null;
  onCancel: () => void;
  onConfirm: (resolutions: DayNoteResolution[]) => void;
}) {
  const t = useTranslations('trips.shrink');
  const format = useFormatter();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const date = (value: string) =>
    format.dateTime(new Date(`${value}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' });
  const resolutions: DayNoteResolution[] = Object.entries(choices).map(([dayId, choice]) =>
    choice === 'discard'
      ? { dayId, action: 'discard' }
      : { dayId, action: 'append', targetDayId: choice },
  );
  let preview = new Map<string, string>();
  let problem: string | null = null;
  try {
    preview = reassignedDayNotes(impact, resolutions);
  } catch (error) {
    problem = (error as Error).message;
  }
  const options = [
    ...impact.retainedDays.map((day) => ({
      value: day.id,
      label: t('appendTo', { date: date(day.date) }),
    })),
    { value: 'discard', label: t('discard') },
  ];
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('description')}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-5">
          {feedback ? (
            <p className="text-sm text-destructive" role="alert">
              {feedback}
            </p>
          ) : null}
          {impact.removedDays.map((day) => (
            <section
              aria-labelledby={`shrink-day-${day.id}`}
              className="space-y-3 border-t border-border pt-4"
              key={day.id}
            >
              <h3 className="text-sm font-medium" id={`shrink-day-${day.id}`}>
                {date(day.date)}
                {day.name ? ` · ${day.name}` : ''}
              </h3>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {(['items', 'bases', 'tasks', 'reservations', 'expenses', 'memories'] as const)
                  .filter((key) => day[key] > 0)
                  .map((key) => (
                    <li key={key}>{t(key, { count: day[key] })}</li>
                  ))}
                {day.rating !== null || day.reflectionNote ? <li>{t('reflection')}</li> : null}
              </ul>
              {day.notes?.trim() ? (
                <>
                  <p className="whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 text-sm">
                    {day.notes}
                  </p>
                  <label className="block text-sm font-medium" htmlFor={`shrink-note-${day.id}`}>
                    {t('noteDecision', { date: date(day.date) })}
                  </label>
                  <Select
                    disabled={busy}
                    items={options}
                    value={choices[day.id] ?? null}
                    onValueChange={(value) => {
                      if (value) setChoices((current) => ({ ...current, [day.id]: value }));
                    }}
                  >
                    <SelectTrigger className="w-full" id={`shrink-note-${day.id}`}>
                      <SelectValue placeholder={t('choose')} />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              ) : null}
            </section>
          ))}
          {impact.retainedDays
            .filter((day) => preview.has(day.id) && preview.get(day.id) !== (day.notes ?? ''))
            .map((day) => (
              <section className="space-y-2 border-t border-border pt-4" key={day.id}>
                <h3 className="text-sm font-medium">{t('preview', { date: date(day.date) })}</h3>
                <p className="whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 text-sm">
                  {preview.get(day.id)}
                </p>
              </section>
            ))}
          {problem === 'reassigned_notes_too_long' ? (
            <p className="text-sm text-destructive" role="alert">
              {t('tooLong')}
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">{t('preserved')}</p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy || Boolean(problem)}
            onClick={() => onConfirm(resolutions)}
            type="button"
          >
            {t(busy ? 'saving' : 'confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
