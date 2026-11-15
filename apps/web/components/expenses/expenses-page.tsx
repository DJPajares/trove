'use client';

import { useQuery } from '@tanstack/react-query';
import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo } from 'react';

import { TripExpenses } from '@/components/expenses/trip-expenses';
import { PageHeader } from '@/components/page-header';
import { PageState } from '@/components/page-state';
import { localToday } from '@/components/saved/saved-ready-for-trip';
import { ToolsBackLink } from '@/components/tools/tools-back-link';
import { TripProvider } from '@/components/trip-provider';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { queryKeys } from '@/lib/query/keys';
import { defaultExpensesTrip } from '@/lib/expenses/default-trip';
import { fetchTrips } from '@/lib/trips/api';
import { namedCountries } from '@/lib/trips/countries';
import { formatTripDateRange } from '@/lib/trips/format';
import * as Icons from '@/lib/icons';

/** How many flags a switcher row shows before the rest become "+N". */
const MAX_FLAGS = 2;

/**
 * Expenses outside any one trip: the same view a trip's Expenses section
 * shows, with a switcher for which trip it is. The trip lives in the address
 * (`?trip=`), so a link opens the same trip; without one it starts on the trip
 * underway or the next ahead.
 */
export function ExpensesPage() {
  const t = useTranslations('expensesPage');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get('trip');
  const trips = useQuery({ queryFn: () => fetchTrips(), queryKey: queryKeys.trips() });

  const list = useMemo(
    () =>
      (trips.data?.trips ?? []).toSorted((left, right) =>
        right.startDate.localeCompare(left.startDate),
      ),
    [trips.data],
  );
  const selected =
    list.find((trip) => trip.id === requested) ?? defaultExpensesTrip(list, localToday());

  function showTrip(tripId: string) {
    router.replace(`${pathname}?${new URLSearchParams({ trip: tripId })}`, { scroll: false });
  }

  // Write the trip the page settled on back into the address, so what is on
  // screen can always be linked.
  useEffect(() => {
    if (selected && selected.id !== requested) showTrip(selected.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the answer changes
  }, [requested, selected?.id]);

  const header = (
    <div>
      <ToolsBackLink label={t('back')} />
      <PageHeader
        actions={
          selected ? (
            <Select onValueChange={(value) => value && showTrip(value)} value={selected.id}>
              <SelectTrigger
                aria-label={t('chooseTrip')}
                className="w-full max-w-full sm:w-auto sm:max-w-80"
              >
                <SelectValue className="gap-2">
                  <TripFlags countries={selected.countries} />
                  <span className="min-w-0 truncate">{selected.name}</span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end" alignItemWithTrigger={false}>
                {list.map((trip) => (
                  <SelectItem key={trip.id} label={trip.name} value={trip.id}>
                    <span className="flex min-w-0 items-center gap-2">
                      <TripFlags countries={trip.countries} />
                      <span className="min-w-0 truncate font-medium">{trip.name}</span>
                    </span>
                    <span className="block text-xs whitespace-nowrap text-muted-foreground">
                      {formatTripDateRange(trip.startDate, trip.endDate, locale)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : undefined
        }
        eyebrow={t('eyebrow')}
        title={t('title')}
        titleFont="journal"
      />
    </div>
  );

  if (trips.isPending) {
    return (
      <section className="mx-auto w-full max-w-5xl space-y-7">
        {header}
        <PageState headingLevel={2} kind="loading" loadingShape="list" title={t('loading')} />
      </section>
    );
  }

  if (trips.isError) {
    return (
      <section className="mx-auto w-full max-w-5xl space-y-7">
        {header}
        <PageState
          actions={<Button onClick={() => void trips.refetch()}>{t('tryAgain')}</Button>}
          description={t('loadErrorDescription')}
          headingLevel={2}
          icon={<CircleAlert aria-hidden="true" />}
          kind="error"
          title={t('loadError')}
        />
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-5xl space-y-7">
      {header}
      {selected ? (
        <TripProvider key={selected.id} tripId={selected.id}>
          <TripExpenses placement="standalone" tripId={selected.id} />
        </TripProvider>
      ) : (
        <PageState
          actions={
            <Button nativeButton={false} render={<Link href="/trips" />}>
              {t('openTrips')}
            </Button>
          }
          className="min-h-64 justify-center"
          description={t('noTripsDescription')}
          headingLevel={2}
          icon={<Icons.Expenses aria-hidden="true" />}
          title={t('noTripsTitle')}
        />
      )}
    </section>
  );
}

/**
 * Where a trip goes, as up to two flags and a count of the rest. Each flag is
 * named for its country, since some systems draw flag emoji as plain letters;
 * the trip name beside it stays the cue a traveller reads. Nothing at all for
 * a trip with no countries, so the name sits flush.
 */
function TripFlags({ countries }: Readonly<{ countries?: readonly string[] }>) {
  const t = useTranslations('expensesPage');
  const locale = useLocale();
  const named = namedCountries(countries, locale);
  if (!named.length) return null;
  const more = named.length - MAX_FLAGS;

  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {named.slice(0, MAX_FLAGS).map((country) => (
        <span aria-label={country.name} key={country.code} role="img">
          {country.flag}
        </span>
      ))}
      {more > 0 ? (
        <span
          aria-label={t('moreCountries', { count: more })}
          className="ml-0.5 text-xs text-muted-foreground"
          role="img"
        >
          {t('moreCountriesShort', { count: more })}
        </span>
      ) : null}
    </span>
  );
}
