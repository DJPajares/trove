'use client';

import { Copy, Ellipsis, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ItineraryItem } from '@/lib/itinerary/api';
import { resolvePlaceCategoryFallback } from '@/lib/media/place-category-fallback';
import type { TrovePlaceCategory } from '@/lib/place-categories';

/**
 * Stops kept without a day (PRD 17.5): ideas waiting for a place in the
 * plan, with everything they were given still on them.
 *
 * Each is offered a day first - "Schedule…" opens the same sheet that moves a
 * stop between days - because a stop is changed against its day's date and
 * time zone, and an idea without one has neither yet. Duplicate and Delete are
 * one menu away, and its Place opens like any other.
 */
export function UnscheduledTray({
  items,
  onDelete,
  onDuplicate,
  onSchedule,
  onViewDetails,
  organizingItemId,
  resolveItem,
}: Readonly<{
  items: readonly ItineraryItem[];
  onDelete: (item: ItineraryItem) => void;
  onDuplicate: (item: ItineraryItem) => void;
  onSchedule: (item: ItineraryItem) => void;
  onViewDetails: (item: ItineraryItem) => void;
  organizingItemId: string | null;
  resolveItem: (item: ItineraryItem) => { category: TrovePlaceCategory | undefined; name: string };
}>) {
  const t = useTranslations('itinerary');
  const trayT = useTranslations('itinerary.planner.unscheduled');
  if (!items.length) return null;

  return (
    <section aria-labelledby="unscheduled-tray-heading" data-slot="unscheduled-tray">
      <h2 className="text-lg font-semibold" id="unscheduled-tray-heading">
        {trayT('title', { count: items.length })}
      </h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{t('unscheduledDescription')}</p>
      <ul aria-label={t('unscheduled')} className="mt-3 space-y-2">
        {items.map((item) => {
          const view = resolveItem(item);
          const { Icon } = resolvePlaceCategoryFallback(item.tripPlace ? view.category : undefined);
          return (
            <li
              className="relative flex items-center gap-3 rounded-[var(--radius-xl)] border border-dashed border-border bg-card/60 p-3"
              id={`itinerary-item-${item.id}`}
              key={item.id}
              tabIndex={-1}
            >
              <span
                aria-hidden="true"
                className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-secondary text-secondary-foreground"
              >
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                {item.tripPlace ? (
                  <button
                    aria-label={t('viewDetailsFor', { name: view.name })}
                    className="max-w-full truncate rounded-[var(--radius-sm)] text-left text-sm font-semibold outline-none after:absolute after:inset-0 hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
                    onClick={() => onViewDetails(item)}
                    type="button"
                  >
                    {view.name}
                  </button>
                ) : (
                  <span className="block truncate text-sm font-semibold">{view.name}</span>
                )}
                {item.notes ? (
                  <span className="block truncate text-xs text-muted-foreground">{item.notes}</span>
                ) : null}
              </span>
              <span className="relative z-10 flex shrink-0 items-center gap-1">
                <Button
                  aria-label={t('scheduleItem', { name: view.name })}
                  disabled={organizingItemId === item.id}
                  onClick={() => onSchedule(item)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {trayT('schedule')}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        aria-label={t('itemActions', { name: view.name })}
                        disabled={organizingItemId === item.id}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      />
                    }
                  >
                    <Ellipsis aria-hidden="true" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-44">
                    <DropdownMenuItem onClick={() => onDuplicate(item)}>
                      <Copy aria-hidden="true" />
                      {t('itemMenu.duplicate')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onDelete(item)} variant="destructive">
                      <Trash2 aria-hidden="true" />
                      {t('itemMenu.delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
