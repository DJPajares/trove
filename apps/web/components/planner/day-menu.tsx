'use client';

import { ArrowLeftRight, ListOrdered, Pencil, Settings2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ItineraryDay } from '@/lib/itinerary/api';
import * as Icons from '@/lib/icons';

/**
 * What can be done to a day, on request (PRD 17.2.1): name it, note it, say
 * what it is for, have its times suggested or its order checked, set where it
 * starts and ends, show or hide its travel, and move or swap its whole plan.
 *
 * One menu rather than the panel it replaces: each choice opens the one thing
 * it is about, so the day's setup never stands on the page asking for
 * attention it does not need.
 */
export function DayMenu({
  canCheckOrder,
  canSuggestTimes,
  compact,
  day,
  onCheckOrder,
  onCompactChange,
  onEditContext,
  onEditName,
  onEditNote,
  onEditStay,
  onMoveDay,
  onSuggestTimes,
}: Readonly<{
  /** Checking the order asks the server; offline it is not offered. */
  canCheckOrder: boolean;
  canSuggestTimes: boolean;
  compact: boolean;
  day: ItineraryDay;
  onCheckOrder: () => void;
  onCompactChange: (compact: boolean) => void;
  onEditContext: () => void;
  onEditName: () => void;
  onEditNote: () => void;
  onEditStay: () => void;
  onMoveDay: (strategy: 'append' | 'swap') => void;
  onSuggestTimes: () => void;
}>) {
  const t = useTranslations('itinerary');
  const menuT = useTranslations('itinerary.planner.dayMenu');
  const dayContextT = useTranslations('dayPlanningContext');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button aria-label={t('daySettings')} size="sm" type="button" variant="outline" />}
      >
        <Settings2 aria-hidden="true" data-icon="inline-start" />
        <span className="hidden sm:inline">{t('daySettings')}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuItem onClick={onEditName}>
          <Pencil aria-hidden="true" />
          {day.name ? t('editDayName') : t('addDayName')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onEditNote}>
          <Icons.Notes aria-hidden="true" />
          {day.notes ? t('editDayNote') : t('addDayNote')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onEditContext}>
          <Icons.TripInfo aria-hidden="true" />
          {dayContextT('title')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onEditStay}>
          <Icons.DailyBase aria-hidden="true" />
          {menuT('stay')}
        </DropdownMenuItem>

        {canCheckOrder || canSuggestTimes ? <DropdownMenuSeparator /> : null}
        {canSuggestTimes ? (
          <DropdownMenuItem onClick={onSuggestTimes}>
            <Icons.Ai aria-hidden="true" />
            {t('dayTimes.action')}
          </DropdownMenuItem>
        ) : null}
        {canCheckOrder ? (
          <DropdownMenuItem onClick={onCheckOrder}>
            <ListOrdered aria-hidden="true" />
            {menuT('checkOrder')}
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={!compact}
          onCheckedChange={(checked) => onCompactChange(!checked)}
        >
          {menuT('travel')}
        </DropdownMenuCheckboxItem>

        {day.items.length ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onMoveDay('append')}>
              <Icons.Itinerary aria-hidden="true" />
              {t('dayMove.action')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onMoveDay('swap')}>
              <ArrowLeftRight aria-hidden="true" />
              {t('dayMove.swapAction')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
