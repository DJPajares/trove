'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import {
  COUNTRY_TIME_ZONES,
  type AtlasLinkedDestination,
  type AtlasMonthRating,
} from '@trove/types';

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
import { MediaFrame } from '@/components/media-frame';
import { usePreferences } from '@/components/preferences-provider';
import { useTripCreation } from '@/components/trip-creation-provider';
import { Button } from '@/components/ui/button';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { ScrollShadow } from '@/components/ui/scroll-shadow';
import { Skeleton } from '@/components/ui/skeleton';
import { useAtlasIndex } from '@/hooks/use-atlas-index';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import { useHydrated } from '@/hooks/use-hydrated';
import { atlasCountry, greatMonthRuns } from '@/lib/atlas';
import { fetchAtlasGuide } from '@/lib/atlas/api';
import {
  formatAtlasTemperature,
  formatCoordinates,
  formatMonthRuns,
  monthName,
  readingMinutes,
  wetDaysInTen,
} from '@/lib/atlas/format';
import { suggestAtlasTripDates } from '@/lib/atlas/picks';
import { currencyForCountry } from '@/lib/currency/country-currency';
import { currencyPairHref } from '@/lib/currency/recent-pairs';
import { editorialCoverImage, editorialSubjectKey } from '@/lib/media/editorial-images';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import { useEntrance, type EntranceClock } from '@/lib/page-entrance';
import { queryKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils';

/** Country guide's entrance, kept for the tab's life and replayed on each visit. */
const guideEntrance: EntranceClock = { startedAt: null };

/** Bars rise with the rating, and differ in lightness as well as hue. */
const RATING_BAR: Record<AtlasMonthRating, string> = {
  good: 'h-9 bg-[oklch(0.72_0.06_112)]',
  great: 'h-12 bg-[oklch(0.455_0.07_115)]',
  mixed: 'h-6 bg-[oklch(0.83_0.05_55)]',
  off: 'h-3.5 bg-[oklch(0.88_0.015_78)]',
};

const RATING_PILL: Record<AtlasMonthRating, string> = {
  good: 'bg-[oklch(0.72_0.06_112)]/25 text-foreground',
  great: 'bg-[oklch(0.455_0.07_115)] text-primary-foreground',
  mixed: 'bg-[oklch(0.83_0.05_55)]/35 text-foreground',
  off: 'bg-muted text-muted-foreground',
};

const MAX_EXPLORE_CARDS = 12;
const englishNames = new Intl.DisplayNames(['en'], { type: 'region' });

function utcOffset(timeZone: string, locale: string) {
  const part = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'shortOffset' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? timeZone;
}

/**
 * One country's guide (PRD 40.3): a curated Option A editorial gateway spread.
 * The cover, essential facts dossier, and typical twelve-month pattern render at
 * once from the bundled index; Places to Explore and the curated country chapters
 * follow from the API and stay readable offline.
 */
export function AtlasGuideView({ countryCode }: Readonly<{ countryCode: string }>) {
  const t = useTranslations('atlas');
  const g = useTranslations('atlas.guide');
  const locale = useLocale();
  const { preferences, preferredCurrency } = usePreferences();
  const { openCreateTripIn } = useTripCreation();
  const hydrated = useHydrated();
  const index = useAtlasIndex();
  const country = useMemo(
    () => (index.data ? atlasCountry(index.data.countries, countryCode, locale) : null),
    [countryCode, index.data, locale],
  );
  const englishCountry = englishNames.of(countryCode) ?? countryCode;
  const subject = useMemo(() => ({ name: englishCountry }), [englishCountry]);
  const guide = useQuery({
    enabled: Boolean(country),
    queryFn: () => fetchAtlasGuide(countryCode),
    queryKey: queryKeys.atlasGuide(countryCode),
    retry: 1,
    staleTime: 24 * 60 * 60 * 1_000,
  });

  // Iconic destinations first, then cities; regions stay in the Regions chapter.
  const exploreDestinations = useMemo(() => {
    const all = guide.data?.destinations ?? [];
    const highlights = all.filter((d) => d.kind === 'destination');
    const cities = all.filter((d) => d.kind === 'city');
    return [...highlights, ...cities].slice(0, MAX_EXPLORE_CARDS);
  }, [guide.data?.destinations]);

  // One editorial-image request for the cover + visible Places to Explore cards.
  const imageSubjects = useMemo(() => {
    if (!country && !(index.isPending && /^[A-Z]{2}$/.test(countryCode))) return [];
    return [
      subject,
      ...exploreDestinations.map((dest) => ({ name: `${dest.name}, ${englishCountry}` })),
    ];
  }, [country, countryCode, englishCountry, exploreDestinations, index.isPending, subject]);
  const images = useEditorialImages(imageSubjects);
  const editorial = editorialCoverImage(images.get(editorialSubjectKey(subject)), countryCode);

  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1);
  const [placeFilter, setPlaceFilter] = useState<'all' | 'destination' | 'city'>('all');
  // Explicit user overrides per section id; the first chapter & first card chapter start open.
  const [sectionState, setSectionState] = useState<Record<string, boolean>>({});
  const entrance = useEntrance(guideEntrance, { ready: Boolean(country), replay: true });

  if (!country && index.isPending) {
    return (
      <div aria-busy="true" className="mx-auto w-full max-w-5xl pb-16">
        <AtlasCover
          back={{ href: '/atlas', label: g('back') }}
          enter={false}
          kicker={'\u00a0'}
          media={editorial ? resolveTripMediaSource({ editorial }) : null}
          title={'\u00a0'}
        />
        <div className={HOME_SHEET_FRAME}>
          <div className="grid gap-10 lg:grid-cols-[15.5rem_minmax(0,1fr)]">
            <Skeleton className="h-48 rounded-[var(--radius-xl)]" />
            <div className="flex flex-col gap-4">
              <Skeleton className="h-24" />
              <Skeleton className="h-56 rounded-[var(--radius-xl)]" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!country && index.isError) {
    return (
      <Empty className="mx-auto mt-24 max-w-md">
        <EmptyHeader>
          <EmptyTitle>{g('error')}</EmptyTitle>
          <EmptyDescription>{g('errorDescription')}</EmptyDescription>
        </EmptyHeader>
        <Button onClick={() => void index.refetch()} type="button" variant="outline">
          {g('tryAgain')}
        </Button>
      </Empty>
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

  const currency = currencyForCountry(countryCode);
  const currencyName = currency
    ? (new Intl.DisplayNames([locale], { type: 'currency' }).of(currency) ?? currency)
    : null;
  const timeZone = COUNTRY_TIME_ZONES[countryCode];
  const temperature = (celsius: number) =>
    formatAtlasTemperature(celsius, preferences.temperatureUnit);
  const selected = country.months?.find((m) => m.month === selectedMonth) ?? null;
  const greatRuns = greatMonthRuns(country);
  const bestStretchSummary = !country.months
    ? null
    : greatRuns[0]?.length === 12
      ? t('greatAllYear')
      : greatRuns.length
        ? formatMonthRuns(greatRuns, locale)
        : t('noGreatMonths');
  const sections = guide.data?.sections ?? [];
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

  const hasBothKinds =
    exploreDestinations.some((d) => d.kind === 'destination') &&
    exploreDestinations.some((d) => d.kind === 'city');
  const visibleDestinations =
    placeFilter === 'all'
      ? exploreDestinations
      : exploreDestinations.filter((d) => d.kind === placeFilter);

  const photoForDestination = (dest: AtlasLinkedDestination) =>
    editorialCoverImage(
      images.get(editorialSubjectKey({ name: `${dest.name}, ${englishCountry}` })),
      `${countryCode}-${dest.slug}`,
    );

  return (
    <div className="mx-auto w-full max-w-5xl pb-16" style={entrance.style}>
      <AtlasCover
        back={{ href: '/atlas', label: g('back') }}
        enter={entrance.enter}
        folio={`${country.countryCode} · ${formatCoordinates(country.latitude, country.longitude)}`}
        kicker={g('kicker', { region: t(`regions.${country.region}`) })}
        media={editorial ? resolveTripMediaSource({ editorial }) : null}
        title={hydrated ? country.name : '\u00a0'}
      >
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button
            className="h-11 bg-white px-6 text-sm font-semibold text-neutral-900 hover:bg-white/90"
            onClick={() => {
              const dates = suggestAtlasTripDates(country.months, 12);
              openCreateTripIn({
                countries: [countryCode],
                description: guide.data
                  ? `Based on Wikivoyage's ${guide.data.title} guide (CC BY-SA 4.0).`
                  : undefined,
                endDate: dates.endDate,
                name: country.name,
                startDate: dates.startDate,
              });
            }}
            type="button"
          >
            {g('planTrip')}
          </Button>
          {bestStretchSummary && greatRuns.length > 0 ? (
            <a
              className="inline-flex h-11 items-center rounded-full border border-white/25 bg-black/25 px-4 text-sm font-medium text-white backdrop-blur-md outline-none transition-colors hover:bg-black/35 focus-visible:ring-3 focus-visible:ring-white/70"
              href="#atlas-best-time"
            >
              {greatRuns[0]?.length === 12
                ? t('greatAllYear')
                : t('bestMonths', { months: bestStretchSummary })}
            </a>
          ) : null}
        </div>
      </AtlasCover>

      <HomeSheet>
        <div className="grid gap-10 lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:items-start lg:gap-12">
          {/* Left Rail: Essential Facts dossier + numbered book marginalia on desktop */}
          <aside className="space-y-6 lg:sticky lg:top-[calc(var(--header-height)+1.5rem)]">
            <section
              aria-labelledby="atlas-glance"
              className="rounded-[var(--radius-xl)] border border-border-subtle bg-card p-4"
            >
              <div className="mb-2 flex items-center justify-between border-b border-border-subtle pb-2.5">
                <h2
                  className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase"
                  id="atlas-glance"
                >
                  {g('atAGlance')}
                </h2>
                <span className="font-mono text-xs text-muted-foreground">
                  {country.countryCode}
                </span>
              </div>
              <dl className="divide-y divide-border-subtle text-sm">
                {currency ? (
                  <div className="flex items-baseline justify-between gap-3 py-2.5">
                    <dt className="shrink-0 text-muted-foreground">{g('currency')}</dt>
                    <dd className="text-right font-medium">
                      {currencyName}
                      {preferredCurrency && preferredCurrency !== currency ? (
                        <>
                          {' '}
                          <Link
                            className="font-semibold text-brand hover:underline"
                            href={currencyPairHref({ source: preferredCurrency, target: currency })}
                          >
                            · {g('convert')}
                          </Link>
                        </>
                      ) : null}
                    </dd>
                  </div>
                ) : null}
                {timeZone ? (
                  <div className="flex items-baseline justify-between gap-3 py-2.5">
                    <dt className="shrink-0 text-muted-foreground">{g('timeZone')}</dt>
                    <dd className="text-right font-medium tabular-nums">
                      {utcOffset(timeZone, locale)}
                    </dd>
                  </div>
                ) : null}
                <div className="flex items-baseline justify-between gap-3 py-2.5">
                  <dt className="shrink-0 text-muted-foreground">{g('measuredIn')}</dt>
                  <dd className="text-right font-medium">{country.climateCity}</dd>
                </div>
                {bestStretchSummary ? (
                  <div className="flex items-baseline justify-between gap-3 py-2.5">
                    <dt className="shrink-0 text-muted-foreground">{g('bestStretch')}</dt>
                    <dd className="text-right font-medium">{bestStretchSummary}</dd>
                  </div>
                ) : null}
                {country.quickFacts?.languages.length ? (
                  <div className="flex items-baseline justify-between gap-3 py-2.5">
                    <dt className="shrink-0 text-muted-foreground">{g('languages')}</dt>
                    <dd className="text-right font-medium">
                      {new Intl.ListFormat(locale, { style: 'short', type: 'unit' }).format(
                        country.quickFacts.languages,
                      )}
                    </dd>
                  </div>
                ) : null}
                {country.quickFacts?.plugTypes.length ? (
                  <div className="flex items-baseline justify-between gap-3 py-2.5">
                    <dt className="shrink-0 text-muted-foreground">{g('plugTypes')}</dt>
                    <dd className="text-right font-medium">
                      {country.quickFacts.plugTypes.join(', ')}
                    </dd>
                  </div>
                ) : null}
                {country.quickFacts?.drivingSide ? (
                  <div className="flex items-baseline justify-between gap-3 py-2.5">
                    <dt className="shrink-0 text-muted-foreground">{g('drivingSide')}</dt>
                    <dd className="text-right font-medium">
                      {country.quickFacts.drivingSide === 'left'
                        ? g('drivingSideLeft')
                        : g('drivingSideRight')}
                    </dd>
                  </div>
                ) : null}
                {country.quickFacts?.nationalDish ? (
                  <div className="flex items-baseline justify-between gap-3 py-2.5">
                    <dt className="shrink-0 text-muted-foreground">{g('nationalDish')}</dt>
                    <dd className="text-right font-medium">{country.quickFacts.nationalDish}</dd>
                  </div>
                ) : null}
              </dl>
            </section>

            {sections.length || country.months || exploreDestinations.length ? (
              <nav aria-label={g('sections')} className="hidden lg:block">
                <p className="mb-2 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                  {g('inThisGuide')}
                </p>
                <ol className="space-y-0.5 text-sm">
                  {exploreDestinations.length ? (
                    <li>
                      <a
                        className="flex items-baseline justify-between gap-2 rounded-[var(--radius-md)] px-2.5 py-1.5 text-foreground/85 outline-none transition-colors hover:bg-card hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
                        href="#atlas-places"
                      >
                        <span className="truncate">
                          <span className="me-2 font-mono text-xs text-muted-foreground">00</span>
                          {g('placesToExplore')}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {exploreDestinations.length}
                        </span>
                      </a>
                    </li>
                  ) : null}
                  {country.months ? (
                    <li>
                      <a
                        className="flex items-baseline justify-between gap-2 rounded-[var(--radius-md)] px-2.5 py-1.5 text-foreground/85 outline-none transition-colors hover:bg-card hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
                        href="#atlas-best-time"
                      >
                        <span className="truncate">
                          <span className="me-2 font-mono text-xs text-muted-foreground">
                            {exploreDestinations.length ? '·' : '00'}
                          </span>
                          {g('bestTime')}
                        </span>
                      </a>
                    </li>
                  ) : null}
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
          </aside>

          {/* Right Column: Editorial Reading Spread */}
          <div className="min-w-0 max-w-3xl space-y-10">
            {guide.data?.lead.length ? <GuideLead paragraphs={guide.data.lead} /> : null}

            {/* 00: Places to Explore — photographic destination sub-guides */}
            {exploreDestinations.length ? (
              <section aria-labelledby="atlas-places" className="scroll-mt-24 space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
                      00 · {g('destinationGuides')}
                    </p>
                    <h2
                      className="mt-0.5 font-journal text-[2rem] leading-tight font-normal sm:text-[2.25rem]"
                      id="atlas-places"
                    >
                      {g('placesToExplore')}
                    </h2>
                  </div>
                  {hasBothKinds ? (
                    <ChipGroup
                      aria-label={g('placesToExplore')}
                      onValueChange={(value) =>
                        setPlaceFilter((value[0] as 'all' | 'destination' | 'city') ?? 'all')
                      }
                      value={[placeFilter]}
                    >
                      <Chip className="min-h-8 px-3 text-xs" value="all">
                        {g('placesAll')}
                      </Chip>
                      <Chip className="min-h-8 px-3 text-xs" value="destination">
                        {g('placesIconic')}
                      </Chip>
                      <Chip className="min-h-8 px-3 text-xs" value="city">
                        {g('placesCities')}
                      </Chip>
                    </ChipGroup>
                  ) : null}
                </div>

                <ScrollShadow
                  className="interaction-scrollbar -mx-[var(--gutter-inline-start)] flex snap-x scroll-px-[var(--gutter-inline-start)] gap-3 px-[var(--gutter-inline-start)] pb-2"
                  orientation="horizontal"
                  render={<ul />}
                >
                  {visibleDestinations.map((dest) => (
                    <li className="w-60 shrink-0 snap-start" key={dest.slug}>
                      <Link
                        className="group flex h-full flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border-subtle bg-card outline-none transition-colors hover:border-border-strong focus-visible:ring-3 focus-visible:ring-ring/40"
                        href={`/atlas/${countryCode}/${dest.slug}`}
                      >
                        <div className="relative aspect-[16/10] w-full overflow-hidden bg-surface-media">
                          <MediaFrame
                            alt=""
                            className="h-full w-full rounded-none"
                            dataSlot="atlas-destination-media"
                            sizes="15rem"
                            source={resolveTripMediaSource({
                              editorial: photoForDestination(dest),
                            })}
                            variant="card"
                          />
                          <span className="absolute start-2.5 top-2.5 rounded-full bg-black/45 px-2.5 py-0.5 text-[0.6875rem] font-semibold text-white backdrop-blur-sm">
                            {dest.kind === 'city' ? g('kindCity') : g('kindDestination')}
                          </span>
                        </div>
                        <span className="flex flex-1 flex-col gap-1 px-3.5 pt-3 pb-3.5">
                          <span className="font-journal text-[1.375rem] leading-tight text-foreground transition-colors group-hover:text-brand">
                            {dest.name}
                          </span>
                          {dest.summary ? (
                            <span className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                              {dest.summary}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ScrollShadow>
              </section>
            ) : null}

            {country.months ? (
              <section
                aria-labelledby="atlas-best-time"
                className="scroll-mt-24 rounded-[var(--radius-xl)] border border-border-subtle bg-card p-5 sm:p-6"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-subtle pb-4">
                  <div>
                    <p className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
                      {g('climatePattern')}
                    </p>
                    <h2
                      className="mt-0.5 font-journal text-3xl leading-none font-normal"
                      id="atlas-best-time"
                    >
                      {g('bestTime')}
                    </h2>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {g('bestTimeIn', { city: country.climateCity })}
                  </span>
                </div>

                <div
                  aria-label={g('months')}
                  className="mt-5 grid grid-cols-6 gap-1.5 sm:grid-cols-12"
                  role="group"
                >
                  {country.months.map((entry) => {
                    const active = entry.month === selectedMonth;
                    return (
                      <button
                        aria-label={g('monthLabel', {
                          month: monthName(entry.month, locale),
                          rating: t(`rating.${entry.rating}`),
                        })}
                        aria-pressed={active}
                        className={cn(
                          'group flex min-h-11 flex-col items-center justify-end gap-1 rounded-[var(--radius-md)] p-1 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40',
                          active
                            ? 'bg-background ring-1 ring-foreground/50'
                            : 'hover:bg-background/60',
                        )}
                        key={entry.month}
                        onClick={() => setSelectedMonth(entry.month)}
                        type="button"
                      >
                        <span className="text-[0.6875rem] text-muted-foreground tabular-nums">
                          {temperature(entry.temperatureMaxC)}
                        </span>
                        <span className={cn('w-full rounded-[0.3rem]', RATING_BAR[entry.rating])} />
                        <span
                          className={cn(
                            'text-xs',
                            active ? 'font-bold text-foreground' : 'text-muted-foreground',
                          )}
                        >
                          {monthName(entry.month, locale, 'narrow')}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {(['great', 'good', 'mixed', 'off'] as const).map((rating) => (
                    <li className="inline-flex items-center gap-1.5" key={rating}>
                      <span
                        aria-hidden="true"
                        className={cn(
                          'size-2.5 rounded-[0.2rem]',
                          RATING_BAR[rating].split(' ')[1],
                        )}
                      />
                      {t(`rating.${rating}`)}
                    </li>
                  ))}
                </ul>

                {selected ? (
                  <div
                    aria-live="polite"
                    className="mt-4 rounded-[var(--radius-lg)] border border-border-subtle bg-background p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-journal text-2xl leading-none">
                        {monthName(selected.month, locale)}
                      </span>
                      <span
                        className={cn(
                          'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                          RATING_PILL[selected.rating],
                        )}
                      >
                        {t(`rating.${selected.rating}`)}
                      </span>
                    </div>
                    <p className="mt-2 text-[0.9375rem] leading-relaxed text-foreground/90">
                      {g('monthDetail', {
                        high: temperature(selected.temperatureMaxC),
                        low: temperature(selected.temperatureMinC),
                        wet: wetDaysInTen(selected.wetDayShare),
                      })}
                    </p>
                  </div>
                ) : null}
              </section>
            ) : null}

            {guide.isPending ? (
              <div aria-busy="true" aria-label={g('loading')} className="flex flex-col gap-3">
                <Skeleton className="h-5 w-11/12" />
                <Skeleton className="h-5 w-10/12" />
                <Skeleton className="h-5 w-8/12" />
              </div>
            ) : guide.isError && !guide.data ? (
              <Empty className="rounded-[var(--radius-xl)] border border-border-subtle">
                <EmptyHeader>
                  <EmptyTitle>
                    {(guide.error as { status?: number })?.status === 404
                      ? g('unavailable')
                      : g('error')}
                  </EmptyTitle>
                  <EmptyDescription>{g('errorDescription')}</EmptyDescription>
                </EmptyHeader>
                <Button onClick={() => void guide.refetch()} type="button" variant="outline">
                  {g('tryAgain')}
                </Button>
              </Empty>
            ) : guide.data ? (
              <>
                <GuideChapters
                  isSectionOpen={isSectionOpen}
                  onOpenSection={openSection}
                  onToggleSection={setSectionOpen}
                  pickContext={{
                    countryCode,
                    countryName: country.name,
                    destinationName: country.name,
                    destinationSlug: '',
                    guideTitle: guide.data.title,
                  }}
                  sections={sections}
                />

                <GuideCreditFooter
                  climateYears={index.data?.climateYears ?? null}
                  hasQuickFacts={Boolean(country.quickFacts)}
                  title={guide.data.title}
                />
              </>
            ) : null}
          </div>
        </div>
      </HomeSheet>
    </div>
  );
}
