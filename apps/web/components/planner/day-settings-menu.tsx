'use client';

import { ArrowLeftRight, ChevronDown, Pencil, Ruler, Settings2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { ItineraryDay, ItineraryTripPlace } from '@/lib/itinerary/api';
import * as Icons from '@/lib/icons';

/**
 * How a day is set up, on request (PRD 17.2.1): its intent, its title, whether
 * travel shows, where it starts and ends, its note, and moving its whole plan.
 * None of it is what the day is about, so it waits behind one control on the
 * day's header rather than standing on the page.
 */
export function DaySettingsMenu({
  canSuggestTimes,
  compact,
  dailyBaseSummary,
  day,
  onCompactChange,
  onDailyBaseChange,
  onEditContext,
  onEditName,
  onEditNote,
  onMoveDay,
  onOpenChange,
  onSuggestTimes,
  open,
  placeName,
  tripPlaces,
}: Readonly<{
  canSuggestTimes: boolean;
  compact: boolean;
  dailyBaseSummary: string;
  day: ItineraryDay;
  onCompactChange: (compact: boolean) => void;
  onDailyBaseChange: (tripPlaceId: string | null, departureTripPlaceId?: string | null) => void;
  onEditContext: () => void;
  onEditName: () => void;
  onEditNote: () => void;
  onMoveDay: (strategy: 'append' | 'swap') => void;
  onOpenChange: (open: boolean) => void;
  onSuggestTimes: () => void;
  open: boolean;
  placeName: (tripPlace: ItineraryTripPlace | null) => string | null;
  tripPlaces: readonly ItineraryTripPlace[];
}>) {
  const t = useTranslations('itinerary');
  const dayContextT = useTranslations('dayPlanningContext');
  const byId = (id: string | null) => tripPlaces.find((place) => place.id === id) ?? null;

  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <PopoverTrigger
        render={<Button aria-label={t('daySettings')} size="sm" type="button" variant="outline" />}
      >
        <Settings2 aria-hidden="true" data-icon="inline-start" />
        <span className="hidden sm:inline">{t('daySettings')}</span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[min(36rem,var(--available-height))] w-[min(22rem,calc(100vw-2rem))] gap-0 overflow-y-auto p-0"
        collisionAvoidance={{
          align: 'shift',
          fallbackAxisSide: 'none',
          side: 'shift',
        }}
        collisionPadding={16}
        positionMethod="fixed"
        sideOffset={8}
      >
        <PopoverHeader className="border-b border-border px-4 py-3.5">
          <PopoverTitle className="text-sm">{t('daySettings')}</PopoverTitle>
        </PopoverHeader>

        <div className="border-b border-border p-2">
          <Button
            className="w-full justify-start px-3"
            onClick={() => {
              onOpenChange(false);
              onEditContext();
            }}
            type="button"
            variant="ghost"
          >
            {dayContextT('title')}
          </Button>
          {canSuggestTimes ? (
            <Button
              className="w-full justify-start px-3"
              onClick={() => {
                onOpenChange(false);
                onSuggestTimes();
              }}
              type="button"
              variant="ghost"
            >
              <Icons.Ai aria-hidden="true" data-icon="inline-start" />
              {t('dayTimes.action')}
            </Button>
          ) : null}
          <Button
            className="w-full justify-start px-3"
            onClick={() => {
              onOpenChange(false);
              onEditName();
            }}
            variant="ghost"
          >
            <Pencil aria-hidden="true" data-icon="inline-start" />
            {day.name ? t('editDayName') : t('addDayName')}
          </Button>
        </div>

        <div className="flex items-center justify-between gap-4 px-4 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-secondary text-secondary-foreground">
              <Ruler aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0">
              <label
                className="text-sm font-medium text-foreground"
                htmlFor="itinerary-travel-details"
              >
                {t('distance')}
              </label>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{t('distanceHelp')}</p>
            </div>
          </div>
          <Switch
            checked={!compact}
            id="itinerary-travel-details"
            onCheckedChange={(checked) => onCompactChange(!checked)}
          />
        </div>

        <Collapsible className="border-t border-border px-4 py-3">
          <CollapsibleTrigger className="group w-full justify-between gap-3 text-left">
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-secondary text-secondary-foreground">
                <Icons.DailyBase aria-hidden="true" className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{t('dailyBase')}</span>
                <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
                  {dailyBaseSummary}
                </span>
              </span>
            </span>
            <ChevronDown
              aria-hidden="true"
              className="shrink-0 transition-transform duration-[var(--motion-standard)] group-data-[panel-open]:rotate-180 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="space-y-3 pt-4">
              <p className="text-xs leading-5 text-muted-foreground">{t('dailyBaseHelp')}</p>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">{t('dailyBaseArrival')}</p>
                <Select
                  onValueChange={(value) => onDailyBaseChange(value === 'none' ? null : value)}
                  value={day.dailyBaseTripPlaceId ?? 'none'}
                >
                  <SelectTrigger aria-label={t('dailyBaseArrival')} className="w-full" size="sm">
                    <SelectValue>
                      {day.dailyBaseTripPlaceId
                        ? placeName(byId(day.dailyBaseTripPlaceId))
                        : t('noDailyBase')}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem value="none">{t('noDailyBase')}</SelectItem>
                    {tripPlaces.map((place) => (
                      <SelectItem key={place.id} value={place.id}>
                        {placeName(place)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('dailyBaseDeparture')}
                </p>
                <Select
                  onValueChange={(value) =>
                    onDailyBaseChange(day.dailyBaseTripPlaceId, value === 'same' ? null : value)
                  }
                  value={day.dailyBaseDepartureTripPlaceId ?? 'same'}
                >
                  <SelectTrigger aria-label={t('dailyBaseDeparture')} className="w-full" size="sm">
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
          </CollapsiblePanel>
        </Collapsible>

        <div className="space-y-0.5 border-t border-border p-2">
          <Button
            className="w-full justify-start px-3"
            onClick={() => {
              onOpenChange(false);
              onEditNote();
            }}
            variant="ghost"
          >
            <Icons.Notes aria-hidden="true" data-icon="inline-start" />
            {day.notes ? t('editDayNote') : t('addDayNote')}
          </Button>
          {day.items.length ? (
            <>
              <Button
                className="mt-2 w-full justify-start px-3"
                onClick={() => onMoveDay('append')}
                variant="outline"
              >
                <Icons.Itinerary aria-hidden="true" data-icon="inline-start" />
                {t('dayMove.action')}
              </Button>
              {/* The same dialog, opened already knowing the answer. Swapping
                  was only ever reachable as a second question asked after
                  choosing a day, which is not where anyone goes looking. */}
              <Button
                className="mt-2 w-full justify-start px-3"
                onClick={() => onMoveDay('swap')}
                variant="outline"
              >
                <ArrowLeftRight aria-hidden="true" data-icon="inline-start" />
                {t('dayMove.swapAction')}
              </Button>
            </>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
