'use client';
import { useTripReadOnly } from '@/components/trip-provider';

import { ArrowLeftRight, Ellipsis, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  onSwapItem?: (item: ItineraryItem) => void;
  movementDisabled?: boolean;
  onDeleteItem: (item: ItineraryItem) => void;
  onEditItem: (item: ItineraryItem) => void;
  /** Opens the sheet that moves the stop to another day or to Unscheduled. */
  onMoveToDay: (item: ItineraryItem) => void;
  onPlacePriorityChange?: (item: ItineraryItem, priority: ItineraryPriority | null) => void;
  organizingItemId: string | null;
  savingPriorityIds?: ReadonlySet<string>;
};

/**
 * What a stop can be asked to do that its card does not already offer: edit
 * it, set its priority, move it to another day or swap it with another stop,
 * and delete it. Reordering within the day is the card's drag handle; showing
 * it on the map is its number; Google Maps is in its place details.
 */
export function StopMenu({
  actions,
  item,
  name,
}: Readonly<{
  actions: StopMenuActions;
  item: ItineraryItem;
  name: string;
}>) {
  const t = useTranslations('itinerary');
  const readOnly = useTripReadOnly();
  const placesT = useTranslations('tripPlaces');
  const {
    onDeleteItem,
    onEditItem,
    onMoveToDay,
    onPlacePriorityChange,
    organizingItemId,
    savingPriorityIds,
  } = actions;

  if (readOnly) return null;
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
        <DropdownMenuItem onClick={() => onEditItem(item)}>
          <Pencil aria-hidden="true" />
          {t('itemMenu.edit')}
        </DropdownMenuItem>
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

        <DropdownMenuSeparator />

        <DropdownMenuItem disabled={actions.movementDisabled} onClick={() => onMoveToDay(item)}>
          <Icons.Itinerary aria-hidden="true" />
          {t('planner.move.menuItem')}
        </DropdownMenuItem>
        {actions.onSwapItem && item.itineraryDayId ? (
          <DropdownMenuItem
            disabled={actions.movementDisabled}
            onClick={() => actions.onSwapItem?.(item)}
          >
            <ArrowLeftRight aria-hidden="true" />
            {t('movement.swap')}
          </DropdownMenuItem>
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
