'use client';

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useTripChrome } from '@/components/trip-chrome';
import type { TripMediaSource } from '@/lib/media/trip-media';
import type { TripSection } from '@/lib/trips/navigation';
import { cn } from '@/lib/utils';
import { Card, CardContent } from './ui/card';

export type { TripSection };

type TripSectionHeaderProps = {
  /** The screen's own actions, shown above the shared navigation row. */
  actions?: ReactNode;
  /** A control belonging on the cover itself, such as a trip's rating. */
  coverMeta?: ReactNode;
  /** Overrides the cover the trip would otherwise show, as Memories does. */
  coverSource?: TripMediaSource;
  currentSection: TripSection;
  description?: string;
  /**
   * Whether `description` is the traveller's own words rather than Trove's
   * standing guidance. Guidance earns its rows on a wide screen and fewer than
   * none on a phone; what a traveller wrote about their own trip is worth the
   * rows everywhere.
   */
  descriptionIsOwnContent?: boolean;
};

/**
 * The part of a trip's header that belongs to the screen rather than the trip.
 *
 * The cover and the navigation row moved to `TripChrome`, which the section
 * layout mounts once: they are the same on every screen, and re-rendering them
 * per screen is what made the cover flicker and the plan jump. What is left is
 * genuinely per-screen, and it renders into the chrome's slots so the reading
 * order on the page is unchanged — actions above the nav row, guidance below it.
 *
 * Rendering nothing in place is deliberate: a screen keeps declaring its header
 * where the header reads in its markup, and the chrome decides where it lands.
 */
export function TripSectionHeader({
  actions,
  coverMeta,
  coverSource,
  currentSection,
  description,
  descriptionIsOwnContent = false,
}: Readonly<TripSectionHeaderProps>) {
  const chrome = useTripChrome();
  const setCoverSource = chrome?.setCoverSource;

  useEffect(() => {
    if (!setCoverSource) return;
    setCoverSource(coverSource ?? null);

    return () => setCoverSource(null);
  }, [coverSource, setCoverSource]);

  if (!chrome) return null;

  return (
    <>
      {actions && chrome.actionsSlot ? createPortal(actions, chrome.actionsSlot) : null}
      {coverMeta && chrome.coverMetaSlot ? createPortal(coverMeta, chrome.coverMetaSlot) : null}
      {description && chrome.descriptionSlot
        ? createPortal(
            <Card size="sm" className="bg-transparent">
              <CardContent>
                <p
                  className={cn(
                    'max-w-(--layout-reading) text-sm leading-[1.55] text-pretty text-muted-foreground',
                    // Standing guidance is worth its rows on a wide screen and worth
                    // fewer than none on a phone, where it sits between the traveller
                    // and their own plan. Their own description is not guidance.
                    currentSection === 'itinerary' && !descriptionIsOwnContent && 'hidden sm:block',
                    // A description has no length Trove controls, and this header is
                    // not where a long one belongs.
                    descriptionIsOwnContent && 'line-clamp-3 whitespace-pre-line',
                  )}
                >
                  {description}
                </p>
              </CardContent>
            </Card>,
            chrome.descriptionSlot,
          )
        : null}
    </>
  );
}
