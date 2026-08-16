'use client';

import {
  Bookmark,
  CalendarPlus,
  Ellipsis,
  Eye,
  MapPinned,
  NotebookPen,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ScheduledPlaceUse } from '@/lib/itinerary/places';
import type { TripPlace, TripPlacePriority } from '@/lib/trip-places/api';
import type { TripPlaceDetails } from '@/lib/trip-places/use-trip-places';

type TripPlacesPanelProps = {
  /** Only the itinerary passes this; the Places page has no day in context. */
  addToDayLabel?: string;
  busyPlaceId?: string | null;
  onAddToDay?: (tripPlace: TripPlace) => void;
  onEditNote: (tripPlace: TripPlace) => void;
  onPriorityChange: (tripPlace: TripPlace, priority: TripPlacePriority | null) => void;
  onRemove: (tripPlace: TripPlace) => void;
  onViewDetails: (tripPlace: TripPlace) => void;
  placeUse?: Record<string, ScheduledPlaceUse>;
  providerDetails: TripPlaceDetails;
  tripPlaces: TripPlace[];
};

/**
 * The trip's Place collection, rendered the same way wherever it appears: on the
 * Places page, and in the drawer the itinerary opens beside the day being planned.
 * One list means a priority set in either place looks and behaves identically.
 */
export function TripPlacesPanel({
  addToDayLabel,
  busyPlaceId,
  onAddToDay,
  onEditNote,
  onPriorityChange,
  onRemove,
  onViewDetails,
  placeUse,
  providerDetails,
  tripPlaces,
}: Readonly<TripPlacesPanelProps>) {
  const t = useTranslations('tripPlaces');

  const placeName = (tripPlace: TripPlace) =>
    tripPlace.place.kind === 'custom'
      ? (tripPlace.place.name ?? t('customPlace'))
      : (providerDetails[tripPlace.place.id]?.name ?? t('providerPlace'));

  const placeDescription = (tripPlace: TripPlace) =>
    tripPlace.place.kind === 'custom'
      ? (tripPlace.place.note ?? t('customPlaceDescription'))
      : (providerDetails[tripPlace.place.id]?.formattedAddress ?? t('providerDetailsUnavailable'));

  /** Where this Place already sits in the plan, so nothing gets added twice unnoticed. */
  const usageLabel = (tripPlace: TripPlace) => {
    const use = placeUse?.[tripPlace.id];
    if (!use) return null;
    if (use.dayNumbers.length) {
      return t('onDays', { days: use.dayNumbers.join(', '), count: use.dayNumbers.length });
    }
    return use.unscheduledCount ? t('inUnscheduled') : null;
  };

  return (
    <ItemGroup aria-label={t('listLabel')} className="gap-2" variant="list">
      {tripPlaces.map((tripPlace) => {
        const name = placeName(tripPlace);
        const usage = usageLabel(tripPlace);

        return (
          <Item className="items-start px-3 py-3" key={tripPlace.id} variant="outline">
            <ItemMedia
              className="mt-0.5 size-9 rounded-[var(--radius-md)] bg-secondary text-secondary-foreground"
              variant="icon"
            >
              {tripPlace.place.kind === 'custom' ? (
                <MapPinned aria-hidden="true" className="size-4" />
              ) : (
                <Bookmark aria-hidden="true" className="size-4" />
              )}
            </ItemMedia>

            <ItemContent className="min-w-0 gap-1">
              <ItemTitle className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate">{name}</span>
                {/* Saved Places and Trip Places are independent relationships to the
                    same Place, so whether this one is also saved is worth showing. */}
                {tripPlace.isSaved ? (
                  <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
                    {t('alsoSaved')}
                  </span>
                ) : null}
              </ItemTitle>
              <ItemDescription className="line-clamp-1">
                {placeDescription(tripPlace)}
              </ItemDescription>
              {tripPlace.note ? (
                <p className="line-clamp-2 text-sm text-text-subtle">{tripPlace.note}</p>
              ) : null}
              {usage ? <p className="text-xs text-muted-foreground">{usage}</p> : null}

              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Select
                  onValueChange={(value) =>
                    onPriorityChange(
                      tripPlace,
                      value === 'none' ? null : (value as TripPlacePriority),
                    )
                  }
                  value={tripPlace.priority ?? 'none'}
                >
                  <SelectTrigger aria-label={t('priorityFor', { name })} className="w-36" size="sm">
                    <SelectValue>{t(`priority.${tripPlace.priority ?? 'none'}`)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('priority.none')}</SelectItem>
                    <SelectItem value="must_go">{t('priority.must_go')}</SelectItem>
                    <SelectItem value="interested">{t('priority.interested')}</SelectItem>
                    <SelectItem value="maybe">{t('priority.maybe')}</SelectItem>
                  </SelectContent>
                </Select>

                {onAddToDay && addToDayLabel ? (
                  <Button
                    disabled={busyPlaceId === tripPlace.id}
                    onClick={() => onAddToDay(tripPlace)}
                    size="sm"
                    variant="outline"
                  >
                    <CalendarPlus aria-hidden="true" data-icon="inline-start" />
                    {addToDayLabel}
                  </Button>
                ) : null}
              </div>
            </ItemContent>

            <ItemActions className="shrink-0">
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
                <DropdownMenuContent align="end" className="min-w-44">
                  <DropdownMenuItem onClick={() => onViewDetails(tripPlace)}>
                    <Eye aria-hidden="true" />
                    {t('viewDetailsAction')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onEditNote(tripPlace)}>
                    <NotebookPen aria-hidden="true" />
                    {t('editNoteAction')}
                  </DropdownMenuItem>
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
  );
}
