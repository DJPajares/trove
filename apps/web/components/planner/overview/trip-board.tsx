'use client';

import { List, Map as MapIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Tabs, TabsIndicator, TabsList, TabsTab } from '@/components/ui/tabs';
import type { ItineraryDay, ItineraryItem } from '@/lib/itinerary/api';
import type { StayChapter } from '@/lib/itinerary/stay-chapters';
import * as Icons from '@/lib/icons';

import { BoardDayCard } from './board-day-card';

export type TripBoardDisplay = 'list' | 'map';

/**
 * The whole trip on one page, the way it will be lived: chapters of nights
 * spent in one place - "Riverside Villa, Hội An, days 3 to 5" - and in each
 * the days as cards.
 *
 * Everything here comes from what the planner already holds: the itinerary,
 * the trip's one score, its forecast, and coordinates for the sketches. Not
 * one leg is routed to draw it, so a long trip costs what a short one does.
 * The trip's map is a click away and built only then (`mapPanel`).
 */
export function TripBoard({
  chapters,
  days,
  display,
  forecast,
  itemName,
  mapPanel,
  onDisplayChange,
  onEditItem,
  onOpenDay,
  sketchFor,
  stayName,
  timeFormat,
}: Readonly<{
  chapters: readonly StayChapter[];
  days: readonly ItineraryDay[];
  display: TripBoardDisplay;
  /** The whole trip's weather, above its days. */
  forecast?: ReactNode;
  itemName: (item: ItineraryItem) => string;
  /** The whole trip's map, once asked for; kept, hidden, behind the board after. */
  mapPanel: ReactNode;
  onDisplayChange: (display: TripBoardDisplay) => void;
  onEditItem: (item: ItineraryItem) => void;
  onOpenDay: (dayId: string) => void;
  sketchFor: (day: ItineraryDay) => ReactNode | null;
  stayName: (tripPlaceId: string) => string | null;
  timeFormat: '12h' | '24h';
}>) {
  const t = useTranslations('itinerary');
  const boardT = useTranslations('itinerary.planner.board');
  const dayById = new Map(days.map((day) => [day.id, day]));

  return (
    <section aria-labelledby="trip-board-heading" className="space-y-5" data-slot="trip-board">
      <header className="space-y-4">
        <div>
          <h2
            className="text-[length:var(--text-section-title)] leading-tight font-semibold tracking-[-0.015em]"
            id="trip-board-heading"
          >
            {t('overview.title')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('overview.description', { count: days.length })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs
            className="min-w-0 flex-1 sm:flex-none"
            onValueChange={(value) => onDisplayChange(value as TripBoardDisplay)}
            value={display}
          >
            <TabsList aria-label={t('map.viewNavigation')} className="flex h-9 w-full sm:w-auto">
              <TabsTab
                aria-controls="trip-board-days"
                className="h-7 flex-1 gap-2 py-0"
                id="trip-board-days-tab"
                value="list"
              >
                <List aria-hidden="true" data-icon="inline-start" />
                {t('map.listView')}
              </TabsTab>
              <TabsTab
                aria-controls="trip-board-map"
                className="h-7 flex-1 gap-2 py-0"
                id="trip-board-map-tab"
                value="map"
              >
                <MapIcon aria-hidden="true" data-icon="inline-start" />
                {t('map.mapView')}
              </TabsTab>
              <TabsIndicator />
            </TabsList>
          </Tabs>
        </div>
      </header>

      {forecast}

      <div
        aria-labelledby="trip-board-map-tab"
        className={
          display === 'map'
            ? 'overflow-hidden rounded-[var(--radius-xl)] border border-border-subtle'
            : 'hidden'
        }
        id="trip-board-map"
        role="tabpanel"
      >
        {mapPanel}
      </div>

      <div
        aria-labelledby="trip-board-days-tab"
        className={display === 'list' ? 'space-y-7' : 'hidden'}
        id="trip-board-days"
        role="tabpanel"
      >
        {chapters.map((chapter) => {
          const first = chapter.days[0];
          const last = chapter.days.at(-1);
          if (!first || !last) return null;
          const stay = chapter.stayTripPlaceId ? stayName(chapter.stayTripPlaceId) : null;
          const title =
            chapter.kind === 'stay'
              ? [stay, chapter.town].filter(Boolean).join(' · ')
              : chapter.kind === 'town'
                ? chapter.town
                : null;
          const span = boardT('days', {
            count: chapter.days.length,
            first: first.number,
            last: last.number,
          });

          return (
            <section aria-labelledby={`chapter-${chapter.key}`} key={chapter.key}>
              <div className="mb-3 flex items-baseline gap-2 border-b border-border-subtle pb-2">
                {chapter.kind === 'stay' ? (
                  <Icons.DailyBase
                    aria-hidden="true"
                    className="size-4 shrink-0 self-center text-primary"
                  />
                ) : chapter.kind === 'town' ? (
                  <Icons.Place
                    aria-hidden="true"
                    className="size-4 shrink-0 self-center text-primary"
                  />
                ) : null}
                <h3
                  className="min-w-0 truncate text-base font-semibold"
                  id={`chapter-${chapter.key}`}
                >
                  {title ?? span}
                </h3>
                <p className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                  {title ? span : null}
                  {chapter.kind === 'stay' ? (
                    <>
                      {title ? ' · ' : null}
                      {boardT('nights', { count: chapter.days.length })}
                    </>
                  ) : null}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {chapter.days.map((plannerDay) => {
                  const day = dayById.get(plannerDay.id);
                  if (!day) return null;
                  return (
                    <BoardDayCard
                      day={day}
                      itemName={itemName}
                      key={plannerDay.id}
                      onEditItem={onEditItem}
                      onOpen={() => onOpenDay(plannerDay.id)}
                      plannerDay={plannerDay}
                      sketch={sketchFor(day)}
                      timeFormat={timeFormat}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}
