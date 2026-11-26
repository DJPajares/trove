'use client';

import {
  Building2,
  ChevronRight,
  PartyPopper,
  Shuffle,
  Trees,
  Utensils,
  Waves,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { ATLAS_LICENCE, wikivoyageArticleUrl } from '@trove/types';

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
import {
  ATLAS_THEMES,
  ATLAS_THEME_DEFINITIONS,
  countriesForTheme,
  pickSurpriseCountry,
  type AtlasTheme,
} from '@/lib/atlas/themes';
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
 * Atlas's front page (PRD 40.2): a cover, search, Surprise me, and three ways
 * in — Where, When, and What. Everything here reads the bundled index, so
 * browsing makes no request except for the photographs of visible cards.
 */
export function AtlasHome() {
  const t = useTranslations('atlas');
  const locale = useLocale();
  const router = useRouter();
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
  const [tab, setTab] = useState<'where' | 'when' | 'what'>('where');
  const [theme, setTheme] = useState<AtlasTheme>('food');

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
          <div className="flex flex-wrap items-center gap-3">
            <SearchField
              label={t('searchLabel')}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('searchPlaceholder')}
              value={query}
              wrapperClassName="min-w-0 flex-1 sm:max-w-xl"
            />
            <Button
              className="shrink-0"
              disabled={!countries.length}
              onClick={() => {
                const picked = pickSurpriseCountry(countries);
                if (picked) router.push(`/atlas/${picked.countryCode}`);
              }}
              type="button"
              variant="outline"
            >
              <Shuffle aria-hidden="true" className="size-4" />
              {t('surpriseMe')}
            </Button>
          </div>

          <Tabs onValueChange={(value) => setTab(value as 'where' | 'when' | 'what')} value={tab}>
            <TabsList aria-label={t('browse')} className="w-full max-w-sm">
              <TabsTab className="flex-1" value="where">
                {t('tabs.where')}
              </TabsTab>
              <TabsTab className="flex-1" value="when">
                {t('tabs.when')}
              </TabsTab>
              <TabsTab className="flex-1" value="what">
                {t('tabs.what')}
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

            <TabsPanel className="mt-8" value="what">
              <ThemeBrowser
                active={tab === 'what'}
                countries={countries}
                locale={locale}
                onThemeChange={setTheme}
                query={query}
                theme={theme}
              />
            </TabsPanel>
          </Tabs>
        </div>
      </HomeSheet>
    </section>
  );
}

const SPARKLINE_COLOR = {
  good: 'h-2.5 bg-[oklch(0.72_0.06_112)]',
  great: 'h-3.5 bg-[oklch(0.455_0.07_115)]',
  mixed: 'h-2 bg-[oklch(0.83_0.05_55)]',
  off: 'h-1.5 bg-[oklch(0.88_0.015_78)]',
} as const;

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
                    className="group flex min-h-14 items-center gap-3 rounded-[var(--radius-sm)] py-2.5 outline-none transition-colors hover:text-brand focus-visible:ring-3 focus-visible:ring-ring/40"
                    href={`/atlas/${country.countryCode}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="shrink-0 font-mono text-[0.6875rem] tracking-wider text-muted-foreground">
                          {country.countryCode}
                        </span>
                        <span className="truncate font-journal text-[1.375rem] leading-tight text-foreground transition-colors group-hover:text-brand">
                          {country.name}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {!country.months
                          ? t('noPattern')
                          : runs[0]?.length === 12
                            ? t('greatAllYear')
                            : runs.length
                              ? t('bestMonths', { months: formatMonthRuns(runs, locale) })
                              : t('noGreatMonths')}
                      </span>
                    </span>
                    {country.months ? (
                      <span aria-hidden="true" className="flex h-4 shrink-0 items-end gap-[2px]">
                        {country.months.map((entry) => (
                          <span
                            className={`w-[3px] rounded-full ${SPARKLINE_COLOR[entry.rating]}`}
                            key={entry.month}
                          />
                        ))}
                      </span>
                    ) : (
                      <ChevronRight
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                    )}
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

const THEME_ICONS: Record<AtlasTheme, typeof Utensils> = {
  cities: Building2,
  coast: Waves,
  festivals: PartyPopper,
  food: Utensils,
  nature: Trees,
};

const THEME_PHOTO_LIMIT = 12;

function ThemeBrowser({
  active,
  countries,
  locale,
  onThemeChange,
  query,
  theme,
}: Readonly<{
  active: boolean;
  countries: AtlasCountry[];
  locale: string;
  onThemeChange: (theme: AtlasTheme) => void;
  query: string;
  theme: AtlasTheme;
}>) {
  const t = useTranslations('atlas');
  const definition = ATLAS_THEME_DEFINITIONS[theme];
  const themed = useMemo(() => countriesForTheme(countries, theme), [countries, theme]);
  const searching = query.trim().length > 0;
  const visible = useMemo(
    () => (searching ? themed.filter((country) => matchesAtlasQuery(country, query)) : themed),
    [query, searching, themed],
  );
  const photoSubjects = useMemo(
    () => (active ? visible.slice(0, THEME_PHOTO_LIMIT).map(countrySubject) : []),
    [active, visible],
  );
  const images = useEditorialImages(photoSubjects);
  const photoFor = (country: AtlasCountry) =>
    editorialCoverImage(
      images.get(editorialSubjectKey(countrySubject(country))),
      country.countryCode,
    );

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          {t('browseByTheme')}
        </p>
        <h2 className="mt-1 font-journal text-[clamp(2.5rem,8vw,3.75rem)] leading-none font-normal text-accent-strong">
          {t(`themes.${theme}.title`)}
        </h2>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          {t(`themes.${theme}.description`)}
        </p>
        <ChipGroup
          aria-label={t('chooseTheme')}
          className="mt-4"
          onValueChange={(value) => {
            const picked = value[0] as AtlasTheme | undefined;
            if (picked) onThemeChange(picked);
          }}
          value={[theme]}
        >
          {ATLAS_THEMES.map((option) => {
            const Icon = THEME_ICONS[option];
            return (
              <Chip className="min-h-10 gap-1.5 px-3.5 text-sm" key={option} value={option}>
                <Icon aria-hidden="true" className="size-3.5" />
                {t(`themes.${option}.label`)}
              </Chip>
            );
          })}
        </ChipGroup>
      </div>

      {visible.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((country) => {
            const runs = greatMonthRuns(country);
            const subtitle =
              theme === 'food' && country.quickFacts?.nationalDish
                ? country.quickFacts.nationalDish
                : runs[0]?.length === 12
                  ? t('greatAllYear')
                  : runs.length
                    ? t('bestMonths', { months: formatMonthRuns(runs, locale) })
                    : t(`regions.${country.region}`);
            return (
              <li key={country.countryCode}>
                <Link
                  className="group flex h-full flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border-subtle bg-card outline-none transition-colors hover:border-border focus-visible:ring-3 focus-visible:ring-ring/40"
                  href={`/atlas/${country.countryCode}`}
                >
                  <MediaFrame
                    alt=""
                    className="aspect-[4/3] w-full rounded-none"
                    dataSlot="atlas-theme-media"
                    sizes="(min-width: 1024px) 20rem, (min-width: 640px) 50vw, 100vw"
                    source={resolveTripMediaSource({ editorial: photoFor(country) })}
                    variant="card"
                  />
                  <span className="flex flex-col gap-0.5 px-4 pt-3 pb-3.5">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-journal text-2xl leading-tight text-foreground transition-colors group-hover:text-brand">
                        {country.name}
                      </span>
                      <span className="shrink-0 font-mono text-[0.6875rem] tracking-wider text-muted-foreground">
                        {country.countryCode}
                      </span>
                    </span>
                    <span className="truncate text-sm text-muted-foreground">{subtitle}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : searching ? (
        <p className="text-muted-foreground">{t('noMatches', { query: query.trim() })}</p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {t.rich('themeTopicCredit', {
          licence: (chunks) => (
            <a
              className="underline underline-offset-2 hover:text-foreground"
              href={ATLAS_LICENCE.url}
              rel="noreferrer"
              target="_blank"
            >
              {chunks}
            </a>
          ),
          licenceName: ATLAS_LICENCE.name,
          topic: (chunks) => (
            <a
              className="underline underline-offset-2 hover:text-foreground"
              href={wikivoyageArticleUrl(definition.wikivoyageTopic)}
              rel="noreferrer"
              target="_blank"
            >
              {chunks}
            </a>
          ),
          topicName: definition.wikivoyageTopic,
        })}
      </p>
    </div>
  );
}
