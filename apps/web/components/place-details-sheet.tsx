'use client';

import { ExternalLink, XIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { PlacePhotoCarousel } from '@/components/place-photo-carousel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetTitle,
} from '@/components/ui/sheet';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { googleMapsPlaceHref, type CanonicalPlace } from '@/lib/saved/api';

/** A row only the surface that opened this sheet can supply: a note, a priority, a collection. */
export type PlaceDetailsRow = { label: string; value: string };

type PlaceDetailsSheetProps = {
  /**
   * The photograph the surface already resolved for this place. Passed in
   * rather than resolved here: a sheet that asked for its own would turn one
   * request per screen into one per opening.
   */
  editorialImages: EditorialImageReference[];
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
 * Photography keeps its attribution metadata without rendering credits on this
 * authenticated surface. Generic images are explicitly labeled as illustrative.
 */
export function PlaceDetailsSheet({
  editorialImages,
  meta = [],
  name,
  officialName,
  onOpenChange,
  place,
}: Readonly<PlaceDetailsSheetProps>) {
  const t = useTranslations('placeDetail');
  // The one canonical set of category labels lives with the Saved Places page,
  // and a place's category means the same thing on every surface.
  const categoryTranslations = useTranslations('saved');
  const locale = useLocale();

  const category = place.snapshot?.category;
  const providerAddress = place.snapshot?.address ?? place.providerAddress;
  const address = place.kind === 'custom' ? null : (providerAddress ?? t('unavailableDescription'));
  const location = providerAddress
    ?.split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(-2)
    .join(', ');
  const coverDescription =
    [officialName, location].filter(Boolean).join(' - ') ||
    (place.kind === 'custom' ? t('customDescription') : t('place'));
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
        className="gap-0 overflow-hidden md:data-[side=right]:w-[min(30rem,calc(100%-0.5rem))]"
        closeLabel={t('close')}
        side="right"
        showCloseButton={false}
      >
        <div className="min-h-0 flex-1 overflow-y-auto pb-6">
          <PlacePhotoCarousel
            category={category}
            footer={
              category ? (
                <div>
                  <Badge size="sm" variant="muted">
                    {categoryTranslations(`categories.${category}`)}
                  </Badge>
                </div>
              ) : undefined
            }
            heading={
              <>
                <SheetTitle className="text-[1.75rem] leading-[1.1] text-balance text-media-fallback-foreground">
                  {name}
                </SheetTitle>
                <SheetDescription className="text-media-fallback-foreground/82">
                  {coverDescription}
                </SheetDescription>
              </>
            }
            images={editorialImages}
            name={name}
          />

          {rows.length ? (
            <dl className="grid gap-4 px-6 pt-5">
              {rows.map((row) => (
                <div className="grid gap-1" key={row.label}>
                  <dt className="text-xs text-muted-foreground">{row.label}</dt>
                  <dd className="text-sm break-words text-foreground">{row.value}</dd>
                </div>
              ))}
            </dl>
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

        <SheetClose
          render={
            <Button
              className="absolute top-[max(1rem,var(--safe-top))] right-[max(1rem,var(--safe-right))] border-media-fallback-foreground/18 bg-neutral-950/58 text-media-fallback-foreground backdrop-blur-sm hover:bg-neutral-950/78 hover:text-media-fallback-foreground"
              size="icon-sm"
              variant="ghost"
            />
          }
        >
          <XIcon aria-hidden="true" />
          <span className="sr-only">{t('close')}</span>
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}
