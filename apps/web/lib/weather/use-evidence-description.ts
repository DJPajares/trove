'use client';

import { useLocale, useTranslations } from 'next-intl';

import { forecastRetrievalInstant, observationInstant } from '@/lib/weather/freshness';

/** Shared source context for link tooltips and accessible weather descriptions. */
export function useWeatherEvidenceDescription() {
  const locale = useLocale();
  const t = useTranslations('tripMode.views.weather');
  return (evidence: {
    kind: 'current' | 'forecast' | 'archived';
    date?: string;
    timeZone: string;
    fetchedAt?: string | null;
    observedAt?: string;
  }) => {
    const instant =
      evidence.kind === 'current'
        ? observationInstant(evidence.observedAt, evidence.timeZone)
        : forecastRetrievalInstant(evidence.fetchedAt)?.getTime();
    let timestamp = t('retrievalUnknown');
    if (instant !== null && instant !== undefined) {
      try {
        timestamp = new Intl.DateTimeFormat(locale, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: evidence.timeZone,
        }).format(new Date(instant));
      } catch {
        /* Keep unknown context for an invalid legacy zone. */
      }
    }
    if (evidence.kind === 'current') {
      return t('observationEvidence', { timestamp, timeZone: evidence.timeZone });
    }
    const date = evidence.date
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
          new Date(`${evidence.date}T00:00:00Z`),
        )
      : '';
    return t('forecastEvidence', {
      kind: t(evidence.kind === 'archived' ? 'archivedForecast' : 'forecastCue'),
      date,
      timeZone: evidence.timeZone,
      retrieval:
        instant === null || instant === undefined
          ? t('retrievalUnknown')
          : t('retrievedAt', { timestamp }),
    });
  };
}
