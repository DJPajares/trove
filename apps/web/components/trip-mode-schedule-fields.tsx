'use client';

import { TimeInput } from '@/components/time-input';
import { useTranslations } from 'next-intl';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type TripModeSchedule = 'afternoon' | 'anytime' | 'evening' | 'exact' | 'morning' | 'none';

export function TripModeScheduleFields({
  exactTime,
  onExactTimeChange,
  onScheduleChange,
  schedule,
}: Readonly<{
  exactTime: string;
  onExactTimeChange: (value: string) => void;
  onScheduleChange: (value: TripModeSchedule) => void;
  schedule: TripModeSchedule;
}>) {
  const t = useTranslations('tripMode.views.today');

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field>
        <FieldLabel htmlFor="trip-mode-schedule">{t('scheduleLabel')}</FieldLabel>
        <Select
          onValueChange={(value) => onScheduleChange(value as TripModeSchedule)}
          value={schedule}
        >
          <SelectTrigger className="w-full" id="trip-mode-schedule">
            <SelectValue>{t(`schedule.${schedule}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            {(['none', 'exact', 'morning', 'afternoon', 'evening', 'anytime'] as const).map(
              (value) => (
                <SelectItem key={value} value={value}>
                  {t(`schedule.${value}`)}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </Field>
      {schedule === 'exact' ? (
        <Field>
          <FieldLabel htmlFor="trip-mode-exact-time">{t('exactTime')}</FieldLabel>
          <TimeInput
            aria-describedby="trip-mode-exact-time-hint"
            id="trip-mode-exact-time"
            onValueChange={onExactTimeChange}
            required
            value={exactTime}
          />
          <FieldDescription id="trip-mode-exact-time-hint">{t('localTimeHint')}</FieldDescription>
        </Field>
      ) : null}
    </div>
  );
}
