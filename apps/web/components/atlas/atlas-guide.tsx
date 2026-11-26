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
import { Skeleton } from '@/components/ui/skeleton';
import { useAtlasIndex } from '@/hooks/use-atlas-index';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import { useHydrated } from '@/hooks/use-hydrated';
import { atlasCountry } from '@/lib/atlas';
import { fetchAtlasGuide } from '@/lib/atlas/api';
import {
  formatAtlasTemperature,
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
  good: 'h-10 bg-[oklch(0.72_0.06_112)]',
  great: 'h-14 bg-[oklch(0.455_0.07_115)]',
  mixed: 'h-7 bg-[oklch(0.83_0.05_55)]',
  off: 'h-4 bg-[oklch(0.88_0.015_78)]',
};

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

/**
 * One country's guide (PRD 40.3): the cover and the facts Trove already holds
 * render at once from the bundled index; the Wikivoyage text follows from the
 * API, and an opened guide stays readable offline on this device.
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
  const [openSections, setOpenSections] = useState<string[]>([]);
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
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-48" />
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
  const sections = guide.data?.sections ?? [];
  const openSection = (id: string) => {
    setOpenSections((current) => (current.includes(id) ? current : [...current, id]));
    requestAnimationFrame(() =>
      document.getElementById(`atlas-section-${id}`)?.scrollIntoView({ block: 'start' }),
    );
  };

  return (
    <div className="mx-auto w-full max-w-5xl pb-16" style={entrance.style}>
      <AtlasCover
        back={{ href: '/atlas', label: g('back') }}
        enter={entrance.enter}
        kicker={g('kicker', { region: t(`regions.${country.region}`) })}
        media={editorial ? resolveTripMediaSource({ editorial }) : null}
        title={hydrated ? country.name : '\u00a0'}
      >
        <Button
          className="mt-6 h-12 rounded-full px-6 text-base"
          onClick={() => openCreateTripIn([countryCode])}
          type="button"
        >
          {g('planTrip')}
        </Button>
      </AtlasCover>

      <HomeSheet>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
          <section aria-labelledby="atlas-glance">
            <h2
              className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase"
              id="atlas-glance"
            >
              {g('atAGlance')}
            </h2>
            <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {currency ? (
                <div className="rounded-[var(--radius-lg)] border border-border-subtle bg-card px-4 py-3">
                  <dt className="text-sm text-muted-foreground">{g('currency')}</dt>
                  <dd className="mt-0.5 font-semibold">
                    {currencyName}{' '}
                    {preferredCurrency && preferredCurrency !== currency ? (
                      <Link
                        className="font-medium text-brand"
                        href={currencyPairHref({ source: preferredCurrency, target: currency })}
                      >
                        · {g('convert')}
                      </Link>
                    ) : null}
                  </dd>
                </div>
              ) : null}
              {timeZone ? (
                <div className="rounded-[var(--radius-lg)] border border-border-subtle bg-card px-4 py-3">
                  <dt className="text-sm text-muted-foreground">{g('timeZone')}</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">
                    {utcOffset(timeZone, locale)}
                  </dd>
                </div>
              ) : null}
              <div className="rounded-[var(--radius-lg)] border border-border-subtle bg-card px-4 py-3">
                <dt className="text-sm text-muted-foreground">{g('measuredIn')}</dt>
                <dd className="mt-0.5 font-semibold">{country.climateCity}</dd>
              </div>
            </dl>
          </section>

          {country.months ? (
            <section
              aria-labelledby="atlas-best-time"
              className="rounded-[var(--radius-xl)] border border-border-subtle bg-card p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-journal text-3xl leading-none font-normal" id="atlas-best-time">
                  {g('bestTime')}
                </h2>
                <span className="text-sm text-muted-foreground">
                  {g('bestTimeIn', { city: country.climateCity })}
                </span>
              </div>
              <div
                aria-label={g('months')}
                className="mt-5 grid grid-cols-12 items-end gap-1"
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
                      className="group flex min-h-11 flex-col items-center justify-end gap-1.5 rounded-[var(--radius-sm)] outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                      key={entry.month}
                      onClick={() => setSelectedMonth(entry.month)}
                      type="button"
                    >
                      <span
                        className={cn(
                          'w-full rounded-[0.375rem] transition-[outline-color] duration-[var(--motion-standard)]',
                          RATING_BAR[entry.rating],
                          active
                            ? 'outline-2 outline-offset-2 outline-foreground'
                            : 'outline-transparent',
                        )}
                      />
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
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {(['great', 'good', 'mixed', 'off'] as const).map((rating) => (
                  <li className="inline-flex items-center gap-1.5" key={rating}>
                    <span
                      aria-hidden="true"
                      className={cn('size-2.5 rounded-[0.2rem]', RATING_BAR[rating].split(' ')[1])}
                    />
                    {t(`rating.${rating}`)}
                  </li>
                ))}
              </ul>
              {selected ? (
                <div aria-live="polite" className="mt-4 border-t border-border-subtle pt-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-journal text-2xl">
                      {monthName(selected.month, locale)}
                    </span>
                    <span className="text-sm font-semibold">{t(`rating.${selected.rating}`)}</span>
                  </div>
                  <p className="mt-1 text-[0.9375rem] leading-relaxed">
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
              {guide.data.lead.length ? <GuideLead paragraphs={guide.data.lead} /> : null}

              {sections.length ? (
                <nav
                  aria-label={g('sections')}
                  className="interaction-scrollbar sticky top-[calc(var(--safe-top)+0.5rem)] z-10 -mx-[var(--gutter-inline-start)] flex gap-2 overflow-x-auto bg-background/95 px-[var(--gutter-inline-start)] py-2 backdrop-blur md:top-[calc(var(--header-height)+0.5rem)]"
                >
                  {sections.map((section) => (
                    <button
                      className="min-h-10 shrink-0 rounded-full border border-border bg-card px-4 text-sm font-medium outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40"
                      key={section.id}
                      onClick={() => openSection(section.id)}
                      type="button"
                    >
                      {section.title}
                    </button>
                  ))}
                </nav>
              ) : null}

              <div className="flex flex-col divide-y divide-border-subtle overflow-hidden rounded-[var(--radius-xl)] border border-border-subtle bg-card">
                {sections.map((section) => (
                  <Collapsible
                    id={`atlas-section-${section.id}`}
                    key={section.id}
                    onOpenChange={(open) =>
                      setOpenSections((current) =>
                        open ? [...current, section.id] : current.filter((id) => id !== section.id),
                      )
                    }
                    open={openSections.includes(section.id)}
                  >
                    <CollapsibleTrigger className="group flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-foreground hover:text-foreground">
                      <span className="flex flex-col gap-0.5">
                        <span className="font-journal text-2xl leading-tight font-normal">
                          {section.title}
                        </span>
                        <span className="text-sm font-normal text-muted-foreground">
                          {g('readingTime', { minutes: readingMinutes(sectionWords(section)) })}
                        </span>
                      </span>
                      <ChevronDown
                        aria-hidden="true"
                        className="size-5 transition-transform duration-[var(--motion-standard)] group-data-[panel-open]:rotate-180 motion-reduce:transition-none"
                      />
                    </CollapsibleTrigger>
                    <CollapsiblePanel>
                      <div className="flex flex-col gap-4 px-5 pb-6">
                        {section.blocks.map((block, index) => (
                          <GuideBlock block={block} key={index} />
                        ))}
                      </div>
                    </CollapsiblePanel>
                  </Collapsible>
                ))}
              </div>

              <footer className="border-t border-border-subtle pt-4 text-sm leading-relaxed text-muted-foreground">
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
      </HomeSheet>
    </div>
  );
}

function GuideBlock({ block }: Readonly<{ block: AtlasBlock }>) {
  const g = useTranslations('atlas.guide');
  switch (block.type) {
    case 'heading':
      return <h3 className="pt-2 text-lg font-semibold">{block.text}</h3>;
    case 'paragraph':
      return <p className="text-base leading-[1.65] text-foreground/90">{block.text}</p>;
    case 'list':
      return (
        <ul className="flex list-disc flex-col gap-1.5 ps-5 text-base leading-[1.6] text-foreground/90 marker:text-muted-foreground">
          {block.items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      );
    case 'listing': {
      const { listing } = block;
      return (
        <article className="rounded-[var(--radius-lg)] border border-border-subtle bg-background p-4">
          <div className="flex items-start justify-between gap-3">
            <h4 className="font-journal text-xl leading-tight font-normal">{listing.name}</h4>
            <span className="shrink-0 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">
              {g(`listing.${listing.kind}`)}
            </span>
          </div>
          {listing.alt ? (
            <p className="mt-0.5 text-sm text-muted-foreground">{listing.alt}</p>
          ) : null}
          {listing.content ? (
            <p className="mt-2 text-[0.9375rem] leading-relaxed">{listing.content}</p>
          ) : null}
          {listing.address ? (
            <p className="mt-2 text-sm text-muted-foreground">{listing.address}</p>
          ) : null}
        </article>
      );
    }
  }
}

/** The opening sentence set large in the journal serif; the rest of the introduction as text. */
function GuideLead({ paragraphs }: Readonly<{ paragraphs: string[] }>) {
  const [first = '', ...rest] = paragraphs.slice(0, 3);
  const end = first.search(/[.!?](\s|$)/);
  const opening = end > 0 ? first.slice(0, end + 1) : first;
  const remainder = [first.slice(opening.length).trim(), ...rest].filter(Boolean);
  return (
    <div className="flex flex-col gap-4">
      <p className="font-journal text-[1.5rem] leading-snug text-foreground italic">{opening}</p>
      {remainder.map((paragraph, index) => (
        <p className="text-base leading-[1.65] text-muted-foreground" key={index}>
          {paragraph}
        </p>
      ))}
    </div>
  );
}
