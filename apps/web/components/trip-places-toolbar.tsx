'use client';

import { Toggle as TogglePrimitive } from '@base-ui/react/toggle';
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group';
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
import type { TrovePlaceCategory } from '@/lib/place-categories';
import type { TripPlaceDaySort } from '@/lib/trip-places/signals';
import type { TripPlacesView } from '@/lib/trip-places/use-trip-places-view';
import * as Icons from '@/lib/icons';
import { cn } from '@/lib/utils';

export type TripPlacesLens = 'all' | 'day' | 'unplanned';

/**
 * Finding a place in the trip's collection: one row for the search, the order
 * and the host's action, then the lens - what the list is for right now. Beside
 * a day that is the day itself; anywhere else it is what still needs a day, or
 * everything. One place is not a collection to search, so the controls wait for
 * a second; until then only the host's `action` shows.
 */
export function TripPlacesToolbar({
  action,
  className,
  dayNumber,
  lens,
  onLensChange,
  view,
}: Readonly<{
  action?: ReactNode;
  className?: string;
  /** The day being planned, when there is one; it adds the day lens. */
  dayNumber?: number;
  lens: TripPlacesLens;
  onLensChange: (lens: TripPlacesLens) => void;
  view: TripPlacesView;
}>) {
  const t = useTranslations('tripPlaces');
  const categoryT = useTranslations('saved.categories');
  const { counts } = view;
  const searchable = counts.all > 1;

  if (!searchable && !action) return null;

  const lenses: { count?: number; label: string; value: TripPlacesLens }[] = [
    ...(dayNumber ? [{ label: t('lens.day', { number: dayNumber }), value: 'day' as const }] : []),
    { count: counts.unplanned, label: t('lens.unplanned'), value: 'unplanned' },
    { count: counts.all, label: t('lens.all'), value: 'all' },
  ];

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center gap-2">
        {searchable ? (
          <SearchField
            label={t('findLabel')}
            onChange={(event) => view.setQuery(event.target.value)}
            placeholder={t('findPlaceholderShort')}
            value={view.query}
            wrapperClassName="min-w-0 flex-1"
          />
        ) : null}
        {searchable ? (
          <Select
            onValueChange={(value) => value && view.setSort(value as TripPlaceDaySort)}
            value={view.sort}
          >
            <SelectTrigger
              aria-label={t('sortBy')}
              className="shrink-0 gap-1.5 px-3 text-muted-foreground"
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
        ) : null}
        {action}
      </div>

      {searchable ? (
        <ToggleGroupPrimitive
          aria-label={t('show.label')}
          className="grid auto-cols-fr grid-flow-col gap-1 rounded-full bg-muted p-1"
          onValueChange={([value]) => value && onLensChange(value as TripPlacesLens)}
          value={[lens]}
        >
          {lenses.map((option) => (
            <TogglePrimitive
              className="h-9 min-w-0 truncate rounded-full px-2 text-[0.8125rem] font-semibold text-muted-foreground outline-none transition-[background-color,color,box-shadow] duration-[var(--motion-standard)] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 data-[pressed]:bg-card data-[pressed]:text-foreground data-[pressed]:shadow-[var(--shadow-control)]"
              key={option.value}
              value={option.value}
            >
              {option.label}
              {option.count !== undefined ? (
                <span className="font-medium tabular-nums">
                  <span aria-hidden="true"> · </span>
                  {option.count}
                </span>
              ) : null}
            </TogglePrimitive>
          ))}
        </ToggleGroupPrimitive>
      ) : null}

      {/* Narrowing by kind of place is offered once the trip holds more than one kind. */}
      {searchable && view.categoriesPresent.length > 1 ? (
        <ChipGroup
          aria-label={t('categoryFilterLabel')}
          className="-mx-5 flex-nowrap overflow-x-auto px-5 pb-0.5"
          multiple={false}
          onValueChange={([value]) => view.setCategory((value as TrovePlaceCategory) ?? 'all')}
          value={[view.category]}
        >
          <Chip value="all">{categoryT('all')}</Chip>
          {view.categoriesPresent.map((category) => (
            <Chip key={category} value={category}>
              {categoryT(category)}
            </Chip>
          ))}
        </ChipGroup>
      ) : null}

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
  onShowAll,
  view,
}: Readonly<{
  className?: string;
  onAddQuery: (query: string) => void;
  /** Offered when the lens, not the search, is what emptied the list. */
  onShowAll?: () => void;
  view: TripPlacesView;
}>) {
  const t = useTranslations('tripPlaces');
  const query = view.query.trim();
  const showAll = onShowAll ? (
    <Button onClick={onShowAll} type="button" variant="ghost">
      {t('showAll')}
    </Button>
  ) : null;

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
