'use client';

import type { Announcements, ScreenReaderInstructions } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, type ComponentProps } from 'react';

import { resolvePlaceCategoryFallback } from '@/lib/media/place-category-fallback';
import type { TrovePlaceCategory } from '@/lib/place-categories';
import { cn } from '@/lib/utils';

import { StopCard } from './stop-card';

/**
 * A stop that can be dragged to another place in its day, by its grip only.
 *
 * The grip is the one drag source, so a finger scrolling the day never starts
 * a drag, and it is a real button: Space picks the stop up, the arrow keys
 * move it, Space puts it down and Escape puts it back (PRD 4.6). What stays in
 * the list while it moves is a faint outline of where it came from.
 */
export function SortableStopCard({
  dragDisabled,
  dragLabel,
  observeRef,
  ...card
}: ComponentProps<typeof StopCard> & {
  dragDisabled: boolean;
  dragLabel: string;
  observeRef?: (node: HTMLLIElement | null) => void;
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ disabled: dragDisabled, id: card.item.id });

  const rowRef = useCallback(
    (node: HTMLLIElement | null) => {
      setNodeRef(node);
      observeRef?.(node);
    },
    [setNodeRef, observeRef],
  );

  return (
    <StopCard
      {...card}
      dragHandle={
        dragDisabled ? undefined : (
          <button
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={dragLabel}
            className="relative grid size-9 cursor-grab touch-none place-items-center rounded-[var(--radius-md)] text-muted-foreground outline-none after:absolute after:-inset-1 hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing"
            data-slot="stop-drag-handle"
            type="button"
          >
            <GripVertical aria-hidden="true" className="size-4" />
          </button>
        )
      }
      placeholder={isDragging}
      rowRef={rowRef}
      rowStyle={{ transform: CSS.Translate.toString(transform), transition }}
    />
  );
}

/** The stop under the pointer while it is dragged: what it is and when, lifted off the page. */
export function StopDragPreview({
  category,
  name,
  when,
}: Readonly<{ category: TrovePlaceCategory | undefined; name: string; when: string | null }>) {
  const { Icon } = resolvePlaceCategoryFallback(category);

  return (
    <div
      className={cn(
        'ml-[3.25rem] flex items-center gap-3 rounded-[var(--radius-xl)] border border-primary/40 bg-card p-3 shadow-[var(--shadow-elevated)]',
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-md)] bg-secondary text-secondary-foreground"
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{name}</span>
        {when ? <span className="block text-xs text-muted-foreground">{when}</span> : null}
      </span>
      <GripVertical aria-hidden="true" className="size-4 text-muted-foreground" />
    </div>
  );
}

/**
 * What a screen reader hears while a stop is moved: which stop, and where in
 * the day it is now, in the traveller's language rather than the library's.
 */
export function useStopReorderSpeech(names: ReadonlyMap<string, string>, ids: readonly string[]) {
  const t = useTranslations('itinerary.planner.reorder');
  const nameOf = (id: string | number) => names.get(String(id)) ?? '';
  const positionOf = (id: string | number | undefined) =>
    id === undefined ? 0 : ids.indexOf(String(id)) + 1;

  const announcements: Announcements = {
    onDragCancel: ({ active }) =>
      t('cancelled', { name: nameOf(active.id), position: positionOf(active.id) }),
    onDragEnd: ({ active, over }) =>
      t('dropped', {
        count: ids.length,
        name: nameOf(active.id),
        position: positionOf(over?.id ?? active.id),
      }),
    onDragOver: ({ active, over }) =>
      over
        ? t('moved', { count: ids.length, name: nameOf(active.id), position: positionOf(over.id) })
        : undefined,
    onDragStart: ({ active }) =>
      t('pickedUp', {
        count: ids.length,
        name: nameOf(active.id),
        position: positionOf(active.id),
      }),
  };
  const screenReaderInstructions: ScreenReaderInstructions = { draggable: t('instructions') };

  return { announcements, screenReaderInstructions };
}
