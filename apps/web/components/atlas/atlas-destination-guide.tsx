'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { AtlasCover } from '@/components/atlas/atlas-cover';
import {
  chapterNumber,
  GuideChapters,
  GuideCreditFooter,
  GuideLead,
  sectionHasCards,
  sectionWords,
} from '@/components/atlas/atlas-guide-sections';
import { HOME_SHEET_FRAME, HomeSheet } from '@/components/home/home-front-door';
import { useTripCreation } from '@/components/trip-creation-provider';
import { useAtlasTripPicks } from '@/hooks/use-atlas-trip-picks';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { useAtlasIndex } from '@/hooks/use-atlas-index';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import { useHydrated } from '@/hooks/use-hydrated';
import { atlasCountry } from '@/lib/atlas';
import { fetchAtlasDestinationGuide } from '@/lib/atlas/api';
import { readingMinutes } from '@/lib/atlas/format';
import { suggestAtlasTripDates } from '@/lib/atlas/picks';
import { editorialCoverImage, editorialSubjectKey } from '@/lib/media/editorial-images';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import { useEntrance, type EntranceClock } from '@/lib/page-entrance';
import { queryKeys } from '@/lib/query/keys';

const destinationEntrance: EntranceClock = { startedAt: null };
const englishNames = new Intl.DisplayNames(['en'], { type: 'region' });

/**
 * One destination's deep-dive guide inside a country (e.g. /atlas/PH/bohol):
 * full Wikivoyage See, Do, Eat, Drink, and Sleep listings in the same editorial
 * encyclopedia spread as the country gateway.
 */
export function AtlasDestinationGuideView({
  countryCode,
  slug,
}: Readonly<{ countryCode: string; slug: string }>) {
  const g = useTranslations('atlas.guide');
  const locale = useLocale();
  const { openCreateTripIn } = useTripCreation();
  const { picks, removePick } = useAtlasTripPicks();
  const hydrated = useHydrated();
  const index = useAtlasIndex();
  const country = useMemo(
    () => (index.data ? atlasCountry(index.data.countries, countryCode, locale) : null),
    [countryCode, index.data, locale],
  );
  const query = useQuery({
    enabled: Boolean(country),
    queryFn: () => fetchAtlasDestinationGuide(countryCode, slug),
    queryKey: queryKeys.atlasDestinationGuide(countryCode, slug),
    retry: 1,
    staleTime: 24 * 60 * 60 * 1_000,
  });

  const destinationName = query.data?.destination.name ?? query.data?.guide.title ?? '';
  const englishCountry = englishNames.of(countryCode) ?? countryCode;
  const subject = useMemo(
    () =>
      destinationName
        ? { name: `${destinationName}, ${englishCountry}` }
        : { name: englishCountry },
    [destinationName, englishCountry],
  );
  const images = useEditorialImages(country ? [subject] : []);
  const editorial = editorialCoverImage(
    images.get(editorialSubjectKey(subject)),
    `${countryCode}-${slug}`,
  );
  const [sectionState, setSectionState] = useState<Record<string, boolean>>({});
  const entrance = useEntrance(destinationEntrance, {
    ready: Boolean(query.data),
    replay: true,
  });

  const countryLabel = hydrated && country ? country.name : g('back');

  if ((!country && index.isPending) || (country && query.isPending)) {
    return (
      <div aria-busy="true" className="mx-auto w-full max-w-5xl pb-16">
        <AtlasCover
          back={{ href: `/atlas/${countryCode}`, label: countryLabel }}
          enter={false}
          kicker={'\u00a0'}
          media={editorial ? resolveTripMediaSource({ editorial }) : null}
          title={'\u00a0'}
        />
        <div className={HOME_SHEET_FRAME}>
          <div className="grid gap-10 lg:grid-cols-[15.5rem_minmax(0,1fr)]">
            <Skeleton className="h-44 rounded-[var(--radius-xl)]" />
            <div className="flex flex-col gap-4">
              <Skeleton className="h-24" />
              <Skeleton className="h-56 rounded-[var(--radius-xl)]" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!country) {
    return (
      <Empty className="mx-auto mt-24 max-w-md">
        <EmptyHeader>
          <EmptyTitle>{g('notFound')}</EmptyTitle>
        </EmptyHeader>
        <Link className="font-semibold" href="/atlas">
          {g('backToAtlas')}
        </Link>
      </Empty>
    );
  }

  if (query.isError || !query.data) {
    const isNotFound = (query.error as { status?: number })?.status === 404;
    return (
      <Empty className="mx-auto mt-24 max-w-md">
        <EmptyHeader>
          <EmptyTitle>{isNotFound ? g('destinationNotFound') : g('error')}</EmptyTitle>
          {!isNotFound ? <EmptyDescription>{g('errorDescription')}</EmptyDescription> : null}
        </EmptyHeader>
        {isNotFound ? (
          <Link className="font-semibold" href={`/atlas/${countryCode}`}>
            {g('backToCountry', { country: countryLabel })}
          </Link>
        ) : (
          <Button onClick={() => void query.refetch()} type="button" variant="outline">
            {g('tryAgain')}
          </Button>
        )}
      </Empty>
    );
  }

  const { destination, guide } = query.data;
  const sections = guide.sections;
  const firstSectionId = sections[0]?.id ?? null;
  const firstCardSectionId = sections.find((section) => sectionHasCards(section))?.id ?? null;
  const isSectionOpen = (id: string) =>
    sectionState[id] ?? (id === firstSectionId || id === firstCardSectionId);
  const setSectionOpen = (id: string, open: boolean) =>
    setSectionState((current) => ({ ...current, [id]: open }));
  const openSection = (id: string) => {
    setSectionOpen(id, true);
    requestAnimationFrame(() =>
      document.getElementById(`atlas-section-${id}`)?.scrollIntoView({ block: 'start' }),
    );
  };

  return (
    <div className="mx-auto w-full max-w-5xl pb-16" style={entrance.style}>
      <AtlasCover
        back={{ href: `/atlas/${countryCode}`, label: countryLabel }}
        description={destination.summary ?? undefined}
        enter={entrance.enter}
        folio={`${countryCode} · ${destination.name}`}
        kicker={g('destinationKicker', { country: countryLabel })}
        media={editorial ? resolveTripMediaSource({ editorial }) : null}
        title={destination.name}
      >
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button
            className="h-11 bg-white px-6 text-sm font-semibold text-neutral-900 hover:bg-white/90"
            onClick={() => {
              // This guide's picks come along as places (PRD 40.4); none, and the
              // trip starts from the destination alone.
              const guidePicks = picks.filter(
                (pick) => pick.countryCode === countryCode && pick.destinationSlug === slug,
              );
              const dates = suggestAtlasTripDates(country.months, guidePicks.length || 9);
              openCreateTripIn({
                atlasPicks: guidePicks,
                countries: [countryCode],
                description: `Based on Wikivoyage's ${guide.title} guide (CC BY-SA 4.0).`,
                destinations: [{ name: destination.name }],
                endDate: dates.endDate,
                name: `${destination.name}, ${countryLabel}`,
                onCreated: () => guidePicks.forEach((pick) => removePick(pick.id)),
                startDate: dates.startDate,
              });
            }}
            type="button"
          >
            {g('planTripTo', { place: destination.name })}
          </Button>
        </div>
      </AtlasCover>

      <HomeSheet>
        <div className="grid gap-10 lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:items-start lg:gap-12">
          <aside className="space-y-6 lg:sticky lg:top-[calc(var(--header-height)+1.5rem)]">
            {sections.length ? (
              <nav aria-label={g('sections')} className="hidden lg:block">
                <p className="mb-2 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                  {g('inThisGuide')}
                </p>
                <ol className="space-y-0.5 text-sm">
                  {sections.map((section, idx) => (
                    <li key={section.id}>
                      <button
                        className="flex w-full items-baseline justify-between gap-2 rounded-[var(--radius-md)] px-2.5 py-1.5 text-left text-foreground/85 outline-none transition-colors hover:bg-card hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
                        onClick={() => openSection(section.id)}
                        type="button"
                      >
                        <span className="truncate">
                          <span className="me-2 font-mono text-xs text-muted-foreground">
                            {chapterNumber(idx)}
                          </span>
                          {section.title}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {readingMinutes(sectionWords(section))}m
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </nav>
            ) : null}

            <Link
              className="hidden rounded-[var(--radius-lg)] border border-border-subtle bg-card px-3.5 py-2.5 text-xs font-medium text-foreground/85 outline-none transition-colors hover:border-border-strong hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 lg:block"
              href={`/atlas/${countryCode}`}
            >
              ← {g('backToCountry', { country: countryLabel })}
            </Link>
          </aside>

          <div className="min-w-0 max-w-3xl space-y-10">
            {guide.lead.length ? <GuideLead paragraphs={guide.lead} /> : null}

            <GuideChapters
              isSectionOpen={isSectionOpen}
              onOpenSection={openSection}
              onToggleSection={setSectionOpen}
              pickContext={{
                countryCode,
                countryName: countryLabel,
                destinationName: destination.name,
                destinationSlug: destination.slug,
                guideTitle: guide.title,
              }}
              sections={sections}
            />

            <GuideCreditFooter title={guide.title} />
          </div>
        </div>
      </HomeSheet>
    </div>
  );
}
