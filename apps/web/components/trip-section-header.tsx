'use client';

import { Plus } from 'lucide-react';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useRegisterPrimaryAction } from '@/components/primary-action-provider';
import { useTripChrome } from '@/components/trip-chrome';
import { Button } from '@/components/ui/button';
import type { TripMediaSource } from '@/lib/media/trip-media';
import type { TripSection } from '@/lib/trips/navigation';

export type { TripSection };

/** The one thing a screen makes, such as an expense or a task. */
export type TripSectionPrimaryAction = {
  icon?: ReactNode;
  label: string;
  onSelect: () => void;
};

type TripSectionHeaderProps = {
  /** Secondary actions, shown on the toolbar's trailing edge at every width. */
  actions?: ReactNode;
  /** A control belonging on the cover itself, such as a trip's rating. */
  coverMeta?: ReactNode;
  /** Overrides the cover the trip would otherwise show, as Memories does. */
  coverSource?: TripMediaSource;
  /** Trove's standing guidance for the screen, shown where there is room for it. */
  description?: string;
  /** The screen's own view control, such as the itinerary's Day and Overview. */
  leading?: ReactNode;
  /**
   * The screen's create action. On a phone it is the bottom bar's plus button,
   * which is already the create action on every screen; with no bottom bar it
   * is a labelled button at the end of the toolbar.
   */
  primaryAction?: TripSectionPrimaryAction;
};

/** Standing guidance earns a line from Tailwind's `sm` up; a phone keeps it for content. */
const WIDE_ENOUGH_FOR_GUIDANCE = '(min-width: 40rem)';
/** Tailwind's `md`, where the bottom bar and its plus button give way to the header. */
const WITHOUT_BOTTOM_BAR = '(min-width: 48rem)';

/**
 * Whether a media query matches. A real condition rather than a `hidden` class,
 * because an element hidden by CSS still fills the toolbar and holds its row
 * open; the server cannot know the viewport, so it guesses the phone.
 */
function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * The part of a trip's header that belongs to the screen rather than the trip.
 *
 * The cover and the navigation row live in `TripChrome`, mounted once by the
 * section layout. What is per-screen renders into the section toolbar directly
 * under that navigation: a view control or guidance leading, actions trailing.
 * Everything a screen puts here sits against the section it acts on, and a
 * screen with nothing to show there gets no row at all.
 *
 * Rendering nothing in place is deliberate: a screen keeps declaring its header
 * where the header reads in its markup, and the chrome decides where it lands.
 */
export function TripSectionHeader({
  actions,
  coverMeta,
  coverSource,
  description,
  leading,
  primaryAction,
}: Readonly<TripSectionHeaderProps>) {
  const chrome = useTripChrome();
  const setCoverSource = chrome?.setCoverSource;
  const wideEnoughForGuidance = useMediaQuery(WIDE_ENOUGH_FOR_GUIDANCE);
  const withoutBottomBar = useMediaQuery(WITHOUT_BOTTOM_BAR);

  useRegisterPrimaryAction({
    enabled: Boolean(primaryAction),
    label: primaryAction?.label ?? '',
    onTrigger: () => primaryAction?.onSelect(),
  });

  useEffect(() => {
    if (!setCoverSource) return;
    setCoverSource(coverSource ?? null);

    return () => setCoverSource(null);
  }, [coverSource, setCoverSource]);

  if (!chrome) return null;

  // A view control is the more useful occupant of the leading edge, so guidance
  // only takes it when a screen has none - and only where it costs no row.
  const leadingContent =
    leading ??
    (description && wideEnoughForGuidance ? (
      <p className="line-clamp-2 max-w-(--layout-reading) text-sm leading-[1.5] text-pretty text-muted-foreground">
        {description}
      </p>
    ) : null);
  const primaryButton =
    primaryAction && withoutBottomBar ? (
      <Button onClick={primaryAction.onSelect} type="button">
        {primaryAction.icon ?? <Plus aria-hidden="true" data-icon="inline-start" />}
        {primaryAction.label}
      </Button>
    ) : null;
  const trailingContent =
    actions || primaryButton ? (
      <>
        {actions}
        {primaryButton}
      </>
    ) : null;

  return (
    <>
      {leadingContent && chrome.leadingSlot
        ? createPortal(leadingContent, chrome.leadingSlot)
        : null}
      {trailingContent && chrome.actionsSlot
        ? createPortal(trailingContent, chrome.actionsSlot)
        : null}
      {coverMeta && chrome.coverMetaSlot ? createPortal(coverMeta, chrome.coverMetaSlot) : null}
    </>
  );
}
