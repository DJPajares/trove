'use client';

import type { Announcements, ScreenReaderInstructions } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, type ComponentProps, type CSSProperties } from 'react';

import { resolvePlaceCategoryFallback } from '@/lib/media/place-category-fallback';
import type { TrovePlaceCategory } from '@/lib/place-categories';
import { cn } from '@/lib/utils';

import { StopCard } from './stop-card';

/** How long a finger holds a stop's grip before the stop lifts. */
export const STOP_HOLD_MS = 300;

/**
 * A stop that can be dragged to another place in its day, by its grip only.
 *
 * The grip is the one drag source, and a finger has to hold it still for
 * {@link STOP_HOLD_MS} first, so a swipe that happens to start on it scrolls the
 * day; a ring fills around the grip while it is held. It is a real button: Space picks the stop up, the arrow keys
 * move it, Space puts it down and Escape puts it back (PRD 4.6). What stays in
 * the list while it moves is a faint outline of where it came from.
 */
export function SortableStopCard({
  dragDisabled,
  dragLabel,
  holding = false,
  observeRef,
  ...card
}: ComponentProps<typeof StopCard> & {
  dragDisabled: boolean;
  dragLabel: string;
  /** A finger is holding the grip and the stop is about to lift. */
  holding?: boolean;
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
            // `touch-manipulation`, not `touch-none`: the page must still scroll
            // through the grip until a hold has lifted the stop. No callout or
            // text selection, which a long press would otherwise bring up.
            className="group/grip relative grid size-9 cursor-grab touch-manipulation place-items-center rounded-[var(--radius-md)] text-muted-foreground outline-none select-none [-webkit-touch-callout:none] after:absolute after:-inset-1 hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing data-holding:bg-primary/10 data-holding:text-primary"
            data-holding={holding ? '' : undefined}
            data-slot="stop-drag-handle"
            style={{ '--hold-duration': `${STOP_HOLD_MS}ms` } as CSSProperties}
            type="button"
          >
            {/* Fills over exactly the hold, then the stop lifts. Snaps back
                empty at once when the finger lets go or moves away. */}
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 size-full -rotate-90 motion-reduce:hidden"
              viewBox="0 0 36 36"
            >
              <circle
                className="fill-none stroke-primary stroke-2 opacity-0 transition-none [stroke-dasharray:100] [stroke-dashoffset:100] [stroke-linecap:round] group-data-holding/grip:opacity-100 group-data-holding/grip:transition-[stroke-dashoffset] group-data-holding/grip:duration-(--hold-duration) group-data-holding/grip:ease-linear group-data-holding/grip:[stroke-dashoffset:0]"
                cx="18"
                cy="18"
                pathLength="100"
                r="16"
              />
            </svg>
            <GripVertical
              aria-hidden="true"
              className="size-4 transition-transform duration-[var(--motion-standard)] group-data-holding/grip:scale-90"
            />
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
    // Lifts off the page as it appears: a touch larger and tilted, easing in
    // from where the row sat. Still under reduced motion.
    <div
      className={cn(
        'ml-[3.25rem] flex scale-[1.03] -rotate-1 items-center gap-3 rounded-[var(--radius-xl)] border border-primary/40 bg-card p-3 shadow-[var(--shadow-elevated)] transition-[scale,rotate,box-shadow] duration-[var(--motion-standard)] ease-[var(--ease-standard)] starting:scale-100 starting:rotate-0 starting:shadow-none motion-reduce:scale-100 motion-reduce:rotate-0 motion-reduce:transition-none',
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
