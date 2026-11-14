'use client';

import type { TripOverviewData } from '@trove/types';
import { ArrowRight, ArrowUpRight, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { buttonVariants } from '@/components/ui/button';
import type { Trip } from '@/lib/trips/api';
import {
  dayPreviewHref,
  tripOverviewDestinations,
  type TripCoreExperience,
} from '@/lib/trips/navigation';
import { overviewPlannerHref, type TripHubStage } from '@/lib/trips/overview';
import { cn } from '@/lib/utils';

type Way = {
  section: TripCoreExperience;
  href: string;
  title: string;
  body: string | null;
  tag: string | null;
};

/** Plan it, live it, remember it: the tagline is also the order on screen. */
const ORDER: TripCoreExperience[] = ['itinerary', 'mode', 'memories'];

const kickerKey = {
  itinerary: 'chapter.plan',
  mode: 'chapter.live',
  memories: 'chapter.remember',
} as const satisfies Record<TripCoreExperience, string>;

/**
 * Which experience leads at each stage. Before a trip the plan leads, then a
 * rehearsal of it in the last week; while travelling Trip Mode does, and
 * afterwards Memories.
 */
function leadingSection(stage: TripHubStage, archived: boolean): TripCoreExperience {
  if (archived) return 'itinerary';
  if (stage === 'soon' || stage === 'live') return 'mode';
  if (stage === 'remember') return 'memories';
  return 'itinerary';
}

/**
 * The trip's three experiences in one place, each saying in a traveller's words
 * what it opens. The one that fits the stage leads with the page's main action;
 * the other two sit beside it as full rows rather than footnotes.
 */
export function TripHubWays({
  className,
  overview,
  stage,
  trip,
}: Readonly<{
  className?: string;
  overview: TripOverviewData | undefined;
  stage: TripHubStage;
  trip: Trip;
}>) {
  const t = useTranslations('trips.hub');
  const ways = useTranslations('trips.hub.ways');
  const archiveT = useTranslations('trips.archive');
  const archived = Boolean(trip.archivedAt);
  const lead = leadingSection(stage, archived);
  const day = overview?.day ?? null;
  const destinations = tripOverviewDestinations(trip.id, trip.lifecycle, trip.startDate);
  const modeHref = [destinations.primary, ...destinations.secondary].find(
    (destination) => destination.section === 'mode',
  )!.href;
  const hasStory = Boolean(
    trip.memoryCount ||
    trip.hasStoryContent ||
    overview?.memories.note ||
    overview?.memories.photos.length,
  );
  // A rehearsal is worth taking on a day that has something in it.
  const previewDay = overview?.days.find((entry) => entry.stopCount > 0) ?? null;

  const itinerary: Way = archived
    ? {
        section: 'itinerary',
        href: `/trips/${trip.id}/itinerary`,
        title: archiveT('browse'),
        body: null,
        tag: null,
      }
    : stage === 'plan'
      ? {
          section: 'itinerary',
          href: overviewPlannerHref(trip.id, day?.id ?? null),
          title:
            day?.state === 'empty' ? t('planDay', { number: day.number }) : t('continuePlanning'),
          body: ways('lead.plan'),
          tag: null,
        }
      : stage === 'soon'
        ? {
            section: 'itinerary',
            href: overviewPlannerHref(trip.id, day?.id ?? null),
            title: ways('itinerary.soonTitle'),
            body: ways('itinerary.soonBody'),
            tag: null,
          }
        : stage === 'live'
          ? {
              section: 'itinerary',
              href: overviewPlannerHref(trip.id, day?.id ?? null),
              title: ways('itinerary.liveTitle'),
              body: ways('itinerary.liveBody'),
              tag: null,
            }
          : {
              section: 'itinerary',
              href: `/trips/${trip.id}/itinerary`,
              title: ways('itinerary.rememberTitle'),
              body: ways('itinerary.rememberBody'),
              tag: null,
            };

  const mode: Way =
    stage === 'live'
      ? {
          section: 'mode',
          href: modeHref,
          title: t('continueTrip'),
          body: ways('lead.live'),
          tag: null,
        }
      : stage === 'soon'
        ? previewDay
          ? {
              section: 'mode',
              href: dayPreviewHref(trip.id, previewDay.date),
              title: ways('previewDay', { number: previewDay.number }),
              body: ways('lead.preview', { number: previewDay.number }),
              tag: null,
            }
          : {
              section: 'mode',
              href: modeHref,
              title: ways('previewTrip'),
              body: ways('lead.previewTrip'),
              tag: null,
            }
        : stage === 'remember'
          ? {
              section: 'mode',
              href: modeHref,
              title: ways('mode.rememberTitle'),
              body: ways('mode.rememberBody'),
              tag: ways('previewTag'),
            }
          : {
              section: 'mode',
              href: modeHref,
              title: ways('mode.planTitle'),
              body: ways('mode.planBody'),
              tag: ways('previewTag'),
            };

  const memories: Way =
    stage === 'remember'
      ? {
          section: 'memories',
          href: `/trips/${trip.id}/memories`,
          title: t(hasStory ? 'openMemories' : 'addMemories'),
          // The chapter above is already about the memories themselves.
          body: null,
          tag: null,
        }
      : {
          section: 'memories',
          href: `/trips/${trip.id}/memories`,
          title: ways(stage === 'live' ? 'memories.liveTitle' : 'memories.title'),
          body: ways(stage === 'live' ? 'memories.liveBody' : 'memories.body'),
          tag: trip.memoryCount ? t('moments', { count: trip.memoryCount }) : null,
        };

  const bySection = { itinerary, mode, memories };
  // An archived trip is read, not travelled, so Trip Mode is left out.
  const sections = ORDER.filter((section) => !archived || section !== 'mode');

  return (
    <nav aria-labelledby="trip-ways-heading" className={className} data-slot="trip-hub-ways">
      <h2
        className="text-[0.6875rem] font-semibold tracking-[0.12em] text-muted-foreground uppercase"
        id="trip-ways-heading"
      >
        {ways('title')}
      </h2>
      <ul
        className={cn(
          'mt-3 grid gap-2.5 lg:gap-3',
          sections.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2',
        )}
      >
        {sections.map((section) => {
          const way = bySection[section];
          const kicker = t(kickerKey[section]);
          return (
            <li
              className={cn('flex min-w-0', section === lead && 'order-first lg:order-none')}
              key={section}
            >
              {section === lead ? (
                <LeadWay kicker={kicker} way={way} />
              ) : (
                <RowWay kicker={kicker} way={way} />
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function kickerTone(section: TripCoreExperience) {
  return section === 'memories' ? 'text-accent-strong' : 'text-brand';
}

function LeadWay({ kicker, way }: Readonly<{ kicker: string; way: Way }>) {
  // The planner is a step further into the trip; the other two open experiences of their own.
  const Arrow = way.section === 'itinerary' ? ArrowRight : ArrowUpRight;
  return (
    <div
      className="flex w-full flex-col gap-3 rounded-[var(--radius-xl)] border border-border bg-card p-4 shadow-[var(--shadow-card)]"
      data-slot="trip-hub-way-lead"
    >
      <div className="flex items-center gap-3">
        <WayThumb section={way.section} />
        <p
          className={cn(
            'text-[0.6875rem] font-semibold tracking-[0.12em] uppercase',
            kickerTone(way.section),
          )}
        >
          {kicker}
        </p>
      </div>
      {way.body ? (
        <p className="text-[0.9375rem] leading-relaxed text-pretty text-muted-foreground">
          {way.body}
        </p>
      ) : null}
      <Link
        className={cn(
          buttonVariants({ size: 'lg' }),
          'mt-auto h-auto min-h-12 w-full rounded-[var(--radius-xl)] py-3 text-[0.9375rem] whitespace-normal',
        )}
        data-slot="trip-overview-primary-action"
        href={way.href}
      >
        <span className="min-w-0">{way.title}</span>
        <Arrow aria-hidden="true" className="size-4" />
      </Link>
    </div>
  );
}

function RowWay({ kicker, way }: Readonly<{ kicker: string; way: Way }>) {
  return (
    <Link
      className="group flex min-h-16 w-full min-w-0 items-center gap-3.5 rounded-[var(--radius-xl)] border border-border-subtle bg-card px-3.5 py-3 outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none lg:items-start lg:p-4"
      data-slot="trip-overview-secondary-action"
      href={way.href}
    >
      <WayThumb section={way.section} />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block text-[0.625rem] font-semibold tracking-[0.12em] uppercase',
            kickerTone(way.section),
          )}
        >
          {kicker}
        </span>
        <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[0.9375rem] leading-snug font-semibold">{way.title}</span>
          {way.tag ? (
            <span className="text-[0.625rem] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
              {way.tag}
            </span>
          ) : null}
        </span>
        {way.body ? (
          <span className="mt-0.5 block text-[0.8125rem] leading-snug text-pretty text-muted-foreground">
            {way.body}
          </span>
        ) : null}
      </span>
      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-text-subtle transition-transform duration-[var(--motion-standard)] group-hover:translate-x-0.5 motion-reduce:transition-none lg:mt-1"
      />
    </Link>
  );
}

/** A small picture of what each experience opens, so the name never explains it alone. */
function WayThumb({ section }: Readonly<{ section: TripCoreExperience }>) {
  const frame = 'relative size-12 shrink-0 overflow-hidden rounded-[var(--radius-lg)]';
  if (section === 'mode') {
    return (
      <span aria-hidden="true" className={cn(frame, 'bg-brand/12')}>
        <span className="absolute inset-x-2 top-2.5 h-2 rounded-sm bg-brand" />
        <span className="absolute inset-x-2 top-[1.375rem] h-1.5 rounded-sm bg-brand/40" />
        <span className="absolute bottom-2 left-2.5 h-3 w-7 rounded-bl-lg border-b-2 border-l-2 border-dashed border-brand" />
      </span>
    );
  }
  if (section === 'memories') {
    return (
      <span aria-hidden="true" className={cn(frame, 'grid place-items-center bg-accent/25')}>
        {['-translate-x-1.5 -rotate-9', 'translate-x-2 rotate-7'].map((pose) => (
          <span
            className={cn(
              'col-start-1 row-start-1 h-7 w-6 bg-paper-print p-[3px] pb-[6px] shadow-[var(--shadow-print)]',
              pose,
            )}
            key={pose}
          >
            <span className="block size-full bg-gradient-to-br from-accent to-brand" />
          </span>
        ))}
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={cn(frame, 'bg-foreground/[0.06]')}>
      <span className="absolute inset-x-2.5 top-3 h-1.5 rounded-full bg-foreground/25" />
      <span className="absolute top-[1.375rem] right-5 left-2.5 h-1.5 rounded-full bg-foreground/25" />
      <span className="absolute top-8 right-4 left-2.5 h-1.5 rounded-full bg-foreground/25" />
    </span>
  );
}
