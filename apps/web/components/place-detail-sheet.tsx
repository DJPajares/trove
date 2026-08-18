'use client';

import { ExternalLink, MapPinned, Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  cacheProviderPlaceDetails,
  getCachedProviderPlaceDetails,
  getProviderPlaceDetails,
  resolveProviderPlacePhoto,
  type CanonicalPlace,
  type ProviderPlaceDetails,
} from '@/lib/saved/api';

type PlaceDetailSheetProps = {
  context: {
    /** What the traveller renamed this Place to on the trip they opened it from. */
    customName?: string | null;
    isSaved?: boolean;
    note?: string | null;
    tripName?: string | null;
  };
  onOpenChange: (open: boolean) => void;
  open: boolean;
  place: CanonicalPlace | null;
};

export function PlaceDetailSheet({
  context,
  onOpenChange,
  open,
  place,
}: Readonly<PlaceDetailSheetProps>) {
  const t = useTranslations('placeDetail');
  const [details, setDetails] = useState<ProviderPlaceDetails | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'unavailable'>('idle');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !place || place.kind === 'custom') return;
    const externalPlaceId = place.providerRefs[0]?.externalPlaceId;
    if (!externalPlaceId) return;
    // This sheet is the one surface that needs the mutable detail, so it is the
    // one place that pays for a full Place Details call. Reopening the same
    // sheet within the session should not pay again.
    const cached = getCachedProviderPlaceDetails(place.id, 'full');
    if (cached) {
      setDetails(cached as ProviderPlaceDetails);
      setStatus('idle');
      return;
    }

    let active = true;
    setStatus('loading');
    void getProviderPlaceDetails(externalPlaceId, 'full')
      .then((result) => {
        if (!active) return;
        const resolved = result.status === 'ok' ? (result.place ?? null) : null;
        if (resolved) cacheProviderPlaceDetails(place.id, resolved, 'full');
        setDetails(resolved);
        setStatus(result.status === 'ok' ? 'idle' : 'unavailable');
      })
      .catch(() => active && setStatus('unavailable'));
    return () => {
      active = false;
    };
  }, [open, place]);

  useEffect(() => {
    const photoName = details?.photos?.[0]?.name;
    if (!open || !photoName) return;
    let active = true;
    void resolveProviderPlacePhoto(photoName)
      .then(
        (result) =>
          active && setPhotoUrl(result.status === 'ok' ? (result.photo?.uri ?? null) : null),
      )
      .catch(() => active && setPhotoUrl(null));
    return () => {
      active = false;
    };
  }, [details?.photos, open]);

  // The name the provider gave, falling back to the label captured when the Place
  // was first added so an unreachable provider does not make it anonymous.
  const providerName = place?.kind === 'provider' ? (details?.name ?? place.providerLabel) : null;
  const name =
    context.customName?.trim() ||
    (place?.kind === 'custom' ? (place.name ?? t('customPlace')) : (providerName ?? t('place')));
  const description =
    place?.kind === 'custom'
      ? (place.note ?? t('customDescription'))
      : (details?.formattedAddress ?? place?.providerAddress ?? t('unavailableDescription'));
  /** Shown under the title only when the traveller's own name has taken it. */
  const officialName = context.customName?.trim() ? providerName : null;

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent
        className="w-full md:data-[side=right]:w-[min(34rem,calc(100%-0.5rem))]"
        closeLabel={t('close')}
        side="right"
      >
        <SheetHeader className="border-b">
          <SheetTitle>{name}</SheetTitle>
          {officialName ? (
            <p className="text-sm font-medium text-foreground">{officialName}</p>
          ) : null}
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 overflow-y-auto p-5">
          {context.isSaved || context.tripName || context.note ? (
            <section className="space-y-2 text-sm">
              {context.isSaved ? <p className="font-medium text-brand">{t('saved')}</p> : null}
              {context.tripName ? (
                <p className="text-muted-foreground">
                  {t('tripContext', { trip: context.tripName })}
                </p>
              ) : null}
              {context.note ? <p className="text-muted-foreground">{context.note}</p> : null}
            </section>
          ) : null}

          {place?.kind === 'provider' ? (
            <>
              <Separator />
              {status === 'loading' ? (
                <p className="text-sm text-muted-foreground">{t('refreshing')}</p>
              ) : null}
              {details ? (
                <div className="space-y-5">
                  {photoUrl ? (
                    <img
                      alt=""
                      className="aspect-[16/9] w-full rounded-[var(--radius-lg)] object-cover"
                      src={photoUrl}
                    />
                  ) : null}
                  {details.rating !== null && details.rating !== undefined ? (
                    <div className="flex items-center gap-2 text-sm">
                      <Star aria-hidden="true" className="size-4 fill-current text-brand" />
                      <span className="font-medium">{details.rating.toFixed(1)}</span>
                      <span className="text-muted-foreground">
                        {t('googleRating', { count: details.userRatingCount ?? 0 })}
                      </span>
                    </div>
                  ) : null}
                  {details.regularOpeningHours?.length ? (
                    <section className="space-y-2">
                      <h3 className="text-sm font-medium">{t('openingHours')}</h3>
                      <ul className="space-y-1 text-sm text-muted-foreground">
                        {details.regularOpeningHours.map((hours) => (
                          <li key={hours}>{hours}</li>
                        ))}
                      </ul>
                      <p className="text-xs text-muted-foreground">{t('freshness')}</p>
                    </section>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {details.nationalPhoneNumber ? (
                      <Button
                        nativeButton={false}
                        render={<a href={`tel:${details.nationalPhoneNumber}`} />}
                        size="sm"
                        variant="outline"
                      >
                        {details.nationalPhoneNumber}
                      </Button>
                    ) : null}
                    {details.websiteUri ? (
                      <Button
                        nativeButton={false}
                        render={<a href={details.websiteUri} rel="noreferrer" target="_blank" />}
                        size="sm"
                        variant="outline"
                      >
                        <ExternalLink aria-hidden="true" data-icon="inline-start" />
                        {t('website')}
                      </Button>
                    ) : null}
                    {details.googleMapsUri ? (
                      <Button
                        nativeButton={false}
                        render={<a href={details.googleMapsUri} rel="noreferrer" target="_blank" />}
                        size="sm"
                        variant="outline"
                      >
                        <MapPinned aria-hidden="true" data-icon="inline-start" />
                        {t('googleMaps')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : status === 'unavailable' ? (
                <p className="text-sm text-muted-foreground">{t('unavailable')}</p>
              ) : null}
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
