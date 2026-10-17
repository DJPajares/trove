'use client';

import { useLocale, useTranslations } from 'next-intl';

/** Date and source context for weather links, without acquisition metadata. */
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
    if (evidence.kind === 'current') {
      return t('currentEvidence', { timeZone: evidence.timeZone });
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
    });
  };
}
