'use client';

import { Clock3, Hourglass } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId } from 'react';

import {
  SuggestedTimeAction,
  type SuggestedTimeActionProps,
} from '@/components/itinerary-suggested-time';
import { usePreferences } from '@/components/preferences-provider';
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
import { Switch } from '@/components/ui/switch';
import {
  formatSuggestedClock,
  formatSuggestedDuration,
} from '@/lib/itinerary/day-time-suggestions';
import {
  durationMinutesFromParts,
  durationParts,
  ITINERARY_DURATION_PRESETS,
  type StopEditorCustomDuration,
  type StopEditorForm,
} from '@/lib/itinerary/item-editor';

import { EditRow, Segmented } from './edit-row';

const PARTS = ['anytime', 'morning', 'afternoon', 'evening'] as const;

/**
 * When a stop happens and for how long, as two lines that say what is set -
 * "8:00 AM · Fixed", "3 hr" - and open in place to change it.
 *
 * When is either a time or a part of the day, chosen first, so the two never
 * sit side by side; only a time brings whether it is fixed. How long is a
 * length, or - once there is a time - until an end time, so a stop never has
 * both. The stop editor and the timing sheet both edit timing with it, so the
 * two can never disagree about what a time means.
 */
export function TimingField({
  customDuration,
  form,
  onChange,
  onCustomDurationChange,
  onRemove,
  open,
  suggest,
  protectedTiming,
}: Readonly<{
  customDuration: StopEditorCustomDuration;
  form: StopEditorForm;
  onChange: (patch: Partial<StopEditorForm>) => void;
  onCustomDurationChange: (next: StopEditorCustomDuration) => void;
  /** Clears when the stop happens: its part of the day, time and end time. */
  onRemove: () => void;
  /** Opened for timing, both lines start open. */
  open?: boolean;
  /** Offered only where a suggestion can be honest - online, for a stop the server can place. */
  suggest: SuggestedTimeActionProps | null;
  protectedTiming?: boolean;
}>) {
  const t = useTranslations('itinerary');
  const editorT = useTranslations('itinerary.planner.editor');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const id = useId();
  const clock = (time: string) =>
    formatSuggestedClock(time, locale, preferences.timeFormat === '12h');

  const exact = form.schedule === 'exact';
  const mode = exact ? 'time' : form.schedule === 'none' ? null : 'part';
  const fixed = Boolean(protectedTiming) || form.timingFlexibility !== 'flexible';
  const presets = ITINERARY_DURATION_PRESETS.map(String);
  const length =
    form.timingMode === 'end_time'
      ? 'until'
      : customDuration.open || (form.durationMinutes && !presets.includes(form.durationMinutes))
        ? 'custom'
        : form.durationMinutes || null;

  const whenValue =
    exact && form.exactTime
      ? fixed
        ? editorT('fixedValue', { time: clock(form.exactTime) })
        : clock(form.exactTime)
      : form.schedule !== 'none' && form.schedule !== 'exact'
        ? t(`schedule.${form.schedule}`)
        : null;
  const lengthValue =
    form.timingMode === 'end_time'
      ? form.localEndTime
        ? editorT('untilValue', { time: clock(form.localEndTime) })
        : null
      : form.durationMinutes && Number(form.durationMinutes) > 0
        ? formatSuggestedDuration(Number(form.durationMinutes), t)
        : null;

  function chooseMode(next: 'part' | 'time') {
    if (next === 'time') onChange({ schedule: 'exact' });
    else
      onChange({
        // An end time is only meaningful after an exact start.
        ...(form.timingMode === 'end_time'
          ? { durationMinutes: '', localEndTime: '', timingMode: 'duration' as const }
          : {}),
        schedule: 'anytime',
      });
  }

  function chooseLength(value: string) {
    if (value === 'none') {
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

  const lengthLabel = (value: string) =>
    value === 'until'
      ? editorT('untilOption')
      : value === 'custom'
        ? t('customDuration')
        : value === 'none'
          ? editorT('noDuration')
          : t(`durationPreset.${value as `${(typeof ITINERARY_DURATION_PRESETS)[number]}`}`);

  return (
    <>
      <EditRow defaultOpen={open} icon={<Clock3 />} label={t('scheduleLabel')} value={whenValue}>
        <Segmented
          label={t('scheduleLabel')}
          onChange={chooseMode}
          options={[
            { label: editorT('time'), value: 'time' },
            { label: editorT('partOfDay'), value: 'part' },
          ]}
          value={mode}
        />
        {mode === 'time' ? (
          <div className="flex items-center justify-between gap-3">
            <TimeInput
              aria-label={editorT('time')}
              className="w-40"
              id={`${id}-exact`}
              onValueChange={(value) => onChange({ exactTime: value })}
              required
              value={form.exactTime}
            />
            <label
              className="flex items-center gap-2.5 text-sm font-medium"
              htmlFor={`${id}-fixed`}
            >
              {editorT('fixedTime')}
              <Switch
                checked={fixed}
                disabled={protectedTiming}
                id={`${id}-fixed`}
                onCheckedChange={(checked) =>
                  onChange({ timingFlexibility: checked ? 'fixed' : 'flexible' })
                }
              />
            </label>
          </div>
        ) : mode === 'part' ? (
          <Segmented
            label={editorT('partOfDay')}
            onChange={(value) => onChange({ schedule: value })}
            options={PARTS.map((value) => ({ label: t(`schedule.${value}`), value }))}
            value={exact ? null : (form.schedule as (typeof PARTS)[number])}
          />
        ) : null}
        {exact && protectedTiming ? (
          <FieldDescription>{t('connectedTiming.protected')}</FieldDescription>
        ) : null}
        {suggest ? <SuggestedTimeAction {...suggest} /> : null}
        {mode ? (
          <Button className="-ml-2.5" onClick={onRemove} size="sm" type="button" variant="ghost">
            {editorT('clearWhen')}
          </Button>
        ) : null}
      </EditRow>

      <EditRow
        defaultOpen={open}
        icon={<Hourglass />}
        label={editorT('duration')}
        value={lengthValue}
      >
        <Select onValueChange={(value) => chooseLength(String(value))} value={length ?? 'none'}>
          <SelectTrigger aria-label={editorT('duration')} className="w-full">
            <SelectValue>{(value: string) => lengthLabel(value)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{lengthLabel('none')}</SelectItem>
            {presets.map((value) => (
              <SelectItem key={value} value={value}>
                {lengthLabel(value)}
              </SelectItem>
            ))}
            <SelectItem value="custom">{lengthLabel('custom')}</SelectItem>
            {/* An end time needs a start to be after. */}
            {exact && form.exactTime ? (
              <SelectItem value="until">{lengthLabel('until')}</SelectItem>
            ) : null}
          </SelectContent>
        </Select>
        {length === 'custom' ? (
          <div className="grid grid-cols-2 gap-3">
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
          <TimeInput
            aria-invalid={Boolean(form.localEndTime && form.localEndTime <= form.exactTime)}
            aria-label={t('endTime')}
            className="w-40"
            id={`${id}-end`}
            onValueChange={(value) => onChange({ localEndTime: value })}
            value={form.localEndTime}
          />
        ) : null}
      </EditRow>
    </>
  );
}
