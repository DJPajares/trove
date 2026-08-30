import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';
import { formatItineraryTimeRange } from '@/lib/itinerary/item-timing';
import type { PublicItinerary as PublicItineraryData } from '@/lib/public-trip/api';

type PublicItineraryProps = {
  itinerary: PublicItineraryData;
  locale: string;
};

/**
 * A shared plan, read by someone who cannot change it.
 *
 * It follows `itinerary-overview` in shape - the same card, the same day rows,
 * the same time-then-name rhythm - and departs from it in the one way that
 * matters: nothing here is a control. The overview's rows are buttons that hand
 * the traveller to the day workspace, and a visitor has no workspace to be
 * handed to, so a button that only looks like one would be a promise the page
 * cannot keep. Every day is open for the same reason: there is no state to
 * restore, so there is nothing to be gained by making a reader ask twice.
 *
 * A server component. There is nothing to hydrate, so it ships no JavaScript.
 */
export async function PublicItinerary({ itinerary, locale }: Readonly<PublicItineraryProps>) {
  const t = await getTranslations('sharedTrip');
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    weekday: 'short',
    year: 'numeric',
  });
  const formatDate = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00.000Z`));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('eyebrow')}
        </p>
        <h1 className="text-[length:var(--text-page-title)] leading-[1.08] font-semibold tracking-[-0.035em] text-pretty">
          {itinerary.trip.name}
        </h1>
        <p className="text-[length:var(--text-metadata)] font-medium text-muted-foreground tabular-nums">
          {t('dateRange', {
            endDate: formatDate(itinerary.trip.endDate),
            startDate: formatDate(itinerary.trip.startDate),
          })}
        </p>
        <p className="text-sm text-muted-foreground">{t('readOnly')}</p>
      </header>

      {itinerary.days.length ? (
        <section
          aria-labelledby="shared-itinerary-heading"
          className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-[var(--shadow-surface)]"
        >
          <h2 className="sr-only" id="shared-itinerary-heading">
            {t('eyebrow')}
          </h2>
          <ol className="divide-y divide-border-subtle">
            {itinerary.days.map((day, index) => {
              const date = formatDate(day.date);
              const dayLabel = t('dayNumber', { number: index + 1 });

              return (
                <li
                  className="grid gap-4 px-4 py-5 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8 md:px-6"
                  key={day.id}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">
                      {dayLabel}
                      <span aria-hidden="true"> · </span>
                      {t('dayItemCount', { count: day.items.length })}
                    </p>
                    <h3 className="mt-1 text-base leading-6 font-semibold text-foreground">
                      {day.name ?? date}
                    </h3>
                    {day.name ? (
                      <p className="mt-0.5 text-sm text-muted-foreground">{date}</p>
                    ) : null}
                    {day.notes ? (
                      <p className="mt-2 text-sm leading-5 text-muted-foreground">{day.notes}</p>
                    ) : null}
                  </div>

                  {day.items.length ? (
                    <ul aria-label={t('itemsForDay', { number: index + 1 })}>
                      {day.items.map((item) => {
                        // The API sends no name when nothing has supplied one, so
                        // the fallback is worded here where the copy lives.
                        const name = item.name ?? t('untitledItem');
                        const timing = item.localStartTime
                          ? // A visitor has no profile, so no 12h/24h preference of
                            // their own: their locale is the closest thing to one.
                            (formatItineraryTimeRange(item, locale, 'locale') ??
                            item.localStartTime)
                          : null;

                        return (
                          <li
                            // Fixed, not `auto`. Each row is its own grid, so an
                            // `auto` column is sized by that row alone and a stop
                            // with a range shunts its name out of line with the
                            // plain-time rows above it. The shared token's width
                            // is measured rather than chosen: at this type size the widest 12-hour
                            // range runs 118px, a 24-hour range 75px, the longest
                            // daypart 58px and a plain time 46px. Re-measure if the
                            // type changes; do not nudge it.
                            className="grid grid-cols-[var(--itinerary-time-column)_minmax(0,1fr)] items-baseline gap-3 px-2 py-2"
                            key={item.id}
                          >
                            <span className="text-xs font-medium whitespace-nowrap text-text-subtle tabular-nums">
                              {timing ?? (item.dayPart ? t(`dayPart.${item.dayPart}`) : '')}
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground">{name}</p>
                              {item.address ? (
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {item.address}
                                </p>
                              ) : null}
                              {item.notes ? (
                                <p className="mt-1 text-sm leading-5 text-muted-foreground">
                                  {item.notes}
                                </p>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="rounded-[var(--radius-md)] bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                      {t('emptyDay')}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ) : (
        <p className="rounded-[var(--radius-xl)] border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
          {t('emptyTrip')}
        </p>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-xl)] border border-border-subtle px-4 py-4">
        <p className="text-sm text-muted-foreground">{t('footerPrompt')}</p>
        <Button nativeButton={false} render={<Link href="/sign-up" />} size="sm">
          {t('footerAction')}
        </Button>
      </footer>
    </div>
  );
}
