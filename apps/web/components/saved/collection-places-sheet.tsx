'use client';

import { Check, CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { BrandedFallback } from '@/components/media-frame';
import { PlaceMedia } from '@/components/place-media';
import { SearchField } from '@/components/search-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetFooter, SheetHeading } from '@/components/ui/sheet';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import {
  editorialSubjectKey,
  MAX_EDITORIAL_IMAGE_SUBJECTS,
  primaryEditorialImage,
  type EditorialSubject,
} from '@/lib/media/editorial-images';
import { resolvePlaceMediaSource } from '@/lib/media/trip-media';
import type { SavedCollection, SavedPlace } from '@/lib/saved/api';
import { matchesPlaceQuery } from '@/lib/trip-places/list-view';
import { cn } from '@/lib/utils';

/** Past this many places, finding one by name beats scrolling for it. */
const SEARCHABLE_FROM = 8;

/**
 * Fills a collection from what is already saved: every saved place, each a
 * toggle that adds it to the collection or takes it out on the spot. A place
 * stays saved either way, and can sit in any number of collections.
 */
export function CollectionPlacesSheet({
  collection,
  error,
  nameOf,
  onOpenChange,
  onToggle,
  open,
  savedPlaces,
  subtitleOf,
  toggling,
}: Readonly<{
  collection: SavedCollection | null;
  error: string | null;
  nameOf: (savedPlace: SavedPlace) => string;
  onOpenChange: (open: boolean) => void;
  onToggle: (savedPlace: SavedPlace) => void;
  open: boolean;
  savedPlaces: readonly SavedPlace[];
  subtitleOf: (savedPlace: SavedPlace) => string;
  toggling: boolean;
}>) {
  const t = useTranslations('saved');
  const [query, setQuery] = useState('');
  const subject = (savedPlace: SavedPlace): EditorialSubject => ({
    category: savedPlace.place.snapshot?.category,
    name: nameOf(savedPlace),
    placeId: savedPlace.place.id,
  });
  // Thumbnails are asked for only while the sheet is open; Saved has usually
  // resolved them already, and the shared memo answers those for free.
  const images = useEditorialImages(
    open
      ? savedPlaces
          .filter((savedPlace) => savedPlace.place.kind === 'provider')
          .map(subject)
          .slice(0, MAX_EDITORIAL_IMAGE_SUBJECTS)
      : [],
  );
  const shown = savedPlaces.filter((savedPlace) =>
    matchesPlaceQuery(
      [
        nameOf(savedPlace),
        savedPlace.place.snapshot?.address,
        savedPlace.place.providerAddress,
        savedPlace.note,
      ],
      query,
    ),
  );

  return (
    <Sheet
      onOpenChange={(next) => {
        if (!next) setQuery('');
        onOpenChange(next);
      }}
      open={open && Boolean(collection)}
    >
      <SheetContent closeLabel={t('close')}>
        <SheetHeading
          description={t('addPlacesDescription')}
          title={t('addPlacesTitle', { name: collection?.name ?? '' })}
        />
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {error ? (
            <Alert role="alert" variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {savedPlaces.length > SEARCHABLE_FROM ? (
            <SearchField
              label={t('addPlacesSearchLabel')}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('addPlacesSearchPlaceholder')}
              value={query}
            />
          ) : null}
          {savedPlaces.length === 0 ? (
            <p className="text-sm leading-6 text-muted-foreground">{t('addPlacesNothingSaved')}</p>
          ) : shown.length === 0 ? (
            <p className="text-sm leading-6 text-muted-foreground">{t('addPlacesNoMatch')}</p>
          ) : (
            <ul className="space-y-1">
              {shown.map((savedPlace) => {
                const member = Boolean(
                  collection && savedPlace.collections.some((item) => item.id === collection.id),
                );
                const editorial =
                  savedPlace.place.kind === 'provider'
                    ? primaryEditorialImage(images.get(editorialSubjectKey(subject(savedPlace))))
                    : null;
                return (
                  <li key={savedPlace.id}>
                    <button
                      aria-pressed={member}
                      className={cn(
                        'flex min-h-16 w-full items-center gap-3 rounded-[var(--radius-lg)] px-2 py-2 text-left outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40 disabled:opacity-60 motion-reduce:transition-none',
                        member && 'bg-surface-tint',
                      )}
                      disabled={toggling}
                      onClick={() => onToggle(savedPlace)}
                      type="button"
                    >
                      <span className="relative size-12 shrink-0 overflow-hidden rounded-[var(--radius-md)]">
                        {savedPlace.place.kind === 'provider' ? (
                          <PlaceMedia
                            alt=""
                            category={savedPlace.place.snapshot?.category}
                            className="size-full rounded-none"
                            loadingTreatment="calm"
                            sizes="48px"
                            source={resolvePlaceMediaSource({ editorial })}
                            variant="thumbnail"
                          />
                        ) : (
                          <BrandedFallback alt="" category={savedPlace.place.snapshot?.category} />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{nameOf(savedPlace)}</span>
                        <span className="block truncate text-sm text-muted-foreground">
                          {subtitleOf(savedPlace)}
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          'grid size-7 shrink-0 place-items-center rounded-full border transition-colors duration-[var(--motion-standard)] motion-reduce:transition-none',
                          member
                            ? 'border-transparent bg-brand text-primary-foreground'
                            : 'border-border-strong text-transparent',
                        )}
                      >
                        <Check className="size-4" />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <SheetFooter>
          <Button onClick={() => onOpenChange(false)}>{t('done')}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
