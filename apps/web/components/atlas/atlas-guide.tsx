'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import {
  ATLAS_LICENCE,
  COUNTRY_TIME_ZONES,
  wikivoyageArticleUrl,
  wikivoyageHistoryUrl,
  type AtlasBlock,
  type AtlasListing,
  type AtlasMonthRating,
  type AtlasSection,
} from '@trove/types';

import { AtlasCover } from '@/components/atlas/atlas-cover';
import { HOME_SHEET_FRAME, HomeSheet } from '@/components/home/home-front-door';
import { usePreferences } from '@/components/preferences-provider';
import { useTripCreation } from '@/components/trip-creation-provider';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { ScrollShadow } from '@/components/ui/scroll-shadow';
import { Skeleton } from '@/components/ui/skeleton';
import { useAtlasIndex } from '@/hooks/use-atlas-index';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import { useHydrated } from '@/hooks/use-hydrated';
import { atlasCountry, greatMonthRuns } from '@/lib/atlas';
import { fetchAtlasGuide } from '@/lib/atlas/api';
import { CARD_LIST_SECTIONS, extractListCards, type AtlasCardItem } from '@/lib/atlas/cards';
import {
  formatAtlasTemperature,
  formatCoordinates,
  formatMonthRuns,
  monthName,
  readingMinutes,
  wetDaysInTen,
} from '@/lib/atlas/format';
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

/** Practicality chapters that stand apart as tinted field notes. */
const FIELD_NOTE_SECTIONS = new Set(['stay-safe', 'respect', 'stay-healthy']);

const englishNames = new Intl.DisplayNames(['en'], { type: 'region' });

function utcOffset(timeZone: string, locale: string) {
  const part = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'shortOffset' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? timeZone;
}

function sectionWords(section: AtlasSection) {
  const text = section.blocks
    .map((block) =>
      block.type === 'list'
        ? block.items.join(' ')
        : block.type === 'listing'
          ? `${block.listing.name} ${block.listing.content ?? ''}`
          : block.text,
    )
    .join(' ');
  return text.split(/\s+/).filter(Boolean).length;
}

function chapterNumber(index: number) {
  return String(index + 1).padStart(2, '0');
}

type BlockGroup =
  | { kind: 'listings'; items: AtlasListing[] }
  | { kind: 'cards'; items: AtlasCardItem[]; label: string }
  | { kind: 'phrases'; items: AtlasCardItem[] }
  | { kind: 'block'; block: AtlasBlock };

/**
 * Groups consecutive listing blocks into 2-column grids and turns structured
 * "Name — description" lists in highlight/food/region chapters into field-guide
 * cards (or tap-to-reveal phrase cards in Talk).
 */
function groupSectionBlocks(section: AtlasSection): BlockGroup[] {
  const groups: BlockGroup[] = [];
  const cardEligible = CARD_LIST_SECTIONS.has(section.id);
  const isTalk = section.id === 'talk';

  for (const block of section.blocks) {
    if (block.type === 'listing') {
      const previous = groups.at(-1);
      if (previous?.kind === 'listings') previous.items.push(block.listing);
      else groups.push({ kind: 'listings', items: [block.listing] });
    } else if (block.type === 'list' && (cardEligible || isTalk)) {
      const cards = extractListCards(block.items);
      if (cards) {
        groups.push(
          isTalk
            ? { kind: 'phrases', items: cards }
            : { kind: 'cards', items: cards, label: section.title },
        );
      } else {
        groups.push({ kind: 'block', block });
      }
    } else {
      groups.push({ kind: 'block', block });
    }
  }
  return groups;
}

function sectionHasCards(section: AtlasSection) {
  return groupSectionBlocks(section).some(
    (group) => group.kind === 'listings' || group.kind === 'cards' || group.kind === 'phrases',
  );
}

/**
 * One country's guide (PRD 40.3): an editorial encyclopedia spread. The cover,
 * essential facts dossier, and typical twelve-month pattern render at once from
 * the bundled index; the Wikivoyage chapters follow from the API, with the
 * opening chapter open by default, and an opened guide stays readable offline.
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
  const subject = useMemo(
    () => ({ name: englishNames.of(countryCode) ?? countryCode }),
    [countryCode],
  );
  // Asked while the country list loads, so the cover is ready with it; never
  // for a code the list has turned out not to hold.
  const images = useEditorialImages(
    country || (index.isPending && /^[A-Z]{2}$/.test(countryCode)) ? [subject] : [],
  );
  const editorial = editorialCoverImage(images.get(editorialSubjectKey(subject)), countryCode);
  const guide = useQuery({
    enabled: Boolean(country),
    queryFn: () => fetchAtlasGuide(countryCode),
    queryKey: queryKeys.atlasGuide(countryCode),
    retry: 1,
    staleTime: 24 * 60 * 60 * 1_000,
  });
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1);
  // Explicit user overrides per section id; the first chapter starts open by default.
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
          <div className="grid gap-10 lg:grid-cols-[16rem_minmax(0,1fr)]">
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
            className="h-11 rounded-full bg-white px-6 text-sm font-semibold text-neutral-900 hover:bg-white/90"
            onClick={() => openCreateTripIn([countryCode])}
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
              </dl>
            </section>

            {sections.length || country.months ? (
              <nav aria-label={g('sections')} className="hidden lg:block">
                <p className="mb-2 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                  {g('inThisGuide')}
                </p>
                <ol className="space-y-0.5 text-sm">
                  {country.months ? (
                    <li>
                      <a
                        className="flex items-baseline justify-between gap-2 rounded-[var(--radius-md)] px-2.5 py-1.5 text-foreground/85 outline-none transition-colors hover:bg-card hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
                        href="#atlas-best-time"
                      >
                        <span className="truncate">
                          <span className="me-2 font-mono text-xs text-muted-foreground">00</span>
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

            {country.months ? (
              <section
                aria-labelledby="atlas-best-time"
                className="scroll-mt-24 rounded-[var(--radius-xl)] border border-border-subtle bg-card p-5 sm:p-6"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-subtle pb-4">
                  <div>
                    <p className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
                      00 · {g('climatePattern')}
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
                {sections.length ? (
                  <ScrollShadow
                    aria-label={g('sections')}
                    className="interaction-scrollbar sticky top-[calc(var(--safe-top)+0.5rem)] z-10 -mx-[var(--gutter-inline-start)] flex gap-2 bg-background/95 px-[var(--gutter-inline-start)] py-2 backdrop-blur md:top-[calc(var(--header-height)+0.5rem)] lg:hidden"
                    orientation="horizontal"
                    render={<nav />}
                  >
                    {sections.map((section, idx) => (
                      <button
                        className="min-h-10 shrink-0 rounded-full border border-border bg-card px-3.5 text-sm font-medium outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40"
                        key={section.id}
                        onClick={() => openSection(section.id)}
                        type="button"
                      >
                        <span className="me-1.5 font-mono text-xs text-muted-foreground">
                          {chapterNumber(idx)}
                        </span>
                        {section.title}
                      </button>
                    ))}
                  </ScrollShadow>
                ) : null}

                <div className="space-y-8">
                  {sections.map((section, idx) => {
                    const isFieldNote = FIELD_NOTE_SECTIONS.has(section.id);
                    const groups = groupSectionBlocks(section);
                    return (
                      <article
                        className={cn(
                          'scroll-mt-24 pt-6',
                          idx === 0
                            ? 'border-t-2 border-foreground/75'
                            : 'border-t border-border-subtle',
                        )}
                        id={`atlas-section-${section.id}`}
                        key={section.id}
                      >
                        <Collapsible
                          onOpenChange={(open) => setSectionOpen(section.id, open)}
                          open={isSectionOpen(section.id)}
                        >
                          <CollapsibleTrigger className="group flex w-full items-center justify-between gap-4 text-left text-foreground hover:text-foreground">
                            <span className="flex flex-col gap-0.5">
                              <span className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
                                {g('chapterMeta', {
                                  number: chapterNumber(idx),
                                  readingTime: g('readingTime', {
                                    minutes: readingMinutes(sectionWords(section)),
                                  }),
                                })}
                              </span>
                              <span className="font-journal text-[2rem] leading-tight font-normal sm:text-[2.25rem]">
                                {section.title}
                              </span>
                            </span>
                            <ChevronDown
                              aria-hidden="true"
                              className="size-5 shrink-0 text-muted-foreground transition-transform duration-[var(--motion-standard)] group-data-[panel-open]:rotate-180 motion-reduce:transition-none"
                            />
                          </CollapsibleTrigger>
                          <CollapsiblePanel>
                            <div
                              className={cn(
                                'mt-5 flex flex-col gap-4',
                                isFieldNote &&
                                  'rounded-[var(--radius-xl)] border border-border-subtle border-s-2 border-s-accent-strong bg-card p-5',
                              )}
                            >
                              {groups.map((group, groupIndex) =>
                                group.kind === 'listings' ? (
                                  <div
                                    className="grid gap-3 sm:grid-cols-2"
                                    key={`listings-${groupIndex}`}
                                  >
                                    {group.items.map((listing, listingIndex) => (
                                      <ListingCard key={listingIndex} listing={listing} />
                                    ))}
                                  </div>
                                ) : group.kind === 'cards' ? (
                                  <div
                                    className="grid gap-3 sm:grid-cols-2"
                                    key={`cards-${groupIndex}`}
                                  >
                                    {group.items.map((item, itemIndex) => (
                                      <EntryCard item={item} key={itemIndex} label={group.label} />
                                    ))}
                                  </div>
                                ) : group.kind === 'phrases' ? (
                                  <div
                                    className="grid gap-3 sm:grid-cols-2"
                                    key={`phrases-${groupIndex}`}
                                  >
                                    {group.items.map((item, itemIndex) => (
                                      <PhraseCard item={item} key={itemIndex} />
                                    ))}
                                  </div>
                                ) : (
                                  <GuideBlock block={group.block} key={`block-${groupIndex}`} />
                                ),
                              )}
                            </div>
                          </CollapsiblePanel>
                        </Collapsible>
                      </article>
                    );
                  })}
                </div>

                <footer className="border-t border-border-subtle pt-5 text-sm leading-relaxed text-muted-foreground">
                  <p>
                    {g.rich('credit', {
                      article: (chunks) => (
                        <a className="underline" href={wikivoyageArticleUrl(guide.data.title)}>
                          {chunks}
                        </a>
                      ),
                      authors: (chunks) => (
                        <a className="underline" href={wikivoyageHistoryUrl(guide.data.title)}>
                          {chunks}
                        </a>
                      ),
                      licence: (chunks) => (
                        <a className="underline" href={ATLAS_LICENCE.url}>
                          {chunks}
                        </a>
                      ),
                      licenceName: ATLAS_LICENCE.name,
                      title: guide.data.title,
                    })}
                  </p>
                  {index.data?.climateYears ? (
                    <p className="mt-1">{g('climateCredit', index.data.climateYears)}</p>
                  ) : null}
                </footer>
              </>
            ) : null}
          </div>
        </div>
      </HomeSheet>
    </div>
  );
}

function ListingCard({ listing }: Readonly<{ listing: AtlasListing }>) {
  const g = useTranslations('atlas.guide');
  return (
    <article className="flex flex-col justify-between rounded-[var(--radius-xl)] border border-border-subtle bg-card p-4">
      <div>
        <span className="inline-flex rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">
          {g(`listing.${listing.kind}`)}
        </span>
        <h4 className="mt-2 font-journal text-[1.375rem] leading-snug font-normal text-foreground">
          {listing.name}
        </h4>
        {listing.alt ? <p className="mt-0.5 text-sm text-muted-foreground">{listing.alt}</p> : null}
        {listing.content ? (
          <p className="mt-2 text-sm leading-relaxed text-foreground/85">{listing.content}</p>
        ) : null}
      </div>
      {listing.address ? (
        <p className="mt-3 border-t border-border-subtle pt-2.5 text-xs text-muted-foreground">
          {listing.address}
        </p>
      ) : null}
    </article>
  );
}

/** A structured Wikivoyage region, city, sight, or dish entry rendered as a field-guide card. */
function EntryCard({ item, label }: Readonly<{ item: AtlasCardItem; label: string }>) {
  return (
    <article className="flex flex-col rounded-[var(--radius-xl)] border border-border-subtle bg-card p-4">
      <span className="self-start rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">
        {label}
      </span>
      <h4 className="mt-2 font-journal text-[1.375rem] leading-snug font-normal text-foreground">
        {item.title}
      </h4>
      {item.detail ? (
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{item.detail}</p>
      ) : null}
    </article>
  );
}

/** A Talk phrasebook entry that reveals the translation/pronunciation on tap (PRD 40.3). */
function PhraseCard({ item }: Readonly<{ item: AtlasCardItem }>) {
  const g = useTranslations('atlas.guide');
  const [revealed, setRevealed] = useState(false);

  return (
    <button
      aria-expanded={revealed}
      className="flex flex-col rounded-[var(--radius-xl)] border border-border-subtle bg-card p-4 text-left outline-none transition-colors hover:border-border-strong focus-visible:ring-3 focus-visible:ring-ring/40"
      onClick={() => setRevealed((open) => !open)}
      type="button"
    >
      <span className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
        {revealed ? g('tapToHide') : g('tapToReveal')}
      </span>
      <span className="mt-1.5 font-journal text-[1.375rem] leading-snug font-normal text-foreground">
        {item.title}
      </span>
      {revealed && item.detail ? (
        <span className="mt-2.5 border-t border-border-subtle pt-2.5 text-sm font-medium leading-relaxed text-brand">
          {item.detail}
        </span>
      ) : null}
    </button>
  );
}

function GuideBlock({ block }: Readonly<{ block: AtlasBlock }>) {
  switch (block.type) {
    case 'heading':
      return (
        <h3 className="pt-2 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          {block.text}
        </h3>
      );
    case 'paragraph':
      return <p className="text-base leading-[1.7] text-foreground/90">{block.text}</p>;
    case 'list':
      return (
        <ul className="flex list-disc flex-col gap-1.5 ps-5 text-base leading-[1.65] text-foreground/90 marker:text-muted-foreground">
          {block.items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      );
    case 'listing':
      return <ListingCard listing={block.listing} />;
  }
}

/** The opening sentence set large in the journal serif; the rest with an editorial drop cap. */
function GuideLead({ paragraphs }: Readonly<{ paragraphs: string[] }>) {
  const [first = '', ...rest] = paragraphs.slice(0, 3);
  const end = first.search(/[.!?](\s|$)/);
  const opening = end > 0 ? first.slice(0, end + 1) : first;
  const remainder = [first.slice(opening.length).trim(), ...rest].filter(Boolean);
  return (
    <div className="flex flex-col gap-4">
      <p className="font-journal text-[1.625rem] leading-snug text-foreground italic sm:text-[1.875rem]">
        {opening}
      </p>
      {remainder.map((paragraph, index) => (
        <p
          className={cn(
            'text-base leading-[1.75] text-muted-foreground',
            index === 0 &&
              'first-letter:float-left first-letter:me-2 first-letter:pt-1 first-letter:font-journal first-letter:text-[3rem] first-letter:leading-[0.82] first-letter:text-foreground',
          )}
          key={index}
        >
          {paragraph}
        </p>
      ))}
    </div>
  );
}
