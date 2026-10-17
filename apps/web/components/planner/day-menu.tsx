'use client';

import { ArrowLeftRight, Ellipsis, ListOrdered, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ItineraryDay } from '@/lib/itinerary/api';
import * as Icons from '@/lib/icons';

/**
 * What can be done to a day, on request (PRD 17.2.1): name it, note it, say
 * what it is for, have its times suggested or its order checked, show or hide
 * its travel, and move or swap its whole plan. Where it starts and ends is the
 * planner bar's Stay, above.
 *
 * One menu rather than the panel it replaces: each choice opens the one thing
 * it is about, so the day's setup never stands on the page asking for
 * attention it does not need. Its trigger is the same quiet "more" the trip
 * and each stop use: easy to find, never competing with the day's actions.
 */
export function DayMenu({
  canCheckOrder,
  className,
  movementDisabled,
  canSuggestTimes,
  compact,
  day,
  onCheckOrder,
  onCompactChange,
  onEditContext,
  onEditName,
  onEditNote,
  onMoveDay,
  onSuggestTimes,
  previewHref,
}: Readonly<{
  /** Checking the order asks the server; offline it is not offered. */
  canCheckOrder: boolean;
  /** Placement only. */
  className?: string;
  movementDisabled?: boolean;
  canSuggestTimes: boolean;
  compact: boolean;
  day: ItineraryDay;
  onCheckOrder: () => void;
  onCompactChange: (compact: boolean) => void;
  onEditContext: () => void;
  onEditName: () => void;
  onEditNote: () => void;
  onMoveDay: (strategy: 'append' | 'swap') => void;
  onSuggestTimes: () => void;
  /** Previewing a day already lived is offered here rather than beside Memories. */
  previewHref?: string;
}>) {
  const t = useTranslations('itinerary');
  const menuT = useTranslations('itinerary.planner.dayMenu');
  const dayContextT = useTranslations('dayPlanningContext');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={t('daySettings')}
            className={className}
            size="icon-sm"
            title={t('daySettings')}
            type="button"
            variant="ghost"
          />
        }
      >
        <Ellipsis aria-hidden="true" />
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
        {previewHref ? (
          <DropdownMenuLinkItem render={<Link href={previewHref} />}>
            <Icons.Preview aria-hidden="true" />
            {menuT('preview')}
          </DropdownMenuLinkItem>
        ) : null}

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
            <DropdownMenuItem disabled={movementDisabled} onClick={() => onMoveDay('append')}>
              <Icons.Itinerary aria-hidden="true" />
              {t('dayMove.action')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={movementDisabled} onClick={() => onMoveDay('swap')}>
              <ArrowLeftRight aria-hidden="true" />
              {t('dayMove.swapAction')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
