'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Globe, MapPin, Phone, Star, XIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { PlacePhotoCarousel, type PlacePhotoMetadata } from '@/components/place-photo-carousel';
import { PlaceOpeningHours } from '@/components/place-opening-hours';
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
import { Skeleton } from '@/components/ui/skeleton';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { visitWeekdayIndex } from '@/lib/places/opening-hours';
import {
  fetchRichPlaceDetails,
  fetchPlacePhoto,
  googleMapsPlaceHref,
  type CanonicalPlace,
  type RichPlaceDetails,
} from '@/lib/saved/api';

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
 * Provider-backed details reuse the shared rich metadata cache acquired on
 * selection, or enrich incomplete evidence once on opening. Opening resolves
 * only the cover photo; further photos require selection. All provider data
 * retains its original acquisition time and 30-day maximum lifetime.
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
  const detailsKey = ['place-rich-details', place.id, locale, 'photos-v2'] as const;
  const [photoRequests, setPhotoRequests] = useState<Record<string, 'loading' | 'failed'>>({});
  const richDetails = useQuery({
    // Versioned: this root is persisted, and an answer from before photos and
    // contact links were part of it must not be read back as a current one.
    queryKey: detailsKey,
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
    // Recheck presentation policy on opening; the API still reuses the same
    // bounded evidence and resolved images. Cached content stays visible offline.
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  async function requestPhoto(photoId: string) {
    const snapshot = richDetails.data;
    const slot = snapshot?.place.photoSlots?.find((item) => item.id === photoId);
    if (!snapshot || !slot || slot.uri !== null) return;
    const fetchedAt = snapshot.freshness.fetchedAt;
    const requestKey = `${fetchedAt}:${photoId}`;
    setPhotoRequests((current) => ({ ...current, [requestKey]: 'loading' }));
    try {
      const result = await queryClient.fetchQuery({
        queryKey: [...detailsKey, fetchedAt, photoId],
        queryFn: () => fetchPlacePhoto(place.id, photoId, locale, fetchedAt),
        staleTime: (query) =>
          query.state.data?.status === 'disabled'
            ? 0
            : Math.max(0, Date.parse(fetchedAt) + EVIDENCE_LIFETIME_MS - Date.now()),
        retry: false,
      });
      queryClient.setQueryData<RichPlaceDetails | null>(detailsKey, (current) => {
        if (!current || current.freshness.fetchedAt !== fetchedAt) return current;
        // Keep cached imagery while policy refreshes. Another unresolved slot
        // must not become an endless loader if that refresh fails.
        const slots =
          result.status === 'disabled'
            ? current.place.photoSlots?.filter((photo) => Boolean(photo.uri))
            : current.place.photoSlots?.map((photo) =>
                photo.id === photoId ? { ...photo, uri: result.uri } : photo,
              );
        return {
          ...current,
          place: {
            ...current.place,
            photoSlots: slots,
            photos: (slots ?? []).flatMap(({ uri, authorAttributions, widthPx, heightPx }) =>
              uri ? [{ uri, authorAttributions, widthPx, heightPx }] : [],
            ),
          },
        };
      });
      setPhotoRequests((current) => {
        const next = { ...current };
        delete next[requestKey];
        return next;
      });
      // An already-open sheet may hold slots from before an API policy change.
      // An intentional refusal refreshes the slots without a failure or retry UI.
      if (result.status === 'disabled') void richDetails.refetch();
    } catch (error) {
      setPhotoRequests((current) => ({ ...current, [requestKey]: 'failed' }));
      // Refresh an expired/replaced snapshot only in response to this user action.
      if ((error as { status?: number }).status === 409) void richDetails.refetch();
    }
  }

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
          providerPhotoSlots={evidence?.photoSlots}
          onRequestPhoto={(id) => void requestPhoto(id)}
          photoRequests={photoRequests}
          evidenceFetchedAt={richDetails.data?.freshness.fetchedAt}
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
            <PlaceOpeningHours
              highlightedIndex={highlightedIndex}
              hours={hours}
              plannedVisit={plannedVisit}
            />
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
