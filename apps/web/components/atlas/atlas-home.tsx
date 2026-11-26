'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { AtlasCover } from '@/components/atlas/atlas-cover';
import { HomeSheet } from '@/components/home/home-front-door';
import { MediaFrame } from '@/components/media-frame';
import { usePreferences } from '@/components/preferences-provider';
import { SearchField } from '@/components/search-field';
import { Button } from '@/components/ui/button';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { ScrollShadow } from '@/components/ui/scroll-shadow';
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';
import { useAtlasIndex } from '@/hooks/use-atlas-index';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import { useHydrated } from '@/hooks/use-hydrated';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ATLAS_REGIONS,
  atlasCountries,
  bestForMonth,
  greatMonthRuns,
  matchesAtlasQuery,
  monthClimate,
  nextMonth,
  type AtlasCountry,
  type AtlasRegion,
} from '@/lib/atlas';
import { formatAtlasTemperature, formatMonthRuns, monthName } from '@/lib/atlas/format';
import { editorialCoverImage, editorialSubjectKey } from '@/lib/media/editorial-images';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import { useEntrance, type EntranceClock } from '@/lib/page-entrance';

const FEATURED_COUNT = 8;
const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

/** Atlas's entrance, kept for the tab's life and replayed on each visit. */
const atlasEntrance: EntranceClock = { startedAt: null };

/** The English name the editorial photo service is asked for, whatever the reader's locale. */
const englishNames = new Intl.DisplayNames(['en'], { type: 'region' });
function countrySubject(country: AtlasCountry) {
  return { name: englishNames.of(country.countryCode) ?? country.name };
}

/**
 * Atlas's front page (PRD 40.2): a cover, search, and two ways in, Where and
 * When. Everything here reads the bundled index, so browsing makes no request
 * except for the photographs of the few countries featured this month.
 */
export function AtlasHome() {
  const t = useTranslations('atlas');
  const locale = useLocale();
  const { preferences } = usePreferences();
  // Names come from the browser's own ICU data, so they are not rendered on the server.
  const hydrated = useHydrated();
  const index = useAtlasIndex();
  const countries = useMemo(
    () => (hydrated && index.data ? atlasCountries(index.data.countries, locale) : []),
    [hydrated, index.data, locale],
  );
  const loading = !hydrated || index.isPending;
  const unavailable = !loading && !index.data;
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState<AtlasRegion | 'all'>('all');
  const [tab, setTab] = useState<'where' | 'when'>('where');

  const today = new Date();
  const upcoming = nextMonth(today);
  const upcomingYear = today.getFullYear() + (upcoming === 1 ? 1 : 0);
  const [month, setMonth] = useState(upcoming);
  const featured = useMemo(
    () => bestForMonth(countries, upcoming, upcomingYear).great.slice(0, FEATURED_COUNT),
    [countries, upcoming, upcomingYear],
  );
  const subjects = useMemo(() => featured.map(countrySubject), [featured]);
  const images = useEditorialImages(subjects);
  const photoFor = (country: AtlasCountry) =>
    editorialCoverImage(
      images.get(editorialSubjectKey(countrySubject(country))),
      country.countryCode,
    );

  const filtered = countries.filter(
    (country) =>
      (region === 'all' || country.region === region) && matchesAtlasQuery(country, query),
  );
  const searching = query.trim().length > 0;
  const temperature = (celsius: number) =>
    formatAtlasTemperature(celsius, preferences.temperatureUnit);
  const entrance = useEntrance(atlasEntrance, { ready: true, replay: true });

  return (
    <section className="mx-auto w-full max-w-5xl pb-16" style={entrance.style}>
      <AtlasCover
        description={t('description')}
        enter={entrance.enter}
        kicker={t('kicker')}
        media={(() => {
          const photo = featured[0] ? photoFor(featured[0]) : null;
          return photo ? resolveTripMediaSource({ editorial: photo }) : null;
        })()}
        title={t('title')}
      />

      <HomeSheet>
        <div className="flex flex-col gap-8">
          <SearchField
            label={t('searchLabel')}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            value={query}
            wrapperClassName="max-w-xl"
          />

          <Tabs onValueChange={(value) => setTab(value as 'where' | 'when')} value={tab}>
            <TabsList aria-label={t('browse')} className="w-full max-w-xs">
              <TabsTab className="flex-1" value="where">
                {t('tabs.where')}
              </TabsTab>
              <TabsTab className="flex-1" value="when">
                {t('tabs.when')}
              </TabsTab>
              <TabsIndicator />
            </TabsList>

            <TabsPanel className="mt-8 flex flex-col gap-10" value="where">
              {!searching && featured.length ? (
                <section aria-labelledby="atlas-featured">
                  <h2
                    className="font-journal text-[2rem] leading-none font-normal"
                    id="atlas-featured"
                  >
                    {t('greatIn', { month: monthName(upcoming, locale) })}
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">{t('greatInDescription')}</p>
                  <ScrollShadow
                    className="interaction-scrollbar -mx-[var(--gutter-inline-start)] mt-4 flex snap-x scroll-px-[var(--gutter-inline-start)] gap-3 px-[var(--gutter-inline-start)] pb-2"
                    orientation="horizontal"
                    render={<ul />}
                  >
                    {featured.map((country) => {
                      const climate = monthClimate(country, upcoming);
                      return (
                        <li className="w-56 shrink-0 snap-start" key={country.countryCode}>
                          <Link
                            className="group flex h-full flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border-subtle bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                            href={`/atlas/${country.countryCode}`}
                          >
                            <MediaFrame
                              alt=""
                              className="aspect-[4/3] w-full rounded-none"
                              dataSlot="atlas-featured-media"
                              sizes="14rem"
                              source={resolveTripMediaSource({ editorial: photoFor(country) })}
                              variant="card"
                            />
                            <span className="flex flex-col gap-0.5 px-3.5 pt-3 pb-3.5">
                              <span className="font-journal text-2xl leading-tight">
                                {country.name}
                              </span>
                              {climate ? (
                                <span className="text-sm text-muted-foreground tabular-nums">
                                  {t('typicalTemps', {
                                    high: temperature(climate.temperatureMaxC),
                                    low: temperature(climate.temperatureMinC),
                                  })}
                                  {' · '}
                                  {country.climateCity}
                                </span>
                              ) : null}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ScrollShadow>
                </section>
              ) : null}

              <section aria-labelledby="atlas-world" className="flex flex-col gap-4">
                <h2 className="font-journal text-[2rem] leading-none font-normal" id="atlas-world">
                  {t('browseWorld')}
                </h2>
                <ChipGroup
                  aria-label={t('regionFilter')}
                  onValueChange={(value) =>
                    setRegion((value[0] as AtlasRegion | undefined) ?? 'all')
                  }
                  value={[region]}
                >
                  <Chip className="min-h-9 px-3.5 text-sm" value="all">
                    {t('regions.all')}
                  </Chip>
                  {ATLAS_REGIONS.map((option) => (
                    <Chip className="min-h-9 px-3.5 text-sm" key={option} value={option}>
                      {t(`regions.${option}`)}
                    </Chip>
                  ))}
                </ChipGroup>
                {unavailable ? (
                  <Empty className="rounded-[var(--radius-xl)] border border-border-subtle">
                    <EmptyHeader>
                      <EmptyTitle>{t('unavailable')}</EmptyTitle>
                      <EmptyDescription>{t('guide.errorDescription')}</EmptyDescription>
                    </EmptyHeader>
                    <Button onClick={() => void index.refetch()} type="button" variant="outline">
                      {t('guide.tryAgain')}
                    </Button>
                  </Empty>
                ) : loading ? (
                  <div aria-hidden="true" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 9 }, (_, index) => (
                      <Skeleton className="h-14" key={index} />
                    ))}
                  </div>
                ) : filtered.length ? (
                  <CountryList countries={filtered} locale={locale} />
                ) : (
                  <p className="text-muted-foreground">{t('noMatches', { query: query.trim() })}</p>
                )}
              </section>
            </TabsPanel>

            <TabsPanel className="mt-8" value="when">
              <MonthBrowser
                climateYears={index.data?.climateYears ?? null}
                countries={
                  searching ? countries.filter((c) => matchesAtlasQuery(c, query)) : countries
                }
                locale={locale}
                month={month}
                onMonthChange={setMonth}
                temperature={temperature}
              />
            </TabsPanel>
          </Tabs>
        </div>
      </HomeSheet>
    </section>
  );
}

function CountryList({
  countries,
  locale,
}: Readonly<{ countries: AtlasCountry[]; locale: string }>) {
  const t = useTranslations('atlas');
  const groups = new Map<string, AtlasCountry[]>();
  for (const country of countries) {
    const letter = country.name.normalize('NFKD').charAt(0).toLocaleUpperCase(locale);
    groups.set(letter, [...(groups.get(letter) ?? []), country]);
  }

  return (
    <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
      {[...groups.entries()].map(([letter, members]) => (
        <section aria-label={letter} key={letter}>
          <h3 className="mb-1 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            {letter}
          </h3>
          <ul className="divide-y divide-border-subtle">
            {members.map((country) => {
              const runs = greatMonthRuns(country);
              return (
                <li key={country.countryCode}>
                  <Link
                    className="flex min-h-14 items-center gap-3 rounded-[var(--radius-sm)] py-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                    href={`/atlas/${country.countryCode}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{country.name}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {!country.months
                          ? t('noPattern')
                          : runs[0]?.length === 12
                            ? t('greatAllYear')
                            : runs.length
                              ? t('bestMonths', { months: formatMonthRuns(runs, locale) })
                              : t('noGreatMonths')}
                      </span>
                    </span>
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function MonthBrowser({
  climateYears,
  countries,
  locale,
  month,
  onMonthChange,
  temperature,
}: Readonly<{
  climateYears: { from: number; to: number } | null;
  countries: AtlasCountry[];
  locale: string;
  month: number;
  onMonthChange: (month: number) => void;
  temperature: (celsius: number) => string;
}>) {
  const t = useTranslations('atlas');
  const year = new Date().getFullYear();
  const { good, great } = bestForMonth(countries, month, year);
  const byName = (a: AtlasCountry, b: AtlasCountry) => a.name.localeCompare(b.name, locale);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          {t('whereToGoIn')}
        </p>
        <h2 className="mt-1 font-journal text-[clamp(2.75rem,9vw,4rem)] leading-none font-normal text-accent-strong">
          {monthName(month, locale)}
        </h2>
        <ChipGroup
          aria-label={t('chooseMonth')}
          className="mt-4 grid max-w-xl grid-cols-6 gap-1.5"
          onValueChange={(value) => {
            const picked = Number(value[0]);
            if (picked) onMonthChange(picked);
          }}
          value={[String(month)]}
        >
          {MONTHS.map((option) => (
            <Chip
              className="min-h-11 justify-center rounded-[var(--radius-md)] text-sm"
              key={option}
              value={String(option)}
            >
              {monthName(option, locale, 'short')}
            </Chip>
          ))}
        </ChipGroup>
        {climateYears ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('patternNote', climateYears)}</p>
        ) : null}
      </div>

      {[
        { heading: t('atTheirBest'), list: [...great].sort(byName), id: 'great' },
        { heading: t('alsoGood'), list: [...good].sort(byName), id: 'good' },
      ].map(({ heading, id, list }) => (
        <section aria-labelledby={`atlas-month-${id}`} key={id}>
          <div className="flex items-baseline justify-between gap-3">
            <h3
              className="font-journal text-[1.75rem] leading-none font-normal"
              id={`atlas-month-${id}`}
            >
              {heading}
            </h3>
            <span className="text-sm text-muted-foreground">
              {t('countryCount', { count: list.length })}
            </span>
          </div>
          {list.length ? (
            <ul className="mt-3 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((country) => {
                const climate = monthClimate(country, month)!;
                return (
                  <li className="border-b border-border-subtle" key={country.countryCode}>
                    <Link
                      className="flex min-h-14 items-center gap-3 py-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                      href={`/atlas/${country.countryCode}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{country.name}</span>
                        <span className="block truncate text-sm text-muted-foreground">
                          {country.climateCity}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-medium tabular-nums">
                        {t('typicalTemps', {
                          high: temperature(climate.temperatureMaxC),
                          low: temperature(climate.temperatureMinC),
                        })}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : id === 'great' ? (
            <p className="mt-3 text-muted-foreground">{t('nothingGreat')}</p>
          ) : null}
        </section>
      ))}
    </div>
  );
}
