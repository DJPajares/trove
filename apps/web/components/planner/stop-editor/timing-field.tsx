'use client';

import { Clock3, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';

import {
  SuggestedTimeAction,
  type SuggestedTimeActionProps,
} from '@/components/itinerary-suggested-time';
import { TimeInput } from '@/components/time-input';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  durationMinutesFromParts,
  durationParts,
  ITINERARY_DURATION_PRESETS,
  type StopEditorCustomDuration,
  type StopEditorForm,
} from '@/lib/itinerary/item-editor';

const SCHEDULES = ['anytime', 'morning', 'afternoon', 'evening', 'exact'] as const;

/**
 * When a stop happens and for how long: a part of the day or an exact time,
 * a time suggested from what the day already holds, and a length as a preset,
 * custom hours and minutes, or an end time. The stop editor and the timing
 * sheet both edit timing with it, so the two can never disagree about what a
 * time means.
 */
export function TimingField({
  customDuration,
  expanded,
  form,
  onChange,
  onCustomDurationChange,
  onExpand,
  onRemove,
  suggest,
  protectedTiming,
}: Readonly<{
  customDuration: StopEditorCustomDuration;
  /** Collapsed, the "when" is a single "Add timing" button. */
  expanded: boolean;
  form: StopEditorForm;
  onChange: (patch: Partial<StopEditorForm>) => void;
  onCustomDurationChange: (next: StopEditorCustomDuration) => void;
  onExpand: () => void;
  onRemove: () => void;
  /** Offered only where a suggestion can be honest - online, for a stop the server can place. */
  suggest: SuggestedTimeActionProps | null;
  protectedTiming?: boolean;
}>) {
  const t = useTranslations('itinerary');
  const id = useId();

  function chooseDurationPreset(minutes: number) {
    onChange({ durationMinutes: minutes.toString() });
    onCustomDurationChange({ ...durationParts(minutes.toString()), open: false });
  }

  function updateCustomDuration(kind: 'hours' | 'minutes', value: string) {
    const parts = {
      hours: kind === 'hours' ? value : customDuration.hours,
      minutes: kind === 'minutes' ? value : customDuration.minutes,
    };
    onCustomDurationChange({ ...parts, open: true });
    onChange({ durationMinutes: durationMinutesFromParts(parts) });
  }

  return (
    <section
      className="space-y-4 rounded-[var(--radius-lg)] border p-4"
      aria-label={t('connectedTiming.question')}
    >
      <p className="text-sm font-medium">{t('connectedTiming.question')}</p>
      {!expanded ? (
        <Button className="w-full justify-start" onClick={onExpand} type="button" variant="outline">
          <Clock3 aria-hidden="true" />
          {t('addTiming')}
        </Button>
      ) : (
        <Field className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <FieldLabel>{t('scheduleLabel')}</FieldLabel>
            <Button onClick={onRemove} size="sm" type="button" variant="ghost">
              <X aria-hidden="true" />
              {t('removeTiming')}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {SCHEDULES.map((value) => (
              <Button
                aria-pressed={form.schedule === value}
                key={value}
                onClick={() =>
                  onChange({
                    // An end time is only meaningful after an exact start.
                    ...(value !== 'exact' && form.timingMode === 'end_time'
                      ? { durationMinutes: '', localEndTime: '', timingMode: 'duration' as const }
                      : {}),
                    schedule: value,
                  })
                }
                size="sm"
                type="button"
                variant={form.schedule === value ? 'secondary' : 'outline'}
              >
                {t(`schedule.${value}`)}
              </Button>
            ))}
          </div>
          {form.schedule === 'exact' ? (
            <div className="space-y-2">
              <FieldLabel htmlFor={`${id}-exact`}>{t('exactTime')}</FieldLabel>
              <TimeInput
                aria-describedby={`${id}-exact-hint`}
                id={`${id}-exact`}
                onValueChange={(value) => onChange({ exactTime: value })}
                required
                value={form.exactTime}
              />
              <FieldDescription id={`${id}-exact-hint`}>{t('localTimeHint')}</FieldDescription>
            </div>
          ) : null}
          {form.schedule === 'exact' ? (
            <Field>
              <FieldLabel htmlFor={`${id}-flexibility`}>
                {t('connectedTiming.flexibility')}
              </FieldLabel>
              <Select
                disabled={protectedTiming}
                value={protectedTiming ? 'fixed' : (form.timingFlexibility ?? 'fixed')}
                onValueChange={(value) => {
                  if (value === 'flexible' || value === 'fixed')
                    onChange({ timingFlexibility: value });
                }}
              >
                <SelectTrigger
                  id={`${id}-flexibility`}
                  className="w-full"
                  aria-describedby={`${id}-flexibility-hint`}
                >
                  <SelectValue>
                    {t(`connectedTiming.${form.timingFlexibility ?? 'fixed'}`)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="flexible">{t('connectedTiming.flexible')}</SelectItem>
                  <SelectItem value="fixed">{t('connectedTiming.fixed')}</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription id={`${id}-flexibility-hint`}>
                {t(
                  protectedTiming
                    ? 'connectedTiming.protected'
                    : form.timingFlexibility === 'flexible'
                      ? 'connectedTiming.flexibleHint'
                      : 'connectedTiming.fixedHint',
                )}
              </FieldDescription>
            </Field>
          ) : null}
          {suggest ? <SuggestedTimeAction {...suggest} /> : null}
        </Field>
      )}

      <Field>
        <FieldLabel>{t('durationQuestion')}</FieldLabel>
        <FieldDescription>{t('durationHint')}</FieldDescription>
        <div aria-label={t('timingModeLabel')} className="flex flex-wrap gap-2" role="group">
          <Button
            aria-pressed={form.timingMode === 'duration'}
            onClick={() => onChange({ localEndTime: '', timingMode: 'duration' })}
            size="sm"
            type="button"
            variant={form.timingMode === 'duration' ? 'secondary' : 'outline'}
          >
            {t('durationMode')}
          </Button>
          <Button
            aria-pressed={form.timingMode === 'end_time'}
            disabled={form.schedule !== 'exact' || !form.exactTime}
            onClick={() => {
              onChange({ durationMinutes: '', timingMode: 'end_time' });
              onCustomDurationChange({ hours: '', minutes: '', open: false });
            }}
            size="sm"
            type="button"
            variant={form.timingMode === 'end_time' ? 'secondary' : 'outline'}
          >
            {t('endTimeMode')}
          </Button>
        </div>
        {form.timingMode === 'duration' ? (
          <>
            <div className="flex flex-wrap gap-2">
              {ITINERARY_DURATION_PRESETS.map((minutes) => (
                <Button
                  aria-pressed={form.durationMinutes === minutes.toString()}
                  key={minutes}
                  onClick={() => chooseDurationPreset(minutes)}
                  size="sm"
                  type="button"
                  variant={form.durationMinutes === minutes.toString() ? 'secondary' : 'outline'}
                >
                  {t(`durationPreset.${minutes}`)}
                </Button>
              ))}
              <Button
                aria-pressed={customDuration.open}
                onClick={() =>
                  onCustomDurationChange({ ...durationParts(form.durationMinutes), open: true })
                }
                size="sm"
                type="button"
                variant={customDuration.open ? 'secondary' : 'outline'}
              >
                {t('customDuration')}
              </Button>
              {form.durationMinutes ? (
                <Button
                  aria-label={t('clearDuration')}
                  onClick={() => {
                    onChange({ durationMinutes: '' });
                    onCustomDurationChange({ hours: '', minutes: '', open: false });
                  }}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <X aria-hidden="true" />
                </Button>
              ) : null}
            </div>
            {customDuration.open ? (
              <div className="grid grid-cols-2 gap-3 rounded-[var(--radius-lg)] bg-muted/40 p-3">
                <Field>
                  <FieldLabel htmlFor={`${id}-hours`}>{t('hours')}</FieldLabel>
                  <Input
                    id={`${id}-hours`}
                    inputMode="numeric"
                    min="0"
                    onChange={(event) => updateCustomDuration('hours', event.target.value)}
                    type="number"
                    value={customDuration.hours}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-minutes`}>{t('minutes')}</FieldLabel>
                  <Input
                    id={`${id}-minutes`}
                    inputMode="numeric"
                    max="59"
                    min="0"
                    onChange={(event) => updateCustomDuration('minutes', event.target.value)}
                    type="number"
                    value={customDuration.minutes}
                  />
                </Field>
              </div>
            ) : null}
          </>
        ) : (
          <div className="space-y-2">
            <FieldLabel htmlFor={`${id}-end`}>{t('endTime')}</FieldLabel>
            <TimeInput
              aria-describedby={`${id}-end-hint`}
              aria-invalid={Boolean(form.localEndTime && form.localEndTime <= form.exactTime)}
              id={`${id}-end`}
              onValueChange={(value) => onChange({ localEndTime: value })}
              value={form.localEndTime}
            />
            <FieldDescription id={`${id}-end-hint`}>{t('endTimeHint')}</FieldDescription>
          </div>
        )}
      </Field>
    </section>
  );
}
