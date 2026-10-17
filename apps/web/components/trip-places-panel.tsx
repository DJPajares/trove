'use client';

import type { TrovePlaceCategory } from '@/lib/place-categories';
import { placeCategories } from '@/lib/trip-places/categories';
import {
  CalendarPlus,
  Check,
  Ellipsis,
  Eye,
  LoaderCircle,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  Tags,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import { LocatePlaceSheet } from '@/components/locate-place-sheet';
import { PlaceDetailsSheet, type PlaceDetailsRow } from '@/components/place-details-sheet';
import { PlaceMedia } from '@/components/place-media';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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
  /** The day being planned. Only the active planner day supplies one. */
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
  /** Sets the categories the traveller added; the menu offers it when given. */
  onCategoriesChange?: (tripPlace: TripPlace, categories: TrovePlaceCategory[]) => void;
  onRemove: (tripPlace: TripPlace) => void;
  placeUse?: Readonly<Record<string, ScheduledPlaceUse>>;
  /** The rows' inline inset, so they line up with the edge of whatever holds the list. */
  rowClassName?: string;
  returnFocusToPlace?: (id: string | null) => HTMLElement | boolean;
  /** What Trove already knows that bears on a row: open that day, how far, how rated. */
  signalsFor?: (tripPlace: TripPlace) => TripPlaceRowSignals;
  tripId: string;
  tripPlaces: readonly TripPlace[];
};

/**
 * The trip's Place collection, rendered the same way wherever it appears: in the
 * hub, planner and Trip Mode drawers. One list means every entry point behaves
 * identically, with day-specific actions only beside the day being planned.
 *
 * A row is two lines: the place, and the one thing worth knowing about it for
 * the day beside it, led by the other days it already sits on. Rating, saved
 * state and the full address wait in the place's details, so a long collection
 * scans as places rather than as metadata. Beside a day, the one action worth a
 * tap of its own - adding the place to that day - sits on the row; the rest
 * stay behind the menu.
 */
/** The kinds of place a traveller can say a place is; `other` is only their absence. */
const EDITABLE_CATEGORIES = [
  'stay',
  'food_and_drink',
  'things_to_do',
  'shopping',
  'transport',
  'destination',
] as const satisfies readonly TrovePlaceCategory[];

export function TripPlacesPanel({
  busyPlaceIds,
  day,
  justAddedIds,
  onAddToDay,
  onCategoriesChange,
  onEditPlace,
  onPlaceLocated,
  onPriorityChange,
  onRemove,
  placeUse,
  rowClassName,
  returnFocusToPlace,
  signalsFor,
  tripId,
  tripPlaces,
}: Readonly<TripPlacesPanelProps>) {
  const t = useTranslations('tripPlaces');
  const categoryT = useTranslations('saved.categories');
  const nestedPlaceId = useRef<string | null>(null);
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
   * The one line a row says about a place, chosen by what matters most for the
   * day beside it: closed that day, then no location to plan around, then its
   * hours and distance. Away from a day there is nothing to fit, so the line
   * says where the place is. Nothing here is fetched; an unknown is left out.
   */
  const contextOf = (
    tripPlace: TripPlace,
    facts: TripPlaceRowSignals,
  ): { parts: { text: string; warning?: boolean }[]; tone?: 'warning' } => {
    if (facts.hours?.closed) return { parts: [{ text: facts.hours.label }], tone: 'warning' };
    if (!tripPlace.place.location) {
      return {
        parts: [
          ...(tripPlace.place.kind === 'custom' ? [{ text: t('personalPlace') }] : []),
          { text: t('notOnMap') },
        ],
      };
    }
    const fit = [
      ...(facts.hours ? [{ text: facts.hours.label }] : []),
      ...(facts.distance ? [{ text: facts.distance.text, warning: facts.distance.far }] : []),
    ];
    return { parts: fit.length ? fit : [{ text: whereOf(tripPlace) }] };
  };

  /** Everything a row can do besides adding to the day, behind one button. */
  const menu = (tripPlace: TripPlace, name: string, onThisDay: boolean, busy: boolean) => (
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
        {/* The row's own button adds a place once; a second visit on the same
            day is rarer, so it waits here. */}
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
                onPriorityChange(tripPlace, value === 'none' ? null : (value as TripPlacePriority))
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

        {/* What kind of place this is. What its provider already says stays
            checked; the traveller adds to it - "we're staying here" - and can
            take back only what they added. */}
        {onCategoriesChange ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Tags aria-hidden="true" />
              {t('categoryMenuLabel')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {EDITABLE_CATEGORIES.map((category) => {
                const manual = tripPlace.manualCategories ?? [];
                const derived =
                  placeCategories(tripPlace).includes(category) && !manual.includes(category);
                return (
                  <DropdownMenuCheckboxItem
                    checked={derived || manual.includes(category)}
                    disabled={derived}
                    key={category}
                    onCheckedChange={(checked) =>
                      onCategoriesChange(
                        tripPlace,
                        checked
                          ? [...manual, category]
                          : manual.filter((entry) => entry !== category),
                      )
                    }
                  >
                    {categoryT(category)}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => {
            nestedPlaceId.current = tripPlace.id;
            setDetailsPlace(tripPlace);
          }}
        >
          <Eye aria-hidden="true" />
          {t('viewDetailsAction')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onEditPlace(tripPlace)}>
          <Pencil aria-hidden="true" />
          {t('editPlaceAction')}
        </DropdownMenuItem>
        {/* A place the planner could not resolve is repairable rather than
            permanently unmappable, but only a Custom Place has coordinates of
            its own to be given. */}
        {canLocate(tripPlace) ? (
          <DropdownMenuItem
            onClick={() => {
              nestedPlaceId.current = tripPlace.id;
              setLocatePlace(tripPlace);
            }}
          >
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
  );

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
          const context = contextOf(tripPlace, facts);
          const use = placeUse?.[tripPlace.id];
          // The day being planned has its own state on the button, so the chip
          // names only the other days this place already sits on.
          const otherDays = (use?.dayNumbers ?? []).filter(
            (_, index) => !day || use?.dayDates[index] !== day.date,
          );

          return (
            <Item
              className={cn(
                'relative flex-nowrap items-center gap-3 py-3 hover:bg-surface-hover',
                rowClassName,
              )}
              data-trip-place-id={tripPlace.id}
              key={tripPlace.id}
              ref={observeRow(tripPlace.id)}
              role="listitem"
            >
              {tripPlace.place.kind === 'custom' ? (
                <ItemMedia
                  className={cn(
                    'size-14 rounded-[var(--radius-lg)] bg-secondary text-secondary-foreground',
                    !located && 'border border-dashed border-border-strong bg-muted',
                  )}
                  variant="icon"
                >
                  <Icons.CustomPlace aria-hidden="true" className="size-5" />
                </ItemMedia>
              ) : (
                <ItemMedia
                  className={cn(
                    'size-14 overflow-hidden rounded-[var(--radius-lg)]',
                    facts.hours?.closed && 'opacity-60',
                  )}
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
                    sizes="56px"
                    source={resolvePlaceMediaSource({ editorial })}
                    variant="thumbnail"
                  />
                </ItemMedia>
              )}

              <ItemContent className="min-w-0 gap-0.5">
                <ItemTitle className="line-clamp-none w-full text-base">
                  {/* The row opens the place, but the row cannot be a button:
                      it already contains some. The name is the button, and it
                      stretches its own hit area over the whole row - so a tap
                      anywhere opens the details, while the actions stay above
                      it and a keyboard reaches each of them in turn. */}
                  <button
                    aria-label={t('viewDetails', { name })}
                    className="flex w-full min-w-0 items-center gap-1.5 rounded-[var(--radius-sm)] text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/40 focus-visible:after:ring-inset"
                    onClick={() => {
                      nestedPlaceId.current = tripPlace.id;
                      setDetailsPlace(tripPlace);
                    }}
                    type="button"
                  >
                    <span className="line-clamp-2 break-words">{name}</span>
                    {/* Only Must Go earns a mark: it is the priority the plan is
                        checked against. Every priority stays in the menu. */}
                    {tripPlace.priority === 'must_go' ? (
                      <Icons.MustGo
                        aria-label={t('priority.must_go')}
                        className="size-3.5 shrink-0 text-accent-strong"
                        role="img"
                      />
                    ) : null}
                  </button>
                </ItemTitle>
                {/* One line of context, the one that matters most for the day
                    beside it: closed that day, then no location, then hours and
                    distance. Rating and saved state wait in the place's details. */}
                <p className="flex min-w-0 items-center gap-1.5 text-sm leading-5 text-muted-foreground">
                  {otherDays.length ? (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-px text-xs font-semibold text-foreground">
                      {t('onDays', {
                        count: otherDays.length,
                        days: formatDayNumbers(otherDays, locale),
                      })}
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      'truncate',
                      context.tone === 'warning' && 'font-medium text-status-warning',
                    )}
                  >
                    {context.parts.map((part, index) => (
                      <span
                        className={cn(part.warning && 'font-medium text-status-warning')}
                        key={part.text}
                      >
                        {index ? <span aria-hidden="true"> · </span> : null}
                        {part.text}
                      </span>
                    ))}
                  </span>
                </p>
              </ItemContent>

              {/* Above the name's stretched hit area, or these would be unreachable. */}
              <ItemActions className="relative z-10 -mr-2 shrink-0 gap-0.5">
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
                    className={cn(
                      'rounded-full',
                      onThisDay
                        ? 'text-brand hover:bg-transparent hover:text-brand'
                        : facts.hours?.closed && 'bg-transparent text-muted-foreground',
                    )}
                    disabled={onThisDay || busy}
                    focusableWhenDisabled
                    onClick={() => onAddToDay(tripPlace)}
                    size="icon"
                    type="button"
                    variant={onThisDay ? 'ghost' : facts.hours?.closed ? 'outline' : 'secondary'}
                  >
                    {onThisDay ? (
                      <Check
                        aria-hidden="true"
                        className={cn(
                          'size-5',
                          justAddedIds?.has(tripPlace.id) &&
                            'animate-in duration-[var(--motion-standard)] fade-in-0 zoom-in-50 motion-reduce:animate-none',
                        )}
                      />
                    ) : busy ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="size-5 animate-spin motion-reduce:animate-none"
                      />
                    ) : (
                      <Plus aria-hidden="true" className="size-5" />
                    )}
                  </Button>
                ) : null}
                {menu(tripPlace, name, onThisDay, busy)}
              </ItemActions>
            </Item>
          );
        })}
      </ItemGroup>

      {detailsPlace ? (
        <PlaceDetailsSheet
          key={detailsPlace.place.id}
          editorialImages={editorialImagesFor(detailsPlace)}
          finalFocus={
            returnFocusToPlace ? () => returnFocusToPlace(nestedPlaceId.current) : undefined
          }
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
        finalFocus={
          returnFocusToPlace ? () => returnFocusToPlace(nestedPlaceId.current) : undefined
        }
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
