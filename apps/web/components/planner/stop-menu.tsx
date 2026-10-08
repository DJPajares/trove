'use client';

import {
  ArrowDown,
  ArrowUp,
  Copy,
  Ellipsis,
  ExternalLink,
  MapPin,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ItineraryItem, ItineraryPriority } from '@/lib/itinerary/api';
import * as Icons from '@/lib/icons';

export type StopMenuActions = {
  dayOptions: Array<{ id: string; label: string }>;
  onDeleteItem: (item: ItineraryItem) => void;
  onDuplicateItem: (item: ItineraryItem) => void;
  onEditItem: (item: ItineraryItem) => void;
  onMoveItem: (item: ItineraryItem, dayId: string | null, position: number) => void;
  onPlacePriorityChange?: (item: ItineraryItem, priority: ItineraryPriority | null) => void;
  /** Shows the stop's pin on the map. */
  onSelectItem: (item: ItineraryItem) => void;
  organizingItemId: string | null;
  savingPriorityIds?: ReadonlySet<string>;
  selectedDayId: string;
  unscheduledLabel: string;
};

/**
 * Everything a stop can be asked to do, in one menu (PRD 17.2.1).
 *
 * One menu instead of a row of controls: the card is content, not a toolbar,
 * and the menu behaves the same without hover on every form factor. Moving a
 * stop earlier, later or to another day is here too, so no reorder depends on
 * dragging (PRD 17.4).
 */
export function StopMenu({
  actions,
  index,
  item,
  itemCount,
  located,
  mapsHref,
  name,
}: Readonly<{
  actions: StopMenuActions;
  /** The stop's place among the day's stops, from zero. */
  index: number;
  item: ItineraryItem;
  itemCount: number;
  located: boolean;
  mapsHref: string | null;
  name: string;
}>) {
  const t = useTranslations('itinerary');
  const placesT = useTranslations('tripPlaces');
  const {
    dayOptions,
    onDeleteItem,
    onDuplicateItem,
    onEditItem,
    onMoveItem,
    onPlacePriorityChange,
    onSelectItem,
    organizingItemId,
    savingPriorityIds,
    selectedDayId,
    unscheduledLabel,
  } = actions;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={t('itemActions', { name })}
            disabled={organizingItemId === item.id}
            size="icon-sm"
            type="button"
            variant="ghost"
          />
        }
      >
        <Ellipsis aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem
          disabled={index === 0}
          onClick={() => onMoveItem(item, selectedDayId, index - 1)}
        >
          <ArrowUp aria-hidden="true" />
          {t('itemMenu.moveEarlier')}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={index === itemCount - 1}
          onClick={() => onMoveItem(item, selectedDayId, index + 1)}
        >
          <ArrowDown aria-hidden="true" />
          {t('itemMenu.moveLater')}
        </DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Icons.Itinerary aria-hidden="true" />
            {t('moveToDay')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
            <DropdownMenuRadioGroup
              onValueChange={(value) =>
                onMoveItem(item, value === 'unscheduled' ? null : value, 999)
              }
              value={selectedDayId}
            >
              {dayOptions.map((day) => (
                <DropdownMenuRadioItem key={day.id} value={day.id}>
                  {day.label}
                </DropdownMenuRadioItem>
              ))}
              <DropdownMenuRadioItem value="unscheduled">{unscheduledLabel}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        {item.tripPlace && onPlacePriorityChange ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={savingPriorityIds?.has(item.tripPlace.id)}>
              <Icons.MustGo aria-hidden="true" />
              {placesT('priorityMenuLabel')}
              <span className="ml-2 text-xs text-muted-foreground">
                {placesT(`priority.${item.tripPlace.priority ?? 'none'}`)}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                onValueChange={(value) =>
                  onPlacePriorityChange(
                    item,
                    value === 'none' ? null : (value as ItineraryPriority),
                  )
                }
                value={item.tripPlace.priority ?? 'none'}
              >
                {(['none', 'must_go', 'interested', 'maybe'] as const).map((priority) => (
                  <DropdownMenuRadioItem
                    disabled={savingPriorityIds?.has(item.tripPlace!.id)}
                    key={priority}
                    value={priority}
                  >
                    {placesT(`priority.${priority}`)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}

        <DropdownMenuItem onClick={() => onEditItem(item)}>
          <Pencil aria-hidden="true" />
          {t('itemMenu.edit')}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={organizingItemId === item.id}
          onClick={() => onDuplicateItem(item)}
        >
          <Copy aria-hidden="true" />
          {t('itemMenu.duplicate')}
        </DropdownMenuItem>
        {located ? (
          <DropdownMenuItem onClick={() => onSelectItem(item)}>
            <MapPin aria-hidden="true" />
            {t('itemMenu.showOnMap')}
          </DropdownMenuItem>
        ) : null}
        {mapsHref ? (
          <DropdownMenuLinkItem render={<a href={mapsHref} rel="noreferrer" target="_blank" />}>
            <ExternalLink aria-hidden="true" />
            {t('itemMenu.openPlace')}
          </DropdownMenuLinkItem>
        ) : null}

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => onDeleteItem(item)} variant="destructive">
          <Trash2 aria-hidden="true" />
          {t('itemMenu.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
