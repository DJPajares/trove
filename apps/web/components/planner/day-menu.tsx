'use client';

import { ArrowLeftRight, ListOrdered, SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ItineraryDay } from '@/lib/itinerary/api';
import * as Icons from '@/lib/icons';

/**
 * What can be done to a day as a whole (PRD 17.2.1): say what it is for and
 * how much time it has, have its times suggested or its order checked, move or
 * swap its plan, and show or hide its travel. Its title and note are edited
 * where they are shown, and where it starts and ends is the planner bar's Stay.
 *
 * The trigger is a labelled pill on the day's own photograph, beside its Plan
 * Score: the day's header is where a day's settings are looked for, and a
 * label says what an icon alone would leave to guesswork.
 */
export function DayMenu({
  canCheckOrder,
  movementDisabled,
  canSuggestTimes,
  compact,
  day,
  onCheckOrder,
  onCompactChange,
  onEditContext,
  onMoveDay,
  onSuggestTimes,
}: Readonly<{
  /** Checking the order asks the server; offline it is not offered. */
  canCheckOrder: boolean;
  movementDisabled?: boolean;
  canSuggestTimes: boolean;
  compact: boolean;
  day: ItineraryDay;
  onCheckOrder: () => void;
  onCompactChange: (compact: boolean) => void;
  onEditContext: () => void;
  onMoveDay: (strategy: 'append' | 'swap') => void;
  onSuggestTimes: () => void;
}>) {
  const t = useTranslations('itinerary');
  const menuT = useTranslations('itinerary.planner.dayMenu');
  const dayContextT = useTranslations('dayPlanningContext');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-8 items-center gap-1.5 rounded-full border border-score-media-foreground/20 bg-score-media-background px-3 text-sm font-semibold text-score-media-foreground outline-none transition-colors duration-[var(--motion-standard)] hover:border-score-media-foreground/40 focus-visible:ring-2 focus-visible:ring-score-media-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-score-media-background motion-reduce:transition-none">
        <SlidersHorizontal aria-hidden="true" className="size-3.5" />
        {t('daySettings')}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{menuT('plan')}</DropdownMenuLabel>
          <DropdownMenuItem onClick={onEditContext}>
            <Icons.TripInfo aria-hidden="true" />
            {dayContextT('title')}
          </DropdownMenuItem>
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
        </DropdownMenuGroup>

        {day.items.length ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>{menuT('move')}</DropdownMenuLabel>
              <DropdownMenuItem disabled={movementDisabled} onClick={() => onMoveDay('append')}>
                <Icons.Itinerary aria-hidden="true" />
                {t('dayMove.action')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={movementDisabled} onClick={() => onMoveDay('swap')}>
                <ArrowLeftRight aria-hidden="true" />
                {t('dayMove.swapAction')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        ) : null}

        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{menuT('view')}</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            checked={!compact}
            onCheckedChange={(checked) => onCompactChange(!checked)}
          >
            {menuT('travel')}
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
