'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, type KeyboardEvent } from 'react';

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
        onKeyDown={moveFocus}
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
