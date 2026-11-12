'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';

import { TripAllDaysCard, TripDayCard, type TripDayCardDay } from '@/components/trip-day-card';

export { paddedDayNumber } from '@/components/trip-day-card';

/**
 * The trip, one tile per day: the way between days on every form factor.
 *
 * Each tile is the trip overview's own day card - its number and date, its
 * town, how much is on it, and a dot when its plan has a verified problem
 * worth a look - so the strip reads the same on both pages, and finding "the
 * day that needs fixing" takes a glance. The first tile is the whole trip.
 * Weather lives on each day's own page, not on its tile.
 *
 * It behaves like a tab list with manual activation: arrow keys move focus
 * along the strip, and Enter or Space opens a day. Opening a day fetches its
 * travel legs, so moving focus must never do that on its own.
 */
export function PlannerRibbon({
  days,
  onSelectDay,
  onSelectOverview,
  overviewActive,
  selectedDayId,
}: Readonly<{
  days: readonly TripDayCardDay[];
  onSelectDay: (dayId: string) => void;
  onSelectOverview: () => void;
  overviewActive: boolean;
  selectedDayId: string | null;
}>) {
  const t = useTranslations('itinerary.planner.ribbon');
  const listRef = useRef<HTMLOListElement>(null);
  const activeKey = overviewActive ? 'overview' : selectedDayId;

  // The open day is kept in view without moving the page: only the strip
  // scrolls, so opening a day never jumps the traveller up or down the screen.
  useEffect(() => {
    const list = listRef.current;
    const tile = list?.querySelector<HTMLElement>('[data-ribbon-active="true"]');
    if (!list || !tile) return;
    const left = tile.offsetLeft - (list.clientWidth - tile.offsetWidth) / 2;
    list.scrollTo({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      left: Math.max(0, left),
    });
  }, [activeKey]);

  // A finger scrolls the strip natively; a mouse does not, so with one the
  // strip is dragged. Snapping is off while it is, or it fights every frame, and
  // a drag that moved never counts as a tap on the tile it ended over.
  const drag = useRef<{ left: number; moved: boolean; x: number } | null>(null);

  function startDrag(event: PointerEvent<HTMLOListElement>) {
    const list = listRef.current;
    if (!list || event.pointerType !== 'mouse' || event.button !== 0) return;
    drag.current = { left: list.scrollLeft, moved: false, x: event.clientX };
  }

  function moveDrag(event: PointerEvent<HTMLOListElement>) {
    const list = listRef.current;
    const state = drag.current;
    if (!list || !state) return;
    const distance = event.clientX - state.x;
    if (!state.moved && Math.abs(distance) < 4) return;
    if (!state.moved) {
      state.moved = true;
      list.setPointerCapture(event.pointerId);
      list.style.scrollSnapType = 'none';
    }
    list.scrollLeft = state.left - distance;
  }

  function endDrag() {
    const list = listRef.current;
    if (list) list.style.scrollSnapType = '';
    // Cleared after the click this release may produce has been swallowed.
    window.setTimeout(() => {
      drag.current = null;
    }, 0);
  }

  function moveFocus(event: KeyboardEvent<HTMLOListElement>) {
    const tiles = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-ribbon-tile]') ?? [])];
    const current = tiles.indexOf(document.activeElement as HTMLElement);
    if (current < 0) return;
    const next =
      event.key === 'ArrowRight'
        ? Math.min(current + 1, tiles.length - 1)
        : event.key === 'ArrowLeft'
          ? Math.max(current - 1, 0)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tiles.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    tiles[next]?.focus();
  }

  return (
    <nav
      aria-label={t('label')}
      className="relative sticky top-[calc(var(--safe-top)+var(--header-offset)+3.25rem)] z-[calc(var(--layer-sticky)-1)] -mx-[var(--gutter-inline-start)] -mt-2 bg-background/95 backdrop-blur before:pointer-events-none before:absolute before:inset-x-0 before:-top-4 before:h-4 before:bg-background before:content-[''] md:top-[calc(var(--safe-top)+var(--header-offset))] md:mx-0 md:mt-0 md:rounded-[var(--radius-xl)] md:before:hidden"
      data-slot="planner-ribbon"
    >
      <ol
        className="interaction-scrollbar relative flex snap-x scroll-px-[var(--gutter-inline-start)] gap-1.5 overflow-x-auto px-[var(--gutter-inline-start)] py-2 md:scroll-px-1 md:px-1"
        onClickCapture={(event) => {
          if (drag.current?.moved) event.stopPropagation();
        }}
        onKeyDown={moveFocus}
        onPointerCancel={endDrag}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        ref={listRef}
      >
        <li className="snap-start">
          <TripAllDaysCard
            count={days.length}
            current={overviewActive}
            onSelect={onSelectOverview}
            tabIndex={activeKey === 'overview' || activeKey === null ? 0 : -1}
          />
        </li>

        {days.map((day) => {
          const active = !overviewActive && day.id === selectedDayId;
          return (
            <li className="snap-start" key={day.id}>
              <TripDayCard
                current={active}
                day={day}
                onSelect={() => onSelectDay(day.id)}
                tabIndex={active ? 0 : -1}
              />
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
