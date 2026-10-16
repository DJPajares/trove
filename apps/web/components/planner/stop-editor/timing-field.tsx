'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';

import {
  SuggestedTimeAction,
  type SuggestedTimeActionProps,
} from '@/components/itinerary-suggested-time';
import { TimeInput } from '@/components/time-input';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  durationMinutesFromParts,
  durationParts,
  ITINERARY_DURATION_PRESETS,
  type StopEditorCustomDuration,
  type StopEditorForm,
} from '@/lib/itinerary/item-editor';

const SCHEDULES = ['anytime', 'morning', 'afternoon', 'evening', 'exact'] as const;

/** Chips large enough to tap in a sheet, still reading as one quiet row. */
const chipClassName =
  'min-h-8 border border-border-subtle bg-background px-3.5 text-[0.8125rem] data-[pressed]:border-brand/30';

/**
 * When a stop happens and for how long, as two short rows of choices rather
 * than a form: when (a part of the day, or a time), then how long (a length,
 * or - once there is a start time - until an end time). Tapping the chosen
 * option again clears it, so there is no separate "remove" to find.
 *
 * Only a set time brings more with it: the time itself, and whether Trove may
 * move it when the day changes. The stop editor and the timing sheet both edit
 * timing with it, so the two can never disagree about what a time means.
 */
export function TimingField({
  customDuration,
  form,
  onChange,
  onCustomDurationChange,
  onRemove,
  suggest,
  protectedTiming,
}: Readonly<{
  customDuration: StopEditorCustomDuration;
  form: StopEditorForm;
  onChange: (patch: Partial<StopEditorForm>) => void;
  onCustomDurationChange: (next: StopEditorCustomDuration) => void;
  /** Clears when the stop happens: its part of the day, time and end time. */
  onRemove: () => void;
  /** Offered only where a suggestion can be honest - online, for a stop the server can place. */
  suggest: SuggestedTimeActionProps | null;
  protectedTiming?: boolean;
}>) {
  const t = useTranslations('itinerary');
  const editorT = useTranslations('itinerary.planner.editor');
  const id = useId();
  const exact = form.schedule === 'exact';
  const presets = ITINERARY_DURATION_PRESETS.map(String);
  const length =
    form.timingMode === 'end_time'
      ? 'until'
      : customDuration.open || (form.durationMinutes && !presets.includes(form.durationMinutes))
        ? 'custom'
        : form.durationMinutes;

  function chooseSchedule(value: (typeof SCHEDULES)[number] | undefined) {
    if (!value) {
      onRemove();
      return;
    }
    onChange({
      // An end time is only meaningful after an exact start.
      ...(value !== 'exact' && form.timingMode === 'end_time'
        ? { durationMinutes: '', localEndTime: '', timingMode: 'duration' as const }
        : {}),
      schedule: value,
    });
  }

  function chooseLength(value: string | undefined) {
    if (!value) {
      onChange({ durationMinutes: '', localEndTime: '', timingMode: 'duration' });
      onCustomDurationChange({ hours: '', minutes: '', open: false });
    } else if (value === 'until') {
      onChange({ durationMinutes: '', timingMode: 'end_time' });
      onCustomDurationChange({ hours: '', minutes: '', open: false });
    } else if (value === 'custom') {
      onChange({ localEndTime: '', timingMode: 'duration' });
      onCustomDurationChange({ ...durationParts(form.durationMinutes), open: true });
    } else {
      onChange({ durationMinutes: value, localEndTime: '', timingMode: 'duration' });
      onCustomDurationChange({ ...durationParts(value), open: false });
    }
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
    <div className="space-y-5">
      <Field className="gap-2.5">
        <FieldLabel id={`${id}-when`}>{t('scheduleLabel')}</FieldLabel>
        <ChipGroup
          aria-labelledby={`${id}-when`}
          multiple={false}
          onValueChange={([value]) => chooseSchedule(value as (typeof SCHEDULES)[number])}
          value={form.schedule === 'none' ? [] : [form.schedule]}
        >
          {SCHEDULES.map((value) => (
            <Chip className={chipClassName} key={value} value={value}>
              {t(`schedule.${value}`)}
            </Chip>
          ))}
        </ChipGroup>

        {exact ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-3">
            <div className="flex items-center gap-2.5">
              <FieldLabel className="font-normal text-muted-foreground" htmlFor={`${id}-exact`}>
                {editorT('starts')}
              </FieldLabel>
              <TimeInput
                className="w-36"
                id={`${id}-exact`}
                onValueChange={(value) => onChange({ exactTime: value })}
                required
                value={form.exactTime}
              />
            </div>
            {/* Whether the day may move this time. A booking, a journey or a
                stop already done is held where it is, and says so. */}
            <label className="flex items-center gap-2.5 text-sm" htmlFor={`${id}-flexible`}>
              <Switch
                checked={!protectedTiming && form.timingFlexibility === 'flexible'}
                disabled={protectedTiming}
                id={`${id}-flexible`}
                onCheckedChange={(checked) =>
                  onChange({ timingFlexibility: checked ? 'flexible' : 'fixed' })
                }
              />
              {editorT('flexible')}
            </label>
          </div>
        ) : null}
        {exact && protectedTiming ? (
          <FieldDescription>{t('connectedTiming.protected')}</FieldDescription>
        ) : null}
        {suggest ? <SuggestedTimeAction {...suggest} /> : null}
      </Field>

      <Field className="gap-2.5">
        <FieldLabel id={`${id}-length`}>{t('durationQuestion')}</FieldLabel>
        <ChipGroup
          aria-labelledby={`${id}-length`}
          multiple={false}
          onValueChange={([value]) => chooseLength(value)}
          value={length ? [length] : []}
        >
          {ITINERARY_DURATION_PRESETS.map((minutes) => (
            <Chip className={chipClassName} key={minutes} value={minutes.toString()}>
              {t(`durationPreset.${minutes}`)}
            </Chip>
          ))}
          <Chip className={chipClassName} value="custom">
            {t('customDuration')}
          </Chip>
          {/* An end time needs a start to be after. */}
          {exact && form.exactTime ? (
            <Chip className={chipClassName} value="until">
              {editorT('until')}
            </Chip>
          ) : null}
        </ChipGroup>

        {length === 'custom' ? (
          <div className="mt-1 grid max-w-xs grid-cols-2 gap-3">
            <Field>
              <FieldLabel className="font-normal text-muted-foreground" htmlFor={`${id}-hours`}>
                {t('hours')}
              </FieldLabel>
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
              <FieldLabel className="font-normal text-muted-foreground" htmlFor={`${id}-minutes`}>
                {t('minutes')}
              </FieldLabel>
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
        {length === 'until' ? (
          <div className="mt-1 flex items-center gap-2.5">
            <FieldLabel className="font-normal text-muted-foreground" htmlFor={`${id}-end`}>
              {t('endTime')}
            </FieldLabel>
            <TimeInput
              aria-invalid={Boolean(form.localEndTime && form.localEndTime <= form.exactTime)}
              className="w-36"
              id={`${id}-end`}
              onValueChange={(value) => onChange({ localEndTime: value })}
              value={form.localEndTime}
            />
          </div>
        ) : null}
      </Field>
    </div>
  );
}
