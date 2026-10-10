'use client';
import { Clock3 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { usePreferences } from '@/components/preferences-provider';
import { Button } from '@/components/ui/button';
import {
  fetchItineraryDayTimeSuggestions,
  type ItineraryDayTimeSuggestion,
  type RequestedSchedule,
  type SuggestedTimeCandidate,
} from '@/lib/itinerary/api';
import {
  describeSuggestedTime,
  formatSuggestedDuration,
  formatSuggestedClock,
} from '@/lib/itinerary/day-time-suggestions';

type SuggestedTimeRequest = {
  candidate?: SuggestedTimeCandidate;
  dayId: string;
  itemId?: string;
  schedule: RequestedSchedule;
  durationMinutes?: number | null;
  localTime?: string;
  localEndTime?: string;
  autoApply?: boolean;
};
export function useSuggestedTime(
  tripId: string,
  onSuggested: (slot: ItineraryDayTimeSuggestion, revision?: string) => void,
) {
  const t = useTranslations('itinerary');
  const [suggestion, setSuggestion] = useState<ItineraryDayTimeSuggestion | null>(null);
  const [revision, setRevision] = useState<string>();
  const [status, setStatus] = useState<'error' | 'idle' | 'loading'>('idle');
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => () => inFlight.current?.abort(), []);
  const reset = useCallback(() => {
    inFlight.current?.abort();
    setSuggestion(null);
    setRevision(undefined);
    setStatus('idle');
  }, []);
  async function request({ autoApply, ...options }: SuggestedTimeRequest) {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setSuggestion(null);
    setStatus('loading');
    try {
      const response = await fetchItineraryDayTimeSuggestions(tripId, options.dayId, {
        ...options,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const next = response.suggestions[0] ?? null;
      setSuggestion(next);
      setRevision(response.scheduleRevision);
      setStatus('idle');
      if (autoApply && next) onSuggested(next, response.scheduleRevision);
    } catch {
      if (!controller.signal.aborted) setStatus('error');
    }
  }
  const message = useMemo(
    () =>
      status === 'loading'
        ? t('suggestedTime.loading')
        : status === 'error'
          ? t('suggestedTime.unavailable')
          : suggestion
            ? describeSuggestedTime(suggestion, t)
            : '',
    [status, suggestion, t],
  );
  return {
    loading: status === 'loading',
    message,
    suggestion,
    request,
    reset,
    apply: () => {
      if (suggestion?.status === 'ok') onSuggested(suggestion, revision);
    },
  };
}
export type SuggestedTimeActionProps = {
  loading: boolean;
  message: string;
  suggestion?: ItineraryDayTimeSuggestion | null;
  onRequest: () => void;
  onApply?: () => void;
};
export function SuggestedTimeAction({
  loading,
  message,
  suggestion,
  onRequest,
  onApply,
}: Readonly<SuggestedTimeActionProps>) {
  const t = useTranslations('itinerary');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const id = useId();
  const clock = (time: string) =>
    formatSuggestedClock(time, locale, preferences.timeFormat === '12h');
  return (
    <div className="space-y-2">
      <Button
        aria-busy={loading}
        aria-describedby={id}
        className="self-start"
        disabled={loading}
        onClick={onRequest}
        size="sm"
        type="button"
        variant="outline"
      >
        <Clock3 aria-hidden="true" />
        {t('suggestedTime.action')}
      </Button>
      {suggestion?.status === 'ok' && suggestion.localTime && suggestion.localEndTime ? (
        <div className="space-y-2 rounded-[var(--radius-md)] bg-muted/50 p-3">
          <p className="text-sm font-medium tabular-nums">
            {clock(suggestion.localTime)}–{clock(suggestion.localEndTime)} ·{' '}
            {formatSuggestedDuration(suggestion.durationMinutes ?? 0, t)}
          </p>
          <p className="text-sm text-muted-foreground">
            {message}
            {suggestion.affectedItemIds?.length
              ? ` ${t('connectedTiming.affected', { count: suggestion.affectedItemIds.length })}`
              : ''}
          </p>
          <Button onClick={onApply} size="sm" type="button" variant="secondary">
            {t('suggestedTime.use')}
          </Button>
        </div>
      ) : null}
      <p aria-live="polite" className="text-sm text-muted-foreground" id={id} role="status">
        {suggestion?.status === 'ok' ? <span className="sr-only">{message}</span> : message}
      </p>
    </div>
  );
}
