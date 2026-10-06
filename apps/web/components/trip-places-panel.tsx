'use client';

import {
  CalendarCheck,
  CalendarPlus,
  Ellipsis,
  Eye,
  LoaderCircle,
  MapPin,
  Pencil,
  Star,
  Trash2,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';

import { LocatePlaceSheet } from '@/components/locate-place-sheet';
import { PlaceDetailsSheet, type PlaceDetailsRow } from '@/components/place-details-sheet';
import { PlaceMedia } from '@/components/place-media';
import { Badge } from '@/components/ui/badge';
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
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import { useVisibleKeys } from '@/hooks/use-visible-keys';
import { placeVisitDate, type ScheduledPlaceUse } from '@/lib/itinerary/places';
import {
  editorialSubjectKey,
  MAX_EDITORIAL_IMAGE_SUBJECTS,
  type EditorialSubject,
} from '@/lib/media/editorial-images';
import { resolvePlaceMediaSource } from '@/lib/media/trip-media';
import type { TripPlace, TripPlacePriority } from '@/lib/trip-places/api';
import { formatDayNumbers } from '@/lib/trip-places/list-view';
import { resolveProviderPlaceName, resolveTripPlaceName } from '@/lib/trip-places/place-name';
import type { TripPlaceRowSignals } from '@/lib/trip-places/signals';
import * as Icons from '@/lib/icons';
import { cn } from '@/lib/utils';

const priorities = ['none', 'must_go', 'interested', 'maybe'] as const;

type TripPlacesPanelProps = {
  /** Places whose addition to the day is still on its way to the server. */
  busyPlaceIds?: ReadonlySet<string>;
  /** The day being planned. Only the itinerary's drawer has one, so only it adds to a day. */
  day?: { date: string; number: number };
  /** Places just added to the day here, whose check arrives with a little motion. */
  justAddedIds?: ReadonlySet<string>;
  onAddToDay?: (tripPlace: TripPlace) => void;
  onEditPlace: (tripPlace: TripPlace) => void;
  /**
   * Reloads the trip's places and everything downstream of a Place's location
   * once one has been located. Supplied by the host, which owns the query cache.
   */
  onPlaceLocated: () => Promise<void> | void;
  onPriorityChange: (tripPlace: TripPlace, priority: TripPlacePriority | null) => void;
  onRemove: (tripPlace: TripPlace) => void;
  placeUse?: Readonly<Record<string, ScheduledPlaceUse>>;
  /** The rows' inline inset, so they line up with the edge of whatever holds the list. */
  rowClassName?: string;
  /** What Trove already knows that bears on a row: open that day, how far, how rated. */
  signalsFor?: (tripPlace: TripPlace) => TripPlaceRowSignals;
  tripId: string;
  tripPlaces: readonly TripPlace[];
};

/**
 * The trip's Place collection, rendered the same way wherever it appears: on the
 * Places page, and in the drawer the itinerary opens beside the day being planned.
 * One list means a priority set in either place looks and behaves identically.
 *
 * A row reads in the order a planner asks: what the place is, where it is, how
 * it fits the day, and where it already sits in the plan. Each line appears only
 * when it has something to say, so a personal place with no address is two
 * quiet lines rather than a stack of placeholders. Beside a day, the one action
 * worth a tap of its own - adding the place to that day - sits on the row; the
 * rest stay behind the menu.
 */
export function TripPlacesPanel({
  busyPlaceIds,
  day,
  justAddedIds,
  onAddToDay,
  onEditPlace,
  onPlaceLocated,
  onPriorityChange,
  onRemove,
  placeUse,
  rowClassName,
  signalsFor,
  tripId,
  tripPlaces,
}: Readonly<TripPlacesPanelProps>) {
  const t = useTranslations('tripPlaces');
  const signalsT = useTranslations('placeSignals');
  const mediaTranslations = useTranslations('media');
  // The locate copy belongs to the Place, not to this list, so it says the same
  // thing here as it does in the details sheet this row opens.
  const locateTranslations = useTranslations('placeDetail');
  const locale = useLocale();
  const [locatePlace, setLocatePlace] = useState<TripPlace | null>(null);

  const placeName = (tripPlace: TripPlace) =>
    resolveTripPlaceName(tripPlace, {
      custom: t('customPlace'),
      provider: t('providerPlace'),
    });

  /** A Custom Place can be found on Google, even one already given coordinates by hand. */
  const canLocate = (tripPlace: TripPlace) => tripPlace.place.kind === 'custom';

  /** Only worth showing once the traveller's name has taken the title. */
  const officialName = (tripPlace: TripPlace) =>
    tripPlace.customName?.trim() ? resolveProviderPlaceName(tripPlace) : null;

  /**
   * Where the place is. A personal place has no address to give, so it says what
   * it is instead - plainly, and once - followed by the traveller's own note.
   * A renamed Google place still says which place it actually is, unless its
   * official name is only the start of its address and would be said twice.
   */
  const whereOf = (tripPlace: TripPlace) => {
    if (tripPlace.place.kind === 'custom') {
      return [t('personalPlace'), tripPlace.place.note?.trim()].filter(Boolean).join(' · ');
    }
    const address = tripPlace.place.snapshot?.address ?? tripPlace.place.providerAddress;
    const official = officialName(tripPlace);
    if (!address) return official ?? t('providerDetailsUnavailable');
    return official && !address.toLocaleLowerCase().startsWith(official.toLocaleLowerCase())
      ? `${official} · ${address}`
      : address;
  };

  /**
   * A place asks for a photograph under the provider's name for it, never the
   * traveller's nickname: "Mum's favourite bakery" is a photograph of nothing.
   * Custom places do not ask at all, for the same reason.
   *
   * Only rows that have actually scrolled near the viewport ask for a photo,
   * so a long list resolves progressively as the traveller scrolls rather
   * than losing images past a fixed position. The cap stays as a backstop —
   * it should rarely bind now that requests track the visible rows.
   */
  const { observe: observeRow, visibleKeys: visibleTripPlaceIds } = useVisibleKeys();
  const editorialSubjects: EditorialSubject[] = tripPlaces
    .filter(
      (tripPlace) => tripPlace.place.kind === 'provider' && visibleTripPlaceIds.has(tripPlace.id),
    )
    .flatMap((tripPlace) => {
      const providerName = resolveProviderPlaceName(tripPlace);
      if (!providerName) return [];
      return [
        {
          category: tripPlace.place.snapshot?.category,
          name: providerName,
          placeId: tripPlace.place.id,
        },
      ];
    })
    .slice(0, MAX_EDITORIAL_IMAGE_SUBJECTS);
  const editorialImages = useEditorialImages(editorialSubjects);
  const [detailsPlace, setDetailsPlace] = useState<TripPlace | null>(null);

  /** The ordered collection resolved for a place by the one batch above. */
  const editorialImagesFor = (tripPlace: TripPlace) => {
    const providerName = resolveProviderPlaceName(tripPlace);
    if (!providerName) return [];
    return (
      editorialImages.get(
        editorialSubjectKey({
          category: tripPlace.place.snapshot?.category,
          name: providerName,
          placeId: tripPlace.place.id,
        }),
      ) ?? []
    );
  };
  const editorialFor = (tripPlace: TripPlace) => editorialImagesFor(tripPlace)[0] ?? null;

  /** What the details sheet cannot know: this place's standing on this trip. */
  const detailsMeta = (tripPlace: TripPlace): PlaceDetailsRow[] =>
    [
      tripPlace.priority
        ? { label: t('priorityLabel'), value: t(`priority.${tripPlace.priority}`) }
        : null,
      tripPlace.note ? { label: t('note'), value: tripPlace.note } : null,
    ].filter((row): row is PlaceDetailsRow => row !== null);

  /**
   * How the place fits the day: how far it is, and how it is rated. Hours have a
   * line of their own above this, because they carry their own date.
   */
  const fitFacts = (facts: TripPlaceRowSignals) => {
    const parts: ReactNode[] = [];
    if (facts.distance) {
      parts.push(
        <span
          className={cn(
            'whitespace-nowrap',
            facts.distance.far && 'font-medium text-status-warning',
          )}
          key="distance"
        >
          {facts.distance.text}
        </span>,
      );
    }
    if (facts.rating) {
      const { count, label, value } = facts.rating;
      const strong = (chunks: ReactNode) => (
        <span className="font-medium text-foreground">{chunks}</span>
      );
      parts.push(
        <span
          aria-label={label}
          className="inline-flex items-center gap-1 whitespace-nowrap"
          key="rating"
          role="img"
        >
          <Star aria-hidden="true" className="size-3 fill-current text-rating" />
          <span>
            {count
              ? signalsT.rich('ratingCompact', { count, rating: value, value: strong })
              : signalsT.rich('ratingCompactNoCount', { rating: value, value: strong })}
          </span>
        </span>,
      );
    }
    return parts.flatMap((part, index) =>
      index
        ? [
            <span aria-hidden="true" className="text-text-subtle" key={`separator-${index}`}>
              ·
            </span>,
            part,
          ]
        : [part],
    );
  };

  /** Where the place already sits in the plan, and what the traveller has said about it. */
  const relationships = (tripPlace: TripPlace) => {
    const use = placeUse?.[tripPlace.id];
    const dayNumbers = use?.dayNumbers ?? [];
    const badges: ReactNode[] = [];
    if (dayNumbers.length) {
      badges.push(
        <Badge key="days" size="sm" variant="muted">
          <Icons.Itinerary aria-hidden="true" />
          {t('onDays', {
            count: dayNumbers.length,
            days: formatDayNumbers(dayNumbers, locale),
          })}
        </Badge>,
      );
    }
    // Only Must Go earns a badge: it is the priority the plan is checked against.
    // Interested is what a planner gives nearly everything, so a row that said
    // so would say nothing; the menu and the details still show any priority.
    if (tripPlace.priority === 'must_go') {
      badges.push(
        <Badge className="text-foreground" key="priority" size="sm" variant="muted">
          <Icons.MustGo aria-hidden="true" className="text-accent-strong" />
          {t('priority.must_go')}
        </Badge>,
      );
    }
    // Saved Places and Trip Places are independent relationships to the same
    // Place, so whether this one is also saved is worth a quiet mention.
    if (tripPlace.isSaved) {
      badges.push(
        <Badge key="saved" size="sm" variant="muted">
          <Icons.Saved aria-hidden="true" />
          {t('alsoSaved')}
        </Badge>,
      );
    }
    return badges;
  };

  return (
    <>
      <ItemGroup aria-label={t('listLabel')} variant="list">
        {tripPlaces.map((tripPlace) => {
          const name = placeName(tripPlace);
          const providerName = resolveProviderPlaceName(tripPlace);
          const editorial = editorialFor(tripPlace);
          const located = Boolean(tripPlace.place.location);
          const onThisDay = Boolean(day && placeUse?.[tripPlace.id]?.dayDates.includes(day.date));
          const busy = busyPlaceIds?.has(tripPlace.id) ?? false;
          const facts = signalsFor?.(tripPlace) ?? {};
          const fit = fitFacts(facts);
          const badges = relationships(tripPlace);

          return (
            <Item
              className={cn(
                'relative flex-nowrap items-start gap-3 py-3 hover:bg-surface-hover',
                rowClassName,
              )}
              key={tripPlace.id}
              ref={observeRow(tripPlace.id)}
              role="listitem"
            >
              {tripPlace.place.kind === 'custom' ? (
                <ItemMedia
                  className="size-12 rounded-[var(--radius-md)] bg-secondary text-secondary-foreground"
                  variant="icon"
                >
                  <Icons.CustomPlace aria-hidden="true" className="size-5" />
                </ItemMedia>
              ) : (
                <ItemMedia
                  className="size-12 overflow-hidden rounded-[var(--radius-md)]"
                  variant="default"
                >
                  <PlaceMedia
                    alt={
                      editorial && providerName
                        ? mediaTranslations('alt.placeEditorial', { name: providerName })
                        : ''
                    }
                    category={tripPlace.place.snapshot?.category}
                    className="size-full"
                    sizes="48px"
                    source={resolvePlaceMediaSource({ editorial })}
                    variant="thumbnail"
                  />
                </ItemMedia>
              )}

              <ItemContent className="min-w-0 gap-1">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <ItemTitle className="line-clamp-none w-full text-base">
                      {/* The row opens the place, but the row cannot be a button:
                          it already contains some. The name is the button, and it
                          stretches its own hit area over the whole row - so a tap
                          anywhere opens the details, while the actions stay above
                          it and a keyboard reaches each of them in turn. */}
                      <button
                        aria-label={t('viewDetails', { name })}
                        className="block w-full rounded-[var(--radius-sm)] text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/40 focus-visible:after:ring-inset"
                        onClick={() => setDetailsPlace(tripPlace)}
                        type="button"
                      >
                        <span className="line-clamp-2 break-words">{name}</span>
                      </button>
                    </ItemTitle>
                    {/* A place without coordinates is still a whole place - it just
                        is not on the map until it has some (PRD 12), which is a
                        fact about it rather than a fault. */}
                    <p className="mt-0.5 flex min-w-0 text-sm leading-5 text-muted-foreground">
                      <span className="truncate">{whereOf(tripPlace)}</span>
                      {located ? null : (
                        <span className="shrink-0 whitespace-pre">
                          <span aria-hidden="true"> · </span>
                          {t('notOnMap')}
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Above the name's stretched hit area, or these would be
                      unreachable. */}
                  <ItemActions className="relative z-10 -my-1.5 -mr-2 shrink-0 gap-0.5">
                    {day && onAddToDay ? (
                      // One button in both states, so focus stays put when adding
                      // turns it into the check: a keyboard user is not dropped
                      // back to the top of the page for having added something.
                      // Adding it a second time is still possible, from the menu.
                      <Button
                        aria-busy={busy || undefined}
                        aria-label={
                          onThisDay
                            ? t('onThisDay', { number: day.number })
                            : t('addPlaceToDay', { name, number: day.number })
                        }
                        className={
                          onThisDay ? 'text-brand hover:bg-transparent hover:text-brand' : undefined
                        }
                        disabled={onThisDay || busy}
                        focusableWhenDisabled
                        onClick={() => onAddToDay(tripPlace)}
                        size="icon-sm"
                        type="button"
                        variant={onThisDay ? 'ghost' : 'outline'}
                      >
                        {onThisDay ? (
                          <CalendarCheck
                            aria-hidden="true"
                            className={cn(
                              justAddedIds?.has(tripPlace.id) &&
                                'animate-in duration-[var(--motion-standard)] fade-in-0 zoom-in-50 motion-reduce:animate-none',
                            )}
                          />
                        ) : busy ? (
                          <LoaderCircle
                            aria-hidden="true"
                            className="animate-spin motion-reduce:animate-none"
                          />
                        ) : (
                          <CalendarPlus aria-hidden="true" />
                        )}
                      </Button>
                    ) : null}

                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            aria-label={t('actionsFor', { name })}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          />
                        }
                      >
                        <Ellipsis aria-hidden="true" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-52">
                        {/* The row's own button adds a place once; a second visit
                            on the same day is rarer, so it waits here. */}
                        {day && onAddToDay && onThisDay ? (
                          <>
                            <DropdownMenuItem disabled={busy} onClick={() => onAddToDay(tripPlace)}>
                              <CalendarPlus aria-hidden="true" />
                              {t('addPlaceAgainToDay', { number: day.number })}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                          </>
                        ) : null}

                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            <Icons.MustGo aria-hidden="true" />
                            {t('priorityMenuLabel')}
                            {/* The current priority stays readable without opening the submenu. */}
                            <span className="ml-2 text-xs text-muted-foreground">
                              {t(`priority.${tripPlace.priority ?? 'none'}`)}
                            </span>
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            <DropdownMenuRadioGroup
                              onValueChange={(value) =>
                                onPriorityChange(
                                  tripPlace,
                                  value === 'none' ? null : (value as TripPlacePriority),
                                )
                              }
                              value={tripPlace.priority ?? 'none'}
                            >
                              {priorities.map((priority) => (
                                <DropdownMenuRadioItem key={priority} value={priority}>
                                  {t(`priority.${priority}`)}
                                </DropdownMenuRadioItem>
                              ))}
                            </DropdownMenuRadioGroup>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>

                        <DropdownMenuSeparator />

                        {/* A Custom Place has details worth showing too, so this is no
                            longer conditional on having a Google listing to link out to. */}
                        <DropdownMenuItem onClick={() => setDetailsPlace(tripPlace)}>
                          <Eye aria-hidden="true" />
                          {t('viewDetailsAction')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onEditPlace(tripPlace)}>
                          <Pencil aria-hidden="true" />
                          {t('editPlaceAction')}
                        </DropdownMenuItem>
                        {/* A place the planner could not resolve is repairable rather
                            than permanently unmappable, but only a Custom Place has
                            coordinates of its own to be given. */}
                        {canLocate(tripPlace) ? (
                          <DropdownMenuItem onClick={() => setLocatePlace(tripPlace)}>
                            <MapPin aria-hidden="true" />
                            {locateTranslations('locate.action')}
                          </DropdownMenuItem>
                        ) : null}

                        <DropdownMenuSeparator />

                        <DropdownMenuItem onClick={() => onRemove(tripPlace)} variant="destructive">
                          <Trash2 aria-hidden="true" />
                          {t('removeAction')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </ItemActions>
                </div>

                {/* The row keeps to the hours themselves; the date they were
                    checked stays a hover away, and in the place's details. */}
                {facts.hours ? (
                  <p
                    className={cn(
                      'text-xs leading-5 whitespace-nowrap',
                      facts.hours.closed
                        ? 'font-medium text-status-warning'
                        : 'text-muted-foreground',
                    )}
                    title={facts.hours.checked}
                  >
                    {facts.hours.label}
                  </p>
                ) : null}

                {fit.length ? (
                  <p className="flex flex-wrap items-center gap-x-1.5 text-xs leading-5 text-muted-foreground">
                    {fit}
                  </p>
                ) : null}

                {badges.length ? (
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">{badges}</div>
                ) : null}
              </ItemContent>
            </Item>
          );
        })}
      </ItemGroup>

      {detailsPlace ? (
        <PlaceDetailsSheet
          key={detailsPlace.place.id}
          editorialImages={editorialImagesFor(detailsPlace)}
          meta={detailsMeta(detailsPlace)}
          name={placeName(detailsPlace)}
          officialName={officialName(detailsPlace)}
          onLocate={
            canLocate(detailsPlace)
              ? () => {
                  // One dialog for both entry points, so the sheet steps aside
                  // rather than stacking a dialog on top of itself.
                  setLocatePlace(detailsPlace);
                  setDetailsPlace(null);
                }
              : undefined
          }
          onOpenChange={(open) => !open && setDetailsPlace(null)}
          place={detailsPlace.place}
          visitDate={placeUse ? placeVisitDate(placeUse[detailsPlace.id], day?.date) : null}
        />
      ) : null}

      <LocatePlaceSheet
        onLocated={onPlaceLocated}
        onOpenChange={(open) => !open && setLocatePlace(null)}
        place={
          locatePlace
            ? {
                name: placeName(locatePlace),
                placeId: locatePlace.place.id,
                tripId,
                tripPlaceId: locatePlace.id,
              }
            : null
        }
      />
    </>
  );
}
