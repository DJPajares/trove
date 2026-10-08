'use client';

import { useTranslations } from 'next-intl';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { ItineraryDay, ItineraryTripPlace } from '@/lib/itinerary/api';
import * as Icons from '@/lib/icons';

/**
 * Where a day starts and where it ends - its Stay (PRD 18.4) - set on its own
 * rather than tucked into a panel of other settings.
 *
 * A booking can already decide it: the server reads the day's accommodation
 * and says so, and that is shown for what it is, so choosing a Stay by hand is
 * a choice to override the booking rather than a guess at what it was. The end
 * can differ from the start on a day that moves between stays (PRD 18.4.1).
 */
export function StaySheet({
  day,
  onChange,
  onOpenChange,
  open,
  placeName,
  tripPlaces,
}: Readonly<{
  day: ItineraryDay;
  onChange: (tripPlaceId: string | null, departureTripPlaceId?: string | null) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  placeName: (tripPlace: ItineraryTripPlace | null) => string | null;
  tripPlaces: readonly ItineraryTripPlace[];
}>) {
  const t = useTranslations('itinerary');
  const stayT = useTranslations('itinerary.planner.staySheet');
  const byId = (id: string | null | undefined) =>
    id ? (tripPlaces.find((place) => place.id === id) ?? null) : null;
  const booked =
    day.stay?.startSource === 'accommodation' || day.stay?.endSource === 'accommodation'
      ? byId(day.stay.endTripPlaceId ?? day.stay.startTripPlaceId)
      : null;

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent
        className="w-full md:data-[side=right]:w-[min(28rem,calc(100%-0.5rem))]"
        closeLabel={t('close')}
      >
        <SheetHeader className="border-b">
          <SheetTitle>{t('dailyBase')}</SheetTitle>
          <SheetDescription>{t('dailyBaseHelp')}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-[calc(var(--safe-bottom)+1.5rem)] sm:px-6">
          {booked ? (
            <p className="flex items-start gap-2 rounded-[var(--radius-lg)] bg-surface-tint/60 p-3 text-sm">
              <Icons.Reservations
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-primary"
              />
              <span>{stayT('fromBooking', { name: placeName(booked) ?? t('providerPlace') })}</span>
            </p>
          ) : null}
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t('dailyBaseArrival')}</p>
            <Select
              onValueChange={(value) => onChange(value === 'none' ? null : value)}
              value={day.dailyBaseTripPlaceId ?? 'none'}
            >
              <SelectTrigger aria-label={t('dailyBaseArrival')} className="w-full">
                <SelectValue>
                  {day.dailyBaseTripPlaceId
                    ? placeName(byId(day.dailyBaseTripPlaceId))
                    : booked
                      ? stayT('useBooking')
                      : t('noDailyBase')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="none">
                  {booked ? stayT('useBooking') : t('noDailyBase')}
                </SelectItem>
                {tripPlaces.map((place) => (
                  <SelectItem key={place.id} value={place.id}>
                    {placeName(place)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t('dailyBaseDeparture')}</p>
            <Select
              onValueChange={(value) =>
                onChange(day.dailyBaseTripPlaceId, value === 'same' ? null : value)
              }
              value={day.dailyBaseDepartureTripPlaceId ?? 'same'}
            >
              <SelectTrigger aria-label={t('dailyBaseDeparture')} className="w-full">
                <SelectValue>
                  {day.dailyBaseDepartureTripPlaceId
                    ? placeName(byId(day.dailyBaseDepartureTripPlaceId))
                    : t('dailyBaseSameAsArrival')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="same">{t('dailyBaseSameAsArrival')}</SelectItem>
                {tripPlaces.map((place) => (
                  <SelectItem key={place.id} value={place.id}>
                    {placeName(place)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
