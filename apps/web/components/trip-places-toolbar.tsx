'use client';

import { ArrowDownUp, Plus, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { SearchField } from '@/components/search-field';
import { Button } from '@/components/ui/button';
import { Chip, ChipGroup } from '@/components/ui/chip';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { TripPlaceShow } from '@/lib/trip-places/list-view';
import type { TripPlaceDaySort } from '@/lib/trip-places/signals';
import type { TripPlacesView } from '@/lib/trip-places/use-trip-places-view';
import * as Icons from '@/lib/icons';
import { cn } from '@/lib/utils';

/**
 * Finding a place in the trip's collection: a search, a filter for what is not
 * on a day yet, and the order - in that order of usefulness, so the sort is the
 * quietest of the three. One place is not a collection to search, so the
 * controls wait for a second; until then only the host's `action` shows.
 *
 * In a narrow host (the drawer) the search and the rest stack; on a wide page
 * they share one row.
 */
export function TripPlacesToolbar({
  action,
  className,
  view,
}: Readonly<{ action?: ReactNode; className?: string; view: TripPlacesView }>) {
  const t = useTranslations('tripPlaces');
  const { counts } = view;
  const searchable = counts.all > 1;
  // The filter only earns its place when it would split the list, and stays
  // while it is on so there is always a way back to everything.
  const filterable = view.show !== 'all' || (counts.unplanned > 0 && counts.unplanned < counts.all);

  if (!searchable && !action) return null;

  return (
    <div className={cn('@container', className)}>
      <div className="flex flex-col gap-2 @2xl:flex-row @2xl:items-center @2xl:gap-4">
        <div className="flex items-center justify-end gap-2 @2xl:w-96 @2xl:shrink-0">
          {searchable ? (
            <SearchField
              label={t('findLabel')}
              onChange={(event) => view.setQuery(event.target.value)}
              placeholder={t('findPlaceholder', { count: counts.all })}
              value={view.query}
              wrapperClassName="min-w-0 flex-1"
            />
          ) : null}
          {action}
        </div>

        {searchable ? (
          <div className="flex min-h-9 min-w-0 flex-1 items-center justify-between gap-3">
            {filterable ? (
              <ChipGroup
                aria-label={t('show.label')}
                className="interaction-scrollbar -mx-1 min-w-0 flex-nowrap overflow-x-auto px-1"
                multiple={false}
                onValueChange={([value]) => view.setShow((value ?? 'all') as TripPlaceShow)}
                value={[view.show]}
              >
                <Chip count={counts.all} value="all">
                  {t('show.all')}
                </Chip>
                <Chip count={counts.unplanned} value="unplanned">
                  {t('show.unplanned')}
                </Chip>
              </ChipGroup>
            ) : (
              <p className="text-xs text-muted-foreground tabular-nums">
                {view.filtering
                  ? t('matchCount', { shown: view.visible.length, total: counts.all })
                  : t('placeCount', { count: counts.all })}
              </p>
            )}

            <Select
              onValueChange={(value) => value && view.setSort(value as TripPlaceDaySort)}
              value={view.sort}
            >
              <SelectTrigger
                aria-label={t('sortBy')}
                className="shrink-0 gap-1.5 border-transparent bg-transparent px-2 text-muted-foreground shadow-none hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:bg-transparent dark:hover:bg-muted"
                size="sm"
              >
                <ArrowDownUp aria-hidden="true" className="size-3.5" />
                <SelectValue>{t(`sortShort.${view.sort}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent align="end" alignItemWithTrigger={false}>
                {view.sorts.map((option) => (
                  <SelectItem key={option} value={option}>
                    {t(`sort.${option}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      <p aria-live="polite" className="sr-only" role="status">
        {view.filtering ? t('matchCount', { shown: view.visible.length, total: counts.all }) : null}
      </p>
    </div>
  );
}

/**
 * What an empty result says. A search that found nothing offers to add what was
 * typed; a "not on a day" view with nothing left in it says so, and offers the
 * way back to everything.
 */
export function TripPlacesNoMatches({
  className,
  onAddQuery,
  view,
}: Readonly<{
  className?: string;
  onAddQuery: (query: string) => void;
  view: TripPlacesView;
}>) {
  const t = useTranslations('tripPlaces');
  const query = view.query.trim();
  const showAll =
    view.show === 'all' ? null : (
      <Button onClick={() => view.setShow('all')} type="button" variant="ghost">
        {t('showAll')}
      </Button>
    );

  return (
    <Empty className={cn('gap-3 py-10', className)}>
      <EmptyHeader className="gap-1.5">
        <EmptyMedia variant="icon">
          {query ? <Search aria-hidden="true" /> : <Icons.Itinerary aria-hidden="true" />}
        </EmptyMedia>
        <EmptyTitle className="text-base">
          {query ? t('noMatchesTitle', { query }) : t('allPlannedTitle')}
        </EmptyTitle>
        <EmptyDescription>
          {query ? t('noMatchesDescription') : t('allPlannedDescription')}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row flex-wrap justify-center gap-2">
        {query ? (
          <Button onClick={() => onAddQuery(query)} type="button" variant="outline">
            <Plus aria-hidden="true" data-icon="inline-start" />
            <span className="max-w-48 truncate">{t('addQuery', { query })}</span>
          </Button>
        ) : null}
        {showAll}
      </EmptyContent>
    </Empty>
  );
}
