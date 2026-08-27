'use client';

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useTripChrome } from '@/components/trip-chrome';
import type { TripMediaSource } from '@/lib/media/trip-media';
import type { TripSection } from '@/lib/trips/navigation';
import { cn } from '@/lib/utils';

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
            <p
              className={cn(
                'max-w-[var(--layout-reading)] text-sm leading-[1.55] text-pretty text-muted-foreground',
                // Standing guidance is worth its rows on a wide screen and worth
                // fewer than none on a phone, where it sits between the traveller
                // and their own plan.
                currentSection === 'itinerary' && 'hidden sm:block',
              )}
            >
              {description}
            </p>,
            chrome.descriptionSlot,
          )
        : null}
    </>
  );
}
