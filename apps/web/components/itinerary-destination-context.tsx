'use client';

import type { DestinationContextGroup, TripDestinationContext } from '@trove/types';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';

export function ItineraryDestinationContext({
  context,
  dayId,
  focusedRecordId,
  onFocusedRecordDismissed,
}: {
  context: TripDestinationContext | undefined;
  /** null means Overview; an unknown day does not fall back to all destinations. */
  dayId: string | null;
  focusedRecordId?: string | null;
  onFocusedRecordDismissed?: () => void;
}) {
  const t = useTranslations('destinationContext');
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => {
    if (focusedRecordId) setOpen(true);
  }, [focusedRecordId]);
  useEffect(() => {
    if (!open || !focusedRecordId) return;
    const frame = requestAnimationFrame(() =>
      document.getElementById(`${id}-${focusedRecordId}`)?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [open, focusedRecordId, id]);
  const content = useTranslations('destinationContextContent');
  const formatter = useFormatter();
  const groups: DestinationContextGroup[] =
    dayId === null
      ? (context?.overview ?? [])
      : (context?.days.find((day) => day.dayId === dayId)?.groups ?? []);
  // Offline itinerary snapshots keep original expiry; reading them never renews it.
  const now = Date.now();
  const reusable = !context?.expiresAt || Date.parse(context.expiresAt) > now;
  const current = (reusable ? groups : [])
    .map((group) => ({
      ...group,
      records: group.records.filter(
        (record) => Date.parse(record.reviewedAt) <= now && Date.parse(record.expiresAt) > now,
      ),
    }))
    .filter((group) => group.records.length);
  const date = (value: string) =>
    formatter.dateTime(new Date(value), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onFocusedRecordDismissed?.();
      }}
    >
      <CollapsibleTrigger className="group">
        {t('title')}
        <ChevronDown
          aria-hidden="true"
          className="transition-transform duration-[var(--motion-standard)] group-data-panel-open:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="max-w-3xl space-y-6 pt-4">
          <p className="text-sm text-muted-foreground">{t('description')}</p>
          {current.length ? (
            current.map((group) => (
              <section
                aria-label={content(`destinations.${group.destination}`)}
                className="space-y-4"
                key={group.destination}
              >
                <h3 className="text-sm font-semibold">
                  {content(`destinations.${group.destination}`)}
                </h3>
                {group.records.map((record) => {
                  const window = record.applicability;
                  const applicability =
                    window.kind === 'all_year'
                      ? t('allYear')
                      : window.kind === 'season'
                        ? t('seasonWindow', {
                            start: formatter.dateTime(new Date(`2000-${window.start}T00:00:00Z`), {
                              day: 'numeric',
                              month: 'short',
                              timeZone: 'UTC',
                            }),
                            end: formatter.dateTime(new Date(`2000-${window.end}T00:00:00Z`), {
                              day: 'numeric',
                              month: 'short',
                              timeZone: 'UTC',
                            }),
                          })
                        : window.kind === 'date_set'
                          ? t('dates', { dates: formatter.list(record.matchedDates.map(date)) })
                          : t('dateWindow', { start: date(window.start), end: date(window.end) });
                  return (
                    <article
                      className="space-y-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      id={`${id}-${record.id}`}
                      key={record.id}
                      tabIndex={-1}
                    >
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <h4 className="text-sm font-medium">
                          {content(`records.${record.contentKey}.title`)}
                        </h4>
                        <span className="text-xs text-muted-foreground">{t(record.certainty)}</span>
                      </div>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {content(`records.${record.contentKey}.summary`)}
                      </p>
                      {record.scope.areaKey ? (
                        <p className="text-xs text-muted-foreground">
                          {t('scope', { area: content(`areas.${record.scope.areaKey}`) })}
                        </p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">{applicability}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <a
                          className="inline-flex items-center gap-1 rounded-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                          href={record.sourceUrl}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          {t('source')} <ExternalLink aria-hidden="true" className="size-3" />
                        </a>
                        <span>{t('reviewed', { date: date(record.reviewedAt) })}</span>
                        <span>
                          {t(
                            record.applicability.kind === 'dates' ||
                              record.applicability.kind === 'date_set'
                              ? 'expires'
                              : 'reviewDue',
                            {
                              date: formatter.dateTime(new Date(record.expiresAt), {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                                timeZone:
                                  group.destination === 'singapore'
                                    ? 'Asia/Singapore'
                                    : 'Asia/Tokyo',
                              }),
                            },
                          )}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </section>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              {t(dayId === null ? 'emptyTrip' : 'emptyDay')}
            </p>
          )}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
