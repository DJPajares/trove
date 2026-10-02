'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ExternalLink, Globe, MapPin, Phone, Star, XIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { PlacePhotoCarousel, type PlacePhotoMetadata } from '@/components/place-photo-carousel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { visitWeekdayIndex } from '@/lib/places/opening-hours';
import { fetchRichPlaceDetails, googleMapsPlaceHref, type CanonicalPlace } from '@/lib/saved/api';
import { cn } from '@/lib/utils';

/** A row only the surface that opened this sheet can supply: a note, a priority, a collection. */
export type PlaceDetailsRow = { label: string; value: string };

type PlaceDetailsSheetProps = {
  /**
   * The photograph the surface already resolved for this place. Passed in
   * rather than resolved here: a sheet that asked for its own would turn one
   * request per screen into one per opening. It is the cover whenever Google
   * has no photo of the place to show.
   */
  editorialImages: EditorialImageReference[];
  meta?: PlaceDetailsRow[];
  name: string;
  /** The provider's name for the place, when the traveller has renamed it. */
  officialName?: string | null;
  /**
   * Offered only by a surface that can repair a Custom Place that never resolved
   * its coordinates. Absent everywhere else, which is what keeps this sheet free
   * of any action it cannot pay for.
   */
  onLocate?: () => void;
  onOpenChange: (open: boolean) => void;
  place: CanonicalPlace;
  /** Local visit date; omitted uses today at the place, null keeps an ambiguous week neutral. */
  visitDate?: string | null;
};

const EVIDENCE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * What Trove knows about one Place, opened from wherever that Place is listed.
 *
 * Opening provider-backed details acquires the rich response on demand through
 * the shared bounded cache: rating, hours, contact links and up to three Google
 * photos, all dated and kept for at most 30 days. List rows and decorative
 * images never acquire it.
 *
 * The cover is fixed at the top and the details scroll beneath it. Google
 * photos carry their author's credit; editorial photography keeps its
 * attribution metadata without rendering credits on this authenticated surface,
 * and a generic one is labelled as illustrative.
 */
export function PlaceDetailsSheet({
  editorialImages,
  meta = [],
  name,
  officialName,
  onLocate,
  onOpenChange,
  place,
  visitDate,
}: Readonly<PlaceDetailsSheetProps>) {
  const t = useTranslations('placeDetail');
  // The one canonical set of category labels lives with the Saved Places page,
  // and a place's category means the same thing on every surface.
  const categoryTranslations = useTranslations('saved');
  const locale = useLocale();
  const [photo, setPhoto] = useState<PlacePhotoMetadata | null>(null);

  const queryClient = useQueryClient();
  const richDetails = useQuery({
    // Versioned: this root is persisted, and an answer from before photos and
    // contact links were part of it must not be read back as a current one.
    queryKey: ['place-rich-details', place.id, locale, 'photos-v1'],
    queryFn: () => fetchRichPlaceDetails(place.id, locale),
    enabled: place.kind === 'provider',
    retry: false,
    staleTime: (query) =>
      query.state.data
        ? Math.max(
            0,
            Date.parse(query.state.data.freshness.fetchedAt) +
              EVIDENCE_LIFETIME_MS -
              query.state.dataUpdatedAt,
          )
        : 0,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Opening a place is what stores its hours and rating, so the lists that show
  // them should now find them.
  const detailsLoaded = Boolean(richDetails.data);
  useEffect(() => {
    if (detailsLoaded) void queryClient.invalidateQueries({ queryKey: ['place-hours'] });
  }, [detailsLoaded, queryClient]);

  const evidence = richDetails.data?.place;
  const loadingEvidence = place.kind === 'provider' && richDetails.isPending;
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
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const visitDateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  });

  const rating = evidence?.rating ?? null;
  const reviewCount = evidence?.userRatingCount ?? null;
  const priceLevel = evidence?.priceLevel ?? null;
  const hours = evidence?.openingHoursDescriptions ?? [];
  const highlightedIndex = visitWeekdayIndex(visitDate, evidence?.utcOffsetMinutes);
  const highlightedHours = highlightedIndex === null ? null : (hours[highlightedIndex] ?? null);
  const plannedVisit =
    visitDate && highlightedIndex !== null
      ? t('plannedVisit', {
          date: visitDateFormatter.format(new Date(`${visitDate}T00:00:00.000Z`)),
        })
      : null;
  const hasPhotoMetadata =
    photo && (photo.credits.length > 0 || photo.illustrative || photo.description);
  const phone = evidence?.internationalPhoneNumber ?? null;

  const actions = [
    mapsHref ? { href: mapsHref, Icon: ExternalLink, label: t('googleMaps') } : null,
    evidence?.websiteUri ? { href: evidence.websiteUri, Icon: Globe, label: t('website') } : null,
    phone ? { href: `tel:${phone.replace(/[^\d+]/g, '')}`, Icon: Phone, label: t('call') } : null,
  ].filter((action) => action !== null);

  const rows: PlaceDetailsRow[] = [
    address ? { label: t('address'), value: address } : null,
    phone ? { label: t('phone'), value: phone } : null,
    place.note ? { label: t('note'), value: place.note } : null,
    ...meta,
  ].filter((row): row is PlaceDetailsRow => row !== null);

  // Provider data is stored dated rather than live, so the sheet says how old
  // what it is showing actually is instead of implying it was just fetched.
  const checkedAt = richDetails.data?.freshness.fetchedAt ?? place.snapshot?.fetchedAt ?? null;
  const sourceLine = checkedAt
    ? t(!richDetails.data && place.snapshot?.stale ? 'snapshotStale' : 'snapshotDated', {
        date: dateFormatter.format(new Date(checkedAt)),
      })
    : null;

  return (
    <Sheet onOpenChange={onOpenChange} open>
      <SheetContent
        className="gap-0 overflow-hidden md:data-[side=right]:w-[min(30rem,calc(100%-0.5rem))]"
        closeLabel={t('close')}
        side="right"
        showCloseButton={false}
      >
        <PlacePhotoCarousel
          category={category}
          editorialImages={editorialImages}
          heading={
            <>
              <SheetTitle className="text-[1.75rem] leading-[1.1] text-balance text-media-fallback-foreground">
                {name}
              </SheetTitle>
              <SheetDescription className="line-clamp-2 text-media-fallback-foreground/82">
                {coverDescription}
              </SheetDescription>
            </>
          }
          name={name}
          onPhotoChange={setPhoto}
          pending={loadingEvidence}
          providerPhotos={evidence?.photos}
        />

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6">
          <section className="grid gap-4 px-6 pt-5">
            {loadingEvidence ? (
              <Skeleton className="h-5 w-48" />
            ) : category || rating !== null || priceLevel !== null ? (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                {category ? (
                  <Badge size="sm" variant="muted">
                    {categoryTranslations(`categories.${category}`)}
                  </Badge>
                ) : null}
                {rating !== null ? (
                  <span
                    aria-label={t(reviewCount === null ? 'ratingOnly' : 'ratingSummary', {
                      count: reviewCount ?? 0,
                      rating: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
                        rating,
                      ),
                    })}
                    className="inline-flex items-center gap-1"
                    role="img"
                  >
                    <Star aria-hidden="true" className="size-4 fill-current text-rating" />
                    <span className="font-medium text-foreground">
                      {new Intl.NumberFormat(locale, {
                        maximumFractionDigits: 1,
                        minimumFractionDigits: 1,
                      }).format(rating)}
                    </span>
                    {reviewCount !== null ? (
                      <span className="text-muted-foreground">
                        (
                        {new Intl.NumberFormat(locale, { notation: 'compact' }).format(reviewCount)}
                        )
                      </span>
                    ) : null}
                  </span>
                ) : null}
                {priceLevel !== null ? (
                  <span className="text-muted-foreground">{t(`priceLevel.${priceLevel}`)}</span>
                ) : null}
              </p>
            ) : null}

            {actions.length ? (
              <div className="flex flex-wrap gap-2">
                {actions.map(({ href, Icon, label }) => (
                  <Button
                    key={label}
                    nativeButton={false}
                    render={
                      href.startsWith('tel:') ? (
                        <a href={href} />
                      ) : (
                        <a href={href} rel="noreferrer" target="_blank" />
                      )
                    }
                    size="sm"
                    variant="outline"
                  >
                    <Icon aria-hidden="true" data-icon="inline-start" />
                    {label}
                  </Button>
                ))}
              </div>
            ) : null}
          </section>

          {loadingEvidence ? (
            <Skeleton className="mx-6 mt-5 h-14 rounded-[var(--radius-lg)]" />
          ) : hours.length ? (
            <Collapsible className="mx-6 mt-5 rounded-[var(--radius-lg)] border border-border-subtle">
              <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                <span className="grid gap-0.5">
                  <span className="text-xs font-normal text-muted-foreground group-data-[panel-open]:text-sm group-data-[panel-open]:font-medium group-data-[panel-open]:text-foreground">
                    {t('regularHours')}
                  </span>
                  <span className="text-sm text-foreground group-data-[panel-open]:hidden">
                    {highlightedHours ?? t('showWeek')}
                  </span>
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="transition-transform duration-[var(--motion-standard)] group-data-[panel-open]:rotate-180 motion-reduce:transition-none"
                />
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <ul className="grid gap-0.5 px-1 pb-3 text-sm">
                  {hours.map((line, index) => (
                    <li
                      aria-current={index === highlightedIndex ? 'date' : undefined}
                      className={cn(
                        'mx-1 rounded-[var(--radius-sm)] px-2 py-1.5 text-muted-foreground',
                        index === highlightedIndex &&
                          'bg-secondary font-medium text-secondary-foreground',
                      )}
                      key={line}
                    >
                      {line}
                      {index === highlightedIndex && plannedVisit ? (
                        <span className="mt-0.5 block text-xs font-normal">{plannedVisit}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </CollapsiblePanel>
            </Collapsible>
          ) : null}

          {rows.length || hasPhotoMetadata ? (
            <dl className="grid gap-4 px-6 pt-5">
              {rows.map((row) => (
                <div className="grid gap-1" key={`${row.label}:${row.value}`}>
                  <dt className="text-xs text-muted-foreground">{row.label}</dt>
                  <dd className="text-sm break-words whitespace-pre-line text-foreground">
                    {row.value}
                  </dd>
                </div>
              ))}
              {hasPhotoMetadata && photo ? (
                <div className="grid gap-1">
                  <dt className="text-xs text-muted-foreground">{t('photo')}</dt>
                  <dd
                    aria-live="polite"
                    className="grid gap-1 text-xs break-words text-muted-foreground"
                  >
                    {photo.credits.map((credit) => (
                      <span key={`${credit.displayName}:${credit.uri}`}>
                        {credit.uri ? (
                          <a
                            className="rounded-[var(--radius-xs)] underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
                            href={credit.uri}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {t('photoCredit', { name: credit.displayName })}
                          </a>
                        ) : (
                          t('photoCredit', { name: credit.displayName })
                        )}
                      </span>
                    ))}
                    {photo.illustrative ? <span>{t('representativePhoto')}</span> : null}
                    {photo.description ? (
                      <span>
                        {t('photoDescription')}
                        {' · '}
                        {photo.description}
                      </span>
                    ) : null}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}

          <div className="mx-6 mt-6 grid gap-1.5 border-t border-border-subtle pt-4 text-xs text-muted-foreground">
            {place.kind === 'provider' ? (
              <p>
                {[t('googleAttribution'), sourceLine].filter(Boolean).join(' · ')}
                {evidence?.attributions.map((attribution) => (
                  <span key={attribution.provider}>
                    {' · '}
                    {attribution.providerUri ? (
                      <a
                        className="underline"
                        href={attribution.providerUri}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {attribution.provider}
                      </a>
                    ) : (
                      attribution.provider
                    )}
                  </span>
                ))}
              </p>
            ) : null}
            {place.kind === 'provider' &&
            (richDetails.isError || (richDetails.isFetched && !evidence)) ? (
              <p>{t('richUnavailable')}</p>
            ) : null}
          </div>
        </div>

        {/* A Custom Place has no Google listing to link out to, so this footer
            is where it gets the one action that can give it a location. */}
        {onLocate ? (
          <SheetFooter>
            <Button onClick={onLocate} variant="outline">
              <MapPin aria-hidden="true" data-icon="inline-start" />
              {t('locate.action')}
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
