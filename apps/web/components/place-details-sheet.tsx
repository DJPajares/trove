'use client';

import { ExternalLink } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { MediaAttribution } from '@/components/media-attribution';
import { PlaceMedia } from '@/components/place-media';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { resolvePlaceMediaSource } from '@/lib/media/trip-media';
import { googleMapsPlaceHref, type CanonicalPlace } from '@/lib/saved/api';

/** A row only the surface that opened this sheet can supply: a note, a priority, a collection. */
export type PlaceDetailsRow = { label: string; value: string };

type PlaceDetailsSheetProps = {
  /**
   * The photograph the surface already resolved for this place. Passed in
   * rather than resolved here: a sheet that asked for its own would turn one
   * request per screen into one per opening.
   */
  editorial: EditorialImageReference | null;
  meta?: PlaceDetailsRow[];
  name: string;
  /** The provider's name for the place, when the traveller has renamed it. */
  officialName?: string | null;
  onOpenChange: (open: boolean) => void;
  place: CanonicalPlace;
};

/**
 * What Trove knows about one Place, opened from wherever that Place is listed.
 *
 * Everything here is already in hand - the canonical Place the surface is
 * rendering and the editorial reference it resolved for the row - so opening
 * this costs no provider request. Rating, opening hours, website and phone are
 * deliberately absent: they are the mutable half Trove never stores (PRD 11.4),
 * and a live call per opening is exactly the fan-out that turns a screen into a
 * bill. Google Maps stays one tap away for those.
 *
 * It is also where a thumbnail's photograph gets credited. The row it was opened
 * from is too small to carry the credit, so the obligation lands here, on the
 * one surface that shows the photograph at a size worth reading.
 */
export function PlaceDetailsSheet({
  editorial,
  meta = [],
  name,
  officialName,
  onOpenChange,
  place,
}: Readonly<PlaceDetailsSheetProps>) {
  const t = useTranslations('placeDetail');
  const mediaTranslations = useTranslations('media');
  // The one canonical set of category labels lives with the Saved Places page,
  // and a place's category means the same thing on every surface.
  const categoryTranslations = useTranslations('saved');
  const locale = useLocale();

  const category = place.snapshot?.category;
  const address =
    place.kind === 'custom'
      ? null
      : (place.snapshot?.address ?? place.providerAddress ?? t('unavailableDescription'));
  const mapsHref = googleMapsPlaceHref(place);
  const coordinateFormatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 5 });
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });

  const rows: PlaceDetailsRow[] = [
    address ? { label: t('address'), value: address } : null,
    place.location
      ? {
          label: t('coordinates'),
          value: `${coordinateFormatter.format(place.location.latitude)}, ${coordinateFormatter.format(
            place.location.longitude,
          )}`,
        }
      : null,
    place.location?.timeZone ? { label: t('timeZone'), value: place.location.timeZone } : null,
    place.note ? { label: t('note'), value: place.note } : null,
    ...meta,
    // Provider data is stored dated rather than live, so the sheet says how old
    // what it is showing actually is instead of implying it was just fetched.
    place.snapshot
      ? {
          label: t('source'),
          value: place.snapshot.stale
            ? t('snapshotStale', { date: dateFormatter.format(new Date(place.snapshot.fetchedAt)) })
            : t('snapshotDated', {
                date: dateFormatter.format(new Date(place.snapshot.fetchedAt)),
              }),
        }
      : null,
  ].filter((row): row is PlaceDetailsRow => row !== null);

  return (
    <Sheet onOpenChange={onOpenChange} open>
      <SheetContent
        className="md:data-[side=right]:w-[min(30rem,calc(100%-0.5rem))]"
        closeLabel={t('close')}
        side="right"
      >
        <SheetHeader>
          <SheetTitle>{name}</SheetTitle>
          <SheetDescription>
            {officialName ?? (place.kind === 'custom' ? t('customDescription') : t('place'))}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-6">
          <PlaceMedia
            alt={editorial ? mediaTranslations('alt.placeEditorial', { name }) : ''}
            category={category}
            sizes="(max-width: 768px) 100vw, 30rem"
            source={resolvePlaceMediaSource({ editorial })}
            variant="card"
          />

          {category ? (
            <Badge size="sm" variant="muted">
              {categoryTranslations(`categories.${category}`)}
            </Badge>
          ) : null}

          {rows.length ? (
            <dl className="grid gap-3">
              {rows.map((row) => (
                <div className="grid gap-0.5" key={row.label}>
                  <dt className="text-xs text-muted-foreground">{row.label}</dt>
                  <dd className="text-sm break-words text-foreground">{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {/* The credit names itself - "Photo by ..." - so a "Photo" label above
              it would only say the same word twice. */}
          {editorial ? (
            <div className="border-t border-border-subtle pt-4">
              <MediaAttribution attribution={editorial.attribution} />
            </div>
          ) : null}
        </div>

        {mapsHref ? (
          <SheetFooter>
            <Button
              nativeButton={false}
              render={<a href={mapsHref} rel="noreferrer" target="_blank" />}
              variant="outline"
            >
              <ExternalLink aria-hidden="true" data-icon="inline-start" />
              {t('googleMaps')}
            </Button>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
