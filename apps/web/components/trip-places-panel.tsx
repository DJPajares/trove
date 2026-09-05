'use client';

import {
  CalendarPlus,
  CheckCircle2,
  Ellipsis,
  Eye,
  MapPin,
  MapPinned,
  MapPinOff,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { LocatePlaceDialog } from '@/components/locate-place-dialog';
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
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import { useVisibleKeys } from '@/hooks/use-visible-keys';
import type { ScheduledPlaceUse } from '@/lib/itinerary/places';
import {
  editorialSubjectKey,
  MAX_EDITORIAL_IMAGE_SUBJECTS,
  type EditorialSubject,
} from '@/lib/media/editorial-images';
import { resolvePlaceMediaSource } from '@/lib/media/trip-media';
import type { TripPlace, TripPlacePriority } from '@/lib/trip-places/api';
import {
  resolveProviderPlaceName,
  resolveTripPlaceAddress,
  resolveTripPlaceName,
} from '@/lib/trip-places/place-name';

const priorities = ['none', 'must_go', 'interested', 'maybe'] as const;

type TripPlacesPanelProps = {
  /** Only the itinerary passes this; the Places page has no day in context. */
  addToDayLabel?: string;
  busyPlaceId?: string | null;
  onAddToDay?: (tripPlace: TripPlace) => void;
  onEditPlace: (tripPlace: TripPlace) => void;
  /**
   * Reloads the trip's places and everything downstream of a Place's location
   * once one has been located. Supplied by the host, which owns the query cache.
   */
  onPlaceLocated: () => Promise<void> | void;
  onPriorityChange: (tripPlace: TripPlace, priority: TripPlacePriority | null) => void;
  onRemove: (tripPlace: TripPlace) => void;
  formatUsageDates?: (dates: string[]) => string;
  placeUse?: Record<string, ScheduledPlaceUse>;
  tripPlaces: TripPlace[];
};

/**
 * The trip's Place collection, rendered the same way wherever it appears: on the
 * Places page, and in the drawer the itinerary opens beside the day being planned.
 * One list means a priority set in either place looks and behaves identically.
 *
 * Each row stays three lines. Everything that acts on a Place lives behind the one
 * menu, so a long collection reads as a list of places rather than a stack of
 * controls — which matters most in the drawer, where the list sits beside the day.
 */
export function TripPlacesPanel({
  addToDayLabel,
  busyPlaceId,
  onAddToDay,
  onEditPlace,
  onPlaceLocated,
  onPriorityChange,
  onRemove,
  formatUsageDates,
  placeUse,
  tripPlaces,
}: Readonly<TripPlacesPanelProps>) {
  const t = useTranslations('tripPlaces');
  const mediaTranslations = useTranslations('media');
  // The locate copy belongs to the Place, not to this list, so it says the same
  // thing here as it does in the details sheet this row opens.
  const locateTranslations = useTranslations('placeDetail');
  const [locatePlace, setLocatePlace] = useState<TripPlace | null>(null);

  const placeName = (tripPlace: TripPlace) =>
    resolveTripPlaceName(tripPlace, {
      custom: t('customPlace'),
      provider: t('providerPlace'),
    });

  const placeDescription = (tripPlace: TripPlace) =>
    resolveTripPlaceAddress(tripPlace, {
      custom: t('customPlaceDescription'),
      provider: t('providerDetailsUnavailable'),
    });

  /** Only a Custom Place with nowhere to be can be given somewhere to be. */
  const canLocate = (tripPlace: TripPlace) =>
    tripPlace.place.kind === 'custom' && !tripPlace.place.location;

  /** Only worth its own line once the traveller's name has taken the title. */
  const officialName = (tripPlace: TripPlace) =>
    tripPlace.customName?.trim() ? resolveProviderPlaceName(tripPlace) : null;

  /** A quiet reminder of planned and unscheduled usage; repeat visits stay available. */
  const usageLabels = (tripPlace: TripPlace) => {
    const use = placeUse?.[tripPlace.id];
    if (!use) return [];

    return [
      use.dayDates.length && formatUsageDates
        ? t('onDates', { dates: formatUsageDates(use.dayDates) })
        : null,
      use.unscheduledCount ? t('inUnscheduled') : null,
    ].filter((label): label is string => Boolean(label));
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

  return (
    <>
      <ItemGroup aria-label={t('listLabel')} className="gap-2" variant="list">
        {tripPlaces.map((tripPlace) => {
          const name = placeName(tripPlace);
          const providerName = resolveProviderPlaceName(tripPlace);
          const category = tripPlace.place.snapshot?.category;
          const editorial = editorialFor(tripPlace);
          const official = officialName(tripPlace);
          const usage = usageLabels(tripPlace);
          const hasScheduledDay = Boolean(placeUse?.[tripPlace.id]?.dayDates.length);

          return (
            <Item
              className="relative gap-3 px-3 py-2.5 hover:bg-surface-hover"
              key={tripPlace.id}
              ref={observeRow(tripPlace.id)}
              variant="outline"
            >
              {tripPlace.place.kind === 'custom' ? (
                <ItemMedia
                  className="size-10 rounded-[var(--radius-md)] bg-secondary text-secondary-foreground"
                  variant="icon"
                >
                  <MapPinned aria-hidden="true" className="size-4" />
                </ItemMedia>
              ) : (
                <ItemMedia className="size-10 rounded-[var(--radius-md)]" variant="default">
                  <PlaceMedia
                    alt={
                      editorial && providerName
                        ? mediaTranslations('alt.placeEditorial', { name: providerName })
                        : ''
                    }
                    category={category}
                    className="size-full"
                    sizes="40px"
                    source={resolvePlaceMediaSource({ editorial })}
                    variant="thumbnail"
                  />
                </ItemMedia>
              )}

              <ItemContent className="min-w-0 gap-0.5">
                <ItemTitle className="flex min-w-0 items-center gap-2">
                  {/* The row opens the place, but the row cannot be a button:
                      it already contains one. The name is the button, and it
                      stretches its own hit area over the whole row - so a tap
                      anywhere opens the details, while the menu stays above it
                      and a keyboard reaches exactly two stops per row. */}
                  <button
                    aria-label={t('viewDetails', { name })}
                    className="min-w-0 truncate rounded-[var(--radius-sm)] text-left outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-3 focus-visible:after:ring-ring/40"
                    onClick={() => setDetailsPlace(tripPlace)}
                    type="button"
                  >
                    {name}
                  </button>
                  {hasScheduledDay ? (
                    <CheckCircle2
                      aria-hidden="true"
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                  ) : null}
                  {/* Saved Places and Trip Places are independent relationships to the
                    same Place, so whether this one is also saved is worth showing. */}
                  {tripPlace.isSaved ? <Badge>{t('alsoSaved')}</Badge> : null}
                </ItemTitle>
                {/* A renamed Place still says which one it actually is. */}
                {official ? (
                  <p className="line-clamp-1 text-sm font-medium text-foreground">{official}</p>
                ) : null}
                <ItemDescription className="line-clamp-1">
                  {placeDescription(tripPlace)}
                </ItemDescription>
                {/* A locationless place is still fully usable everywhere else — it
                  just cannot be mapped or routed until it has one (PRD 12). */}
                {!tripPlace.place.location ? (
                  <p className="inline-flex items-center gap-1.5 text-xs text-text-subtle">
                    <MapPinOff aria-hidden="true" className="size-3.5 shrink-0" />
                    {t('noLocation')}
                  </p>
                ) : null}
                {usage.map((label) => (
                  <p className="text-xs text-muted-foreground" key={label}>
                    {label}
                  </p>
                ))}
              </ItemContent>

              {/* Above the name's stretched hit area, or the menu would be
                  unreachable. */}
              <ItemActions className="relative z-10 shrink-0">
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
                  <DropdownMenuContent align="end" className="min-w-48">
                    {/* Only the itinerary has a day in context to add to. */}
                    {onAddToDay && addToDayLabel ? (
                      <DropdownMenuItem
                        disabled={busyPlaceId === tripPlace.id}
                        onClick={() => onAddToDay(tripPlace)}
                      >
                        <CalendarPlus aria-hidden="true" />
                        {addToDayLabel}
                      </DropdownMenuItem>
                    ) : null}

                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
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
                    <DropdownMenuItem onClick={() => onRemove(tripPlace)} variant="destructive">
                      <Trash2 aria-hidden="true" />
                      {t('removeAction')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ItemActions>
            </Item>
          );
        })}
      </ItemGroup>

      {detailsPlace ? (
        <PlaceDetailsSheet
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
        />
      ) : null}

      <LocatePlaceDialog
        onLocated={onPlaceLocated}
        onOpenChange={(open) => !open && setLocatePlace(null)}
        place={locatePlace ? { id: locatePlace.place.id, name: placeName(locatePlace) } : null}
      />
    </>
  );
}
