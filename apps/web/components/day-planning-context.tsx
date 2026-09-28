'use client';
import { useState, type FormEvent } from 'react';
import {
  readDayPlanningContext,
  dayPlanningContextSchema,
  type DayPlanningContext,
} from '@trove/types';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TimeInput } from '@/components/time-input';

export function DayPlanningContextDialog({
  initial,
  timeZone,
  onClose,
  onSave,
}: Readonly<{
  initial: unknown;
  timeZone: string;
  onClose: () => void;
  onSave: (value: DayPlanningContext) => Promise<void>;
}>) {
  const t = useTranslations('dayPlanningContext');
  const [value, setValue] = useState(() => readDayPlanningContext(initial));
  const [start, setStart] = useState(value.availability?.start ?? '');
  const [end, setEnd] = useState(value.availability?.end ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(event: FormEvent) {
    event.preventDefault();
    const parsed = dayPlanningContextSchema.safeParse({
      ...value,
      availability: start || end ? { start, end } : null,
    });
    if (!parsed.success) {
      setError(t('windowError'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(parsed.data);
      onClose();
    } catch {
      setError(t('saveError'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent closeLabel={t('cancel')}>
        <form className="space-y-6" onSubmit={save}>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('hint')}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="day-intent">{t('intent')}</FieldLabel>
            <Select
              value={value.intent ?? 'unknown'}
              onValueChange={(intent) => {
                if (intent)
                  setValue({
                    ...value,
                    intent: intent === 'unknown' ? null : (intent as DayPlanningContext['intent']),
                  });
              }}
            >
              <SelectTrigger id="day-intent" className="w-full">
                <SelectValue>{(intent) => t(`intents.${intent}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {['unknown', 'explore', 'focused', 'rest', 'transit'].map((intent) => (
                  <SelectItem key={intent} value={intent}>
                    {t(`intents.${intent}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="day-available-start">{t('start')}</FieldLabel>
              <TimeInput id="day-available-start" value={start} onValueChange={setStart} />
            </Field>
            <Field>
              <FieldLabel htmlFor="day-available-end">{t('end')}</FieldLabel>
              <TimeInput id="day-available-end" value={end} onValueChange={setEnd} />
            </Field>
          </div>
          <FieldDescription>{t('windowHint', { timeZone })}</FieldDescription>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setStart('');
              setEnd('');
            }}
          >
            {t('clearWindow')}
          </Button>
          {error ? <FieldError role="alert">{error}</FieldError> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t('saving') : t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
