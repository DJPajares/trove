import { useTranslations } from 'next-intl';

import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Trip } from '@/lib/trips/api';

export type TripOptionalDetailsValues = {
  partySize: string;
  planningReadiness: 'in_progress' | 'ready';
  startingLocation: string;
};

type TripOptionalDetailsProps = {
  /** The form owns this state; these fields only report changes back to it. */
  onChange: (changes: Partial<TripOptionalDetailsValues>) => void;
  trip: Trip | null;
  values: TripOptionalDetailsValues;
};

/**
 * Everything a trip can have but does not need.
 *
 * This is a child rather than inline markup so the disclosure that holds it can
 * leave it unmounted until a traveller opens it.
 */
export function TripOptionalDetails({
  onChange,
  trip,
  values,
}: Readonly<TripOptionalDetailsProps>) {
  const t = useTranslations('trips');

  return (
    <div className="space-y-5 pt-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="trip-party-size">{t('partySize')}</FieldLabel>
          <Input
            id="trip-party-size"
            inputMode="numeric"
            max={99}
            min={1}
            onChange={(event) => onChange({ partySize: event.target.value })}
            type="number"
            value={values.partySize}
          />
          <FieldDescription>{t('partySizeHint')}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="trip-readiness">{t('readiness')}</FieldLabel>
          <Select
            onValueChange={(value) => {
              if (!value) return;
              onChange({
                planningReadiness: value as TripOptionalDetailsValues['planningReadiness'],
              });
            }}
            value={values.planningReadiness}
          >
            <SelectTrigger className="w-full" id="trip-readiness">
              <SelectValue>
                {(value) => (value === 'ready' ? t('ready') : t('inProgress'))}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="in_progress">{t('inProgress')}</SelectItem>
              <SelectItem value="ready">{t('ready')}</SelectItem>
            </SelectContent>
          </Select>
          <FieldDescription>{t('readinessHint')}</FieldDescription>
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="trip-starting-location">{t('startingLocation')}</FieldLabel>
        <Input
          id="trip-starting-location"
          maxLength={200}
          onChange={(event) => onChange({ startingLocation: event.target.value })}
          placeholder={
            trip?.startingLocation?.isOverride ? undefined : t('startingLocationPlaceholder')
          }
          value={values.startingLocation}
        />
        <FieldDescription>
          {trip?.startingLocation && !trip.startingLocation.isOverride
            ? t('startingLocationHome', { location: trip.startingLocation.name })
            : t('startingLocationHint')}
        </FieldDescription>
      </Field>
    </div>
  );
}
