'use client';
import { TRAVEL_INTERESTS, type TripPlanningPreferences } from '@trove/types';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';

export function TripPlanningPreferencesFields({
  value,
  onChange,
}: Readonly<{
  value: TripPlanningPreferences;
  onChange: (value: TripPlanningPreferences) => void;
}>) {
  const t = useTranslations('planningPreferences');
  return (
    <div className="space-y-5 pt-5">
      <Field>
        <FieldLabel htmlFor="trip-pace">{t('pace')}</FieldLabel>
        <Select
          value={value.pace ?? 'default'}
          onValueChange={(pace) => {
            if (pace)
              onChange({
                ...value,
                pace: pace === 'default' ? null : (pace as TripPlanningPreferences['pace']),
              });
          }}
        >
          <SelectTrigger id="trip-pace" className="w-full">
            <SelectValue>{(pace) => t(`paces.${pace}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {['default', 'relaxed', 'balanced', 'packed'].map((pace) => (
              <SelectItem key={pace} value={pace}>
                {t(`paces.${pace}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>{t('paceHint')}</FieldDescription>
      </Field>
      <Field>
        <FieldLabel>{t('interests')}</FieldLabel>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('interests')}>
          {TRAVEL_INTERESTS.map((interest) => (
            <Button
              key={interest}
              type="button"
              size="sm"
              variant={value.interests.includes(interest) ? 'secondary' : 'outline'}
              aria-pressed={value.interests.includes(interest)}
              onClick={() =>
                onChange({
                  ...value,
                  interests: value.interests.includes(interest)
                    ? value.interests.filter((id) => id !== interest)
                    : [...value.interests, interest],
                })
              }
            >
              {t(`interestsList.${interest}`)}
            </Button>
          ))}
        </div>
        <FieldDescription>{t('interestsHint')}</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="trip-other-interests">{t('otherInterests')}</FieldLabel>
        <Input
          id="trip-other-interests"
          maxLength={200}
          value={value.unmatchedInterests.join(', ')}
          onChange={(event) =>
            onChange({
              ...value,
              unmatchedInterests: event.target.value ? [event.target.value] : [],
            })
          }
        />
        <FieldDescription>{t('otherInterestsHint')}</FieldDescription>
      </Field>
    </div>
  );
}
