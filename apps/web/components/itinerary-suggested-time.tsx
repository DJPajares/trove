'use client';

import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { describeSuggestedTime } from '@/lib/itinerary/day-time-suggestions';
import {
  fetchItineraryDayTimeSuggestions,
  type ItineraryDayTimeSuggestion,
  type RequestedSchedule,
  type SuggestedTimeCandidate,
} from '@/lib/itinerary/api';

type SuggestedTimeRequest = {
  dayId: string;
  /** Set when the stop is still being added and has no id yet. */
  candidate?: SuggestedTimeCandidate;
  itemId?: string;
  /** The choice on screen, not the one on disk, so an unsaved daypart shapes the answer. */
  schedule: RequestedSchedule;
};

/**
 * Asks the server for a start time for one stop and explains the answer. The
 * proposal is only ever handed to `onSuggested`, so it stays form state until
 * the traveller saves, and abandoning the editor discards it (PRD section 29.4).
 */
export function useSuggestedTime(tripId: string, onSuggested: (localTime: string) => void) {
  const t = useTranslations('itinerary');
  const [suggestion, setSuggestion] = useState<ItineraryDayTimeSuggestion | null>(null);
  const [status, setStatus] = useState<'error' | 'idle' | 'loading'>('idle');
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  const reset = useCallback(() => {
    inFlight.current?.abort();
    setSuggestion(null);
    setStatus('idle');
  }, []);

  async function request({ candidate, dayId, itemId, schedule }: SuggestedTimeRequest) {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setSuggestion(null);
    setStatus('loading');

    try {
      const response = await fetchItineraryDayTimeSuggestions(tripId, dayId, {
        candidate,
        itemId,
        schedule,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

      const next = response.suggestions[0] ?? null;
      setSuggestion(next);
      setStatus('idle');
      if (next?.status === 'ok' && next.localTime) onSuggested(next.localTime);
    } catch {
      if (!controller.signal.aborted) setStatus('error');
    }
  }

  const message = useMemo(() => {
    if (status === 'loading') return t('suggestedTime.loading');
    if (status === 'error') return t('suggestedTime.unavailable');
    if (!suggestion) return '';
    return describeSuggestedTime(suggestion, t);
  }, [status, suggestion, t]);

  return { loading: status === 'loading', message, request, reset };
}

export function SuggestedTimeAction({
  loading,
  message,
  onRequest,
}: Readonly<{ loading: boolean; message: string; onRequest: () => void }>) {
  const t = useTranslations('itinerary');

  return (
    <>
      <Button
        aria-busy={loading}
        aria-describedby="itinerary-suggested-time-status"
        className="self-start"
        disabled={loading}
        onClick={onRequest}
        size="sm"
        type="button"
        variant="outline"
      >
        <Sparkles aria-hidden="true" />
        {t('suggestedTime.action')}
      </Button>
      <p
        aria-live="polite"
        className="text-sm text-muted-foreground"
        id="itinerary-suggested-time-status"
        role="status"
      >
        {message}
      </p>
    </>
  );
}
