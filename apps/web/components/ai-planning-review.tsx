'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  MapPinned,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { ItineraryPlanningMap } from '@/components/itinerary-planning-map';
import { PageState } from '@/components/page-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  acknowledgeAiPlanningWarnings,
  AiPlanningApiError,
  applyAiPlanningSession,
  fetchAiPlanningSession,
  recheckAiPlanningItem,
  regenerateAiPlanningSession,
  replaceAiPlanningDraft,
  replaceAiPlanningItemPlace,
  verifyAiPlanningCustomPlace,
  type AiPlanningSession,
  type AiPlanningDraft,
  type AiPlanningDraftItem,
} from '@/lib/ai-planning/api';
import { buildAiPlanningReviewMapPoints } from '@/lib/ai-planning/review';
import {
  aiPlanningErrorMessageKey,
  isAiPlanningSessionGenerating,
} from '@/lib/ai-planning/presentation';
import {
  GOOGLE_PLACES_SEARCH_DEBOUNCE_MS,
  searchProviderPlaces,
  type ProviderSuggestion,
} from '@/lib/saved/api';
import { queryKeys } from '@/lib/query/keys';
import type { Trip } from '@/lib/trips/api';

const ACTIVE_SESSION_POLL_MS = 1_500;

type ReviewOperation = 'acknowledging' | 'applying' | 'idle' | 'saving' | 'verifying';

function allItems(draft: AiPlanningDraft) {
  return [...draft.days.flatMap((day) => day.items), ...draft.unscheduledItems];
}

function withItem(
  draft: AiPlanningDraft,
  itemId: string,
  update: (item: AiPlanningDraftItem) => AiPlanningDraftItem,
) {
  return {
    ...draft,
    days: draft.days.map((day) => ({
      ...day,
      items: day.items.map((item) => (item.id === itemId ? update(item) : item)),
    })),
    unscheduledItems: draft.unscheduledItems.map((item) =>
      item.id === itemId ? update(item) : item,
    ),
  };
}

function withPlace(
  draft: AiPlanningDraft,
  placeId: string,
  update: (place: AiPlanningDraft['places'][number]) => AiPlanningDraft['places'][number],
) {
  return {
    ...draft,
    places: draft.places.map((place) => (place.id === placeId ? update(place) : place)),
  };
}

function removeItem(draft: AiPlanningDraft, itemId: string) {
  return {
    ...draft,
    days: draft.days.map((day) => ({
      ...day,
      items: day.items.filter((item) => item.id !== itemId),
    })),
    unscheduledItems: draft.unscheduledItems.filter((item) => item.id !== itemId),
  };
}

function reorderItem(
  draft: AiPlanningDraft,
  dayIndex: number,
  itemIndex: number,
  direction: -1 | 1,
) {
  const items = [...draft.days[dayIndex]!.items];
  const target = itemIndex + direction;
  if (target < 0 || target >= items.length) return draft;
  const [item] = items.splice(itemIndex, 1);
  if (!item) return draft;
  items.splice(target, 0, item);
  return {
    ...draft,
    days: draft.days.map((day, index) => (index === dayIndex ? { ...day, items } : day)),
  };
}

function moveItem(draft: AiPlanningDraft, itemId: string, destination: string) {
  const item = allItems(draft).find((candidate) => candidate.id === itemId);
  if (!item) return draft;
  const removed = removeItem(draft, itemId);
  if (destination === 'unscheduled') {
    return { ...removed, unscheduledItems: [...removed.unscheduledItems, item] };
  }
  return {
    ...removed,
    days: removed.days.map((day) =>
      day.date === destination ? { ...day, items: [...day.items, item] } : day,
    ),
  };
}

export function AiPlanningReview({ sessionId }: Readonly<{ sessionId: string }>) {
  const t = useTranslations('trips.aiPlanning.review');
  const general = useTranslations('trips.aiPlanning');
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryFn: () => fetchAiPlanningSession(sessionId),
    queryKey: queryKeys.aiPlanningSession(sessionId),
    refetchInterval: (query) =>
      query.state.data?.session && isAiPlanningSessionGenerating(query.state.data.session.status)
        ? ACTIVE_SESSION_POLL_MS
        : false,
  });
  const session = sessionQuery.data?.session ?? null;
  const [draft, setDraft] = useState<AiPlanningDraft | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [operation, setOperation] = useState<ReviewOperation>('idle');
  const [error, setError] = useState<string | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  const [regeneratePrompt, setRegeneratePrompt] = useState('');
  const [placeQuery, setPlaceQuery] = useState('');
  const [suggestions, setSuggestions] = useState<ProviderSuggestion[]>([]);
  const [suggestionSessionToken, setSuggestionSessionToken] = useState<string | undefined>();

  useEffect(() => {
    if (!session?.draft) return;
    setDraft(session.draft);
    setRegeneratePrompt(session.prompt ?? '');
  }, [session?.draft, session?.draftRevision, session?.prompt]);

  useEffect(() => {
    if (!session?.appliedTripId) return;
    router.replace(`/trips/${session.appliedTripId}`);
  }, [router, session?.appliedTripId]);

  useEffect(() => {
    if (!editingItemId || placeQuery.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void searchProviderPlaces(placeQuery, controller.signal)
        .then((result) => {
          if (result.status === 'ok') {
            setSuggestions(result.suggestions);
            setSuggestionSessionToken(result.sessionToken);
          } else {
            setSuggestions([]);
          }
        })
        .catch(() => setSuggestions([]));
    }, GOOGLE_PLACES_SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [editingItemId, placeQuery]);

  const publishing = operation !== 'idle';
  const reviewing = session?.status === 'reviewing';
  const materialWarnings = draft?.warnings.filter((warning) => warning.material) ?? [];
  const warningsAcknowledged =
    session?.warningAcknowledgement?.revision === session?.draftRevision &&
    materialWarnings.length > 0;
  const canApply = Boolean(
    reviewing && draft && (!materialWarnings.length || warningsAcknowledged),
  );
  const selectedMapPoints = useMemo(
    () => (draft ? buildAiPlanningReviewMapPoints(draft) : []),
    [draft],
  );
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
        weekday: 'short',
      }),
    [locale],
  );

  function publish(next: AiPlanningSession) {
    queryClient.setQueryData(queryKeys.aiPlanningSession(sessionId), { session: next });
    queryClient.setQueryData(queryKeys.aiPlanningRecovery(), { session: next });
  }

  async function save(next: AiPlanningDraft) {
    if (!session || !reviewing || publishing) return;
    setDraft(next);
    setOperation('saving');
    setError(null);
    try {
      publish((await replaceAiPlanningDraft(session.id, next, session.draftRevision)).session);
    } catch (cause) {
      setError(cause instanceof AiPlanningApiError ? cause.code : 'request_failed');
      void sessionQuery.refetch();
    } finally {
      setOperation('idle');
    }
  }

  async function runRecheck(itemId: string) {
    if (!session || publishing) return;
    setOperation('verifying');
    setError(null);
    try {
      publish((await recheckAiPlanningItem(session.id, itemId, session.draftRevision)).session);
    } catch (cause) {
      setError(cause instanceof AiPlanningApiError ? cause.code : 'request_failed');
    } finally {
      setOperation('idle');
    }
  }

  async function verifyPlace(placeRefId: string) {
    if (!session || publishing) return;
    setOperation('verifying');
    setError(null);
    try {
      publish(
        (await verifyAiPlanningCustomPlace(session.id, placeRefId, session.draftRevision)).session,
      );
    } catch (cause) {
      setError(cause instanceof AiPlanningApiError ? cause.code : 'request_failed');
    } finally {
      setOperation('idle');
    }
  }

  async function replacePlace(suggestion: ProviderSuggestion) {
    if (!session || !editingItemId || publishing) return;
    setOperation('verifying');
    setError(null);
    try {
      publish(
        (
          await replaceAiPlanningItemPlace(session.id, editingItemId, {
            expectedRevision: session.draftRevision,
            externalPlaceId: suggestion.externalPlaceId,
            sessionToken: suggestionSessionToken,
          })
        ).session,
      );
      setPlaceQuery('');
      setSuggestions([]);
    } catch (cause) {
      setError(cause instanceof AiPlanningApiError ? cause.code : 'request_failed');
    } finally {
      setOperation('idle');
    }
  }

  async function acknowledgeWarnings() {
    if (!session || publishing) return;
    setOperation('acknowledging');
    setError(null);
    try {
      publish((await acknowledgeAiPlanningWarnings(session.id, session.draftRevision)).session);
    } catch (cause) {
      setError(cause instanceof AiPlanningApiError ? cause.code : 'request_failed');
    } finally {
      setOperation('idle');
    }
  }

  async function regenerate() {
    if (!session || publishing || !regeneratePrompt.trim()) return;
    setOperation('saving');
    setError(null);
    try {
      publish(
        (
          await regenerateAiPlanningSession(
            session.id,
            regeneratePrompt,
            session.draftRevision,
            crypto.randomUUID(),
          )
        ).session,
      );
    } catch (cause) {
      setError(cause instanceof AiPlanningApiError ? cause.code : 'request_failed');
    } finally {
      setOperation('idle');
    }
  }

  async function apply() {
    if (!session || !canApply || publishing) return;
    setOperation('applying');
    setError(null);
    try {
      const deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
      const result = await applyAiPlanningSession(
        session.id,
        session.draftRevision,
        deviceTimeZone,
      );
      queryClient.setQueryData(queryKeys.trips(), (current: { trips: Trip[] } | undefined) =>
        current ? { ...current, trips: [...current.trips, result.trip] } : current,
      );
      router.replace(`/trips/${result.trip.id}`);
    } catch (cause) {
      setError(cause instanceof AiPlanningApiError ? cause.code : 'request_failed');
      setConfirmApply(false);
    } finally {
      setOperation('idle');
    }
  }

  if (sessionQuery.isPending) {
    return <PageState kind="loading" loadingShape="text" scope="page" title={t('loading')} />;
  }
  if (!session || !draft || session.status === 'cancelled' || session.status === 'expired') {
    return (
      <PageState
        actions={<Button onClick={() => router.push('/trips')}>{t('backToTrips')}</Button>}
        description={t('unavailableDescription')}
        icon={<CircleAlert aria-hidden="true" />}
        kind="error"
        scope="page"
        title={t('unavailableTitle')}
      />
    );
  }

  return (
    <section className="mx-auto max-w-7xl space-y-6 pb-28" aria-labelledby="ai-review-title">
      <header className="flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-brand">{t('eyebrow')}</p>
          <h1
            className="mt-1 text-[length:var(--text-page-title)] font-semibold tracking-[-0.035em]"
            id="ai-review-title"
          >
            {draft.trip.name}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('description')}</p>
        </div>
        <Button disabled={!reviewing || publishing} onClick={() => void save(draft)}>
          {operation === 'saving' ? t('saving') : t('save')}
        </Button>
      </header>

      {isAiPlanningSessionGenerating(session.status) ? (
        <Alert role="status" variant="info">
          <Sparkles aria-hidden="true" />
          <AlertTitle>{general(`stages.${session.stage}`)}</AlertTitle>
          <AlertDescription>{t('regeneratingHint')}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>{general(`errors.${aiPlanningErrorMessageKey(error)}`)}</AlertTitle>
          <AlertDescription>{t('errorHint')}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.8fr)]">
        <div className="space-y-6">
          <section className="rounded-[var(--radius-xl)] border border-border bg-card p-4 shadow-[var(--shadow-surface)] sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="review-trip-name">{t('tripName')}</FieldLabel>
                <Input
                  disabled={!reviewing || publishing}
                  id="review-trip-name"
                  onChange={(event) =>
                    setDraft({ ...draft, trip: { ...draft.trip, name: event.target.value } })
                  }
                  value={draft.trip.name}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="review-party-size">{t('partySize')}</FieldLabel>
                <Input
                  disabled={!reviewing || publishing}
                  id="review-party-size"
                  max={99}
                  min={1}
                  onChange={(event) => {
                    const partySize = Math.max(1, Math.min(99, Number(event.target.value) || 1));
                    setDraft({ ...draft, trip: { ...draft.trip, partySize } });
                  }}
                  type="number"
                  value={draft.trip.partySize}
                />
              </Field>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              {draft.trip.startDate} - {draft.trip.endDate}
            </p>
          </section>

          {draft.assumptions.length ? (
            <section
              className="rounded-[var(--radius-xl)] border border-border bg-card p-4 sm:p-6"
              aria-labelledby="ai-review-assumptions"
            >
              <h2 className="font-semibold" id="ai-review-assumptions">
                {t('assumptions')}
              </h2>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                {draft.assumptions.map((assumption) => (
                  <li key={assumption.id}>
                    {assumption.rationale ?? t(`assumptionCodes.${assumption.code}`)}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="space-y-4" aria-labelledby="ai-review-itinerary">
            <div>
              <h2 className="text-lg font-semibold" id="ai-review-itinerary">
                {t('itinerary')}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('itineraryDescription')}</p>
            </div>
            {draft.days.map((day, dayIndex) => (
              <article
                className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card"
                key={day.date}
              >
                <header className="border-b border-border px-4 py-4 sm:px-6">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t('day', { number: dayIndex + 1 })}
                  </p>
                  <h3 className="mt-1 font-semibold">
                    {dateFormatter.format(new Date(`${day.date}T00:00:00.000Z`))}
                  </h3>
                </header>
                <ol className="divide-y divide-border-subtle">
                  {day.items.map((item, itemIndex) => {
                    const place = item.placeRefId
                      ? draft.places.find((candidate) => candidate.id === item.placeRefId)
                      : null;
                    const editing = editingItemId === item.id;
                    return (
                      <li className="p-4 sm:px-6" key={item.id}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">{item.label}</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {item.schedule.kind === 'exact'
                                ? item.schedule.localTime
                                : t(`dayParts.${item.schedule.dayPart}`)}{' '}
                              · {t('duration', { minutes: item.durationMinutes })}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {item.origin === 'user' ? t('travelerSupplied') : t('aiSuggested')}
                            </p>
                            {place ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {place.resolution === 'verified'
                                  ? t('verifiedPlace')
                                  : t(`customPlace.${place.verification}`)}
                              </p>
                            ) : null}
                            {place?.resolution === 'verified' ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {t('providerAttribution')}:{' '}
                                {place.attributions.length
                                  ? place.attributions.map((attribution, index) =>
                                      attribution.providerUri ? (
                                        <a
                                          className="underline underline-offset-2"
                                          href={attribution.providerUri}
                                          key={`${attribution.provider}-${index}`}
                                          rel="noreferrer"
                                          target="_blank"
                                        >
                                          {attribution.provider}
                                        </a>
                                      ) : (
                                        <span key={`${attribution.provider}-${index}`}>
                                          {attribution.provider}
                                        </span>
                                      ),
                                    )
                                  : t('googleAttribution')}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            <Button
                              disabled={!reviewing || publishing || itemIndex === 0}
                              onClick={() => void save(reorderItem(draft, dayIndex, itemIndex, -1))}
                              size="icon-sm"
                              title={t('moveEarlier')}
                              type="button"
                              variant="ghost"
                            >
                              <ArrowUp aria-hidden="true" />
                            </Button>
                            <Button
                              disabled={
                                !reviewing || publishing || itemIndex === day.items.length - 1
                              }
                              onClick={() => void save(reorderItem(draft, dayIndex, itemIndex, 1))}
                              size="icon-sm"
                              title={t('moveLater')}
                              type="button"
                              variant="ghost"
                            >
                              <ArrowDown aria-hidden="true" />
                            </Button>
                            <Button
                              disabled={!reviewing || publishing}
                              onClick={() => {
                                setEditingItemId(editing ? null : item.id);
                                setPlaceQuery('');
                              }}
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              {editing ? t('closeEditor') : t('editItem')}
                            </Button>
                          </div>
                        </div>
                        {editing ? (
                          <div className="mt-4 grid gap-4 border-t border-border-subtle pt-4">
                            <div className="grid gap-4 sm:grid-cols-2">
                              <Field>
                                <FieldLabel htmlFor={`schedule-${item.id}`}>
                                  {t('schedule')}
                                </FieldLabel>
                                <select
                                  className="h-11 rounded-[var(--radius-md)] border border-input bg-background px-3 text-sm"
                                  disabled={!reviewing || publishing}
                                  id={`schedule-${item.id}`}
                                  onChange={(event) =>
                                    void save(
                                      withItem(draft, item.id, (current) =>
                                        event.target.value === 'exact'
                                          ? {
                                              ...current,
                                              schedule: {
                                                kind: 'exact',
                                                localTime:
                                                  current.schedule.kind === 'exact'
                                                    ? current.schedule.localTime
                                                    : '12:00',
                                                source: 'user',
                                              },
                                            }
                                          : {
                                              ...current,
                                              schedule: {
                                                dayPart: event.target.value as
                                                  'morning' | 'afternoon' | 'evening' | 'anytime',
                                                kind: 'day_part',
                                              },
                                            },
                                      ),
                                    )
                                  }
                                  value={
                                    item.schedule.kind === 'day_part'
                                      ? item.schedule.dayPart
                                      : 'exact'
                                  }
                                >
                                  <option value="morning">{t('dayParts.morning')}</option>
                                  <option value="afternoon">{t('dayParts.afternoon')}</option>
                                  <option value="evening">{t('dayParts.evening')}</option>
                                  <option value="anytime">{t('dayParts.anytime')}</option>
                                  <option value="exact">{t('scheduleExact')}</option>
                                </select>
                              </Field>
                              {item.schedule.kind === 'exact' ? (
                                <Field>
                                  <FieldLabel htmlFor={`time-${item.id}`}>
                                    {t('exactTime')}
                                  </FieldLabel>
                                  <Input
                                    disabled={!reviewing || publishing}
                                    id={`time-${item.id}`}
                                    onChange={(event) =>
                                      setDraft(
                                        withItem(draft, item.id, (current) => ({
                                          ...current,
                                          schedule: {
                                            kind: 'exact',
                                            localTime: event.target.value,
                                            source: 'user',
                                          },
                                        })),
                                      )
                                    }
                                    type="time"
                                    value={item.schedule.localTime}
                                  />
                                </Field>
                              ) : null}
                              <Field>
                                <FieldLabel htmlFor={`duration-${item.id}`}>
                                  {t('durationLabel')}
                                </FieldLabel>
                                <Input
                                  disabled={!reviewing || publishing}
                                  id={`duration-${item.id}`}
                                  min={1}
                                  onChange={(event) =>
                                    setDraft(
                                      withItem(draft, item.id, (current) => ({
                                        ...current,
                                        durationMinutes: Math.max(
                                          1,
                                          Number(event.target.value) || 1,
                                        ),
                                      })),
                                    )
                                  }
                                  type="number"
                                  value={item.durationMinutes}
                                />
                                <FieldDescription>
                                  {item.durationProvenance === 'ai_estimated'
                                    ? t('durationEstimated')
                                    : t('durationOwned')}
                                </FieldDescription>
                              </Field>
                              <Field>
                                <FieldLabel htmlFor={`priority-${item.id}`}>
                                  {t('priority')}
                                </FieldLabel>
                                <select
                                  className="h-11 rounded-[var(--radius-md)] border border-input bg-background px-3 text-sm"
                                  disabled={!reviewing || publishing}
                                  id={`priority-${item.id}`}
                                  onChange={(event) =>
                                    void save(
                                      withItem(draft, item.id, (current) => ({
                                        ...current,
                                        priority: event.target.value
                                          ? (event.target.value as
                                              'must_go' | 'interested' | 'maybe')
                                          : null,
                                      })),
                                    )
                                  }
                                  value={item.priority ?? ''}
                                >
                                  <option value="">{t('priorityNone')}</option>
                                  <option value="must_go">{t('priorities.must_go')}</option>
                                  <option value="interested">{t('priorities.interested')}</option>
                                  <option value="maybe">{t('priorities.maybe')}</option>
                                </select>
                              </Field>
                            </div>
                            <Field>
                              <FieldLabel htmlFor={`notes-${item.id}`}>{t('notes')}</FieldLabel>
                              <Textarea
                                disabled={!reviewing || publishing}
                                id={`notes-${item.id}`}
                                onChange={(event) =>
                                  setDraft(
                                    withItem(draft, item.id, (current) => ({
                                      ...current,
                                      notes: event.target.value || null,
                                    })),
                                  )
                                }
                                value={item.notes ?? ''}
                              />
                            </Field>
                            {place?.resolution === 'custom' ? (
                              <Field>
                                <FieldLabel htmlFor={`custom-place-${item.id}`}>
                                  {t('customPlaceText')}
                                </FieldLabel>
                                <Input
                                  disabled={!reviewing || publishing}
                                  id={`custom-place-${item.id}`}
                                  onChange={(event) =>
                                    setDraft(
                                      withPlace(draft, place.id, (current) =>
                                        current.resolution === 'custom'
                                          ? { ...current, name: event.target.value }
                                          : current,
                                      ),
                                    )
                                  }
                                  value={place.name}
                                />
                                <FieldDescription>{t('saveBeforeVerify')}</FieldDescription>
                              </Field>
                            ) : null}
                            <div className="flex flex-wrap gap-2">
                              <select
                                aria-label={t('moveTo')}
                                className="h-9 rounded-[var(--radius-md)] border border-input bg-background px-2 text-sm"
                                defaultValue=""
                                disabled={!reviewing || publishing}
                                onChange={(event) => {
                                  if (event.target.value)
                                    void save(moveItem(draft, item.id, event.target.value));
                                  event.currentTarget.value = '';
                                }}
                              >
                                <option disabled value="">
                                  {t('moveTo')}
                                </option>
                                <option value="unscheduled">{t('unscheduled')}</option>
                                {draft.days
                                  .filter((candidate) => candidate.date !== day.date)
                                  .map((candidate) => (
                                    <option key={candidate.date} value={candidate.date}>
                                      {candidate.date}
                                    </option>
                                  ))}
                              </select>
                              <Button
                                disabled={!reviewing || publishing}
                                onClick={() => void save(removeItem(draft, item.id))}
                                size="sm"
                                type="button"
                                variant="destructive"
                              >
                                <Trash2 aria-hidden="true" data-icon="inline-start" />
                                {t('remove')}
                              </Button>
                              {place?.resolution === 'verified' ? (
                                <Button
                                  disabled={!reviewing || publishing}
                                  onClick={() => void runRecheck(item.id)}
                                  size="sm"
                                  type="button"
                                  variant="outline"
                                >
                                  <RefreshCw aria-hidden="true" data-icon="inline-start" />
                                  {t('recheck')}
                                </Button>
                              ) : null}
                              {place?.resolution === 'custom' ? (
                                <Button
                                  disabled={!reviewing || publishing}
                                  onClick={() => void verifyPlace(place.id)}
                                  size="sm"
                                  type="button"
                                  variant="outline"
                                >
                                  <ShieldCheck aria-hidden="true" data-icon="inline-start" />
                                  {t('verifyPlace')}
                                </Button>
                              ) : null}
                            </div>
                            <Field>
                              <FieldLabel htmlFor={`replace-place-${item.id}`}>
                                {t('replacePlace')}
                              </FieldLabel>
                              <Input
                                disabled={!reviewing || publishing}
                                id={`replace-place-${item.id}`}
                                onChange={(event) => setPlaceQuery(event.target.value)}
                                placeholder={t('replacePlaceholder')}
                                value={placeQuery}
                              />
                              {suggestions.length ? (
                                <ul className="mt-2 rounded-[var(--radius-md)] border border-border p-1">
                                  {suggestions.map((suggestion) => (
                                    <li key={suggestion.externalPlaceId}>
                                      <Button
                                        className="w-full justify-start"
                                        disabled={publishing}
                                        onClick={() => void replacePlace(suggestion)}
                                        type="button"
                                        variant="ghost"
                                      >
                                        <Search aria-hidden="true" data-icon="inline-start" />
                                        {suggestion.name}
                                      </Button>
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                            </Field>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                  {!day.items.length ? (
                    <li className="p-4 text-sm text-muted-foreground sm:px-6">{t('emptyDay')}</li>
                  ) : null}
                </ol>
              </article>
            ))}
          </section>

          {draft.unscheduledItems.length ? (
            <section className="rounded-[var(--radius-xl)] border border-border bg-card p-4 sm:p-6">
              <h2 className="font-semibold">{t('unscheduled')}</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {draft.unscheduledItems.map((item) => (
                  <li className="flex items-center justify-between gap-3" key={item.id}>
                    <span>{item.label}</span>
                    <Button
                      disabled={!reviewing || publishing}
                      onClick={() => setEditingItemId(item.id)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {t('editItem')}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <section
            className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card"
            aria-label={t('mapLabel')}
          >
            {selectedMapPoints.length ? (
              <ItineraryPlanningMap
                onClearSelection={() => setSelectedPointId(null)}
                onSelectPoint={(point) => setSelectedPointId(point.id)}
                onViewItem={(itemId) => setEditingItemId(itemId)}
                points={selectedMapPoints}
                routeLines={[]}
                selectedPointId={selectedPointId}
              />
            ) : (
              <div className="p-6 text-sm text-muted-foreground">
                <MapPinned aria-hidden="true" className="mb-3 size-5 text-brand" />
                {t('mapUnavailable')}
              </div>
            )}
          </section>
          <section
            className="rounded-[var(--radius-xl)] border border-border bg-card p-4 sm:p-6"
            aria-labelledby="ai-review-evidence"
          >
            <h2 className="font-semibold" id="ai-review-evidence">
              {t('evidence')}
            </h2>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {draft.evidence.map((evidence) => (
                <li key={evidence.id}>
                  {t(`evidenceStatus.${evidence.status}`)}
                  {evidence.provider ? ` · ${evidence.provider}` : ''}
                </li>
              ))}
            </ul>
          </section>
          <section
            className="rounded-[var(--radius-xl)] border border-border bg-card p-4 sm:p-6"
            aria-labelledby="ai-review-regenerate"
          >
            <h2 className="font-semibold" id="ai-review-regenerate">
              {t('regenerate')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('regenerateDescription')}</p>
            <Textarea
              className="mt-3"
              disabled={publishing}
              onChange={(event) => setRegeneratePrompt(event.target.value)}
              value={regeneratePrompt}
            />
            <Button
              className="mt-3"
              disabled={publishing || !regeneratePrompt.trim()}
              onClick={() => void regenerate()}
              size="sm"
              type="button"
              variant="outline"
            >
              <Sparkles aria-hidden="true" data-icon="inline-start" />
              {t('regenerateAction')}
            </Button>
          </section>
        </aside>
      </div>

      {materialWarnings.length ? (
        <Alert role="alert" variant="warning">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>{t('materialWarnings')}</AlertTitle>
          <AlertDescription>
            {warningsAcknowledged ? t('warningsAcknowledged') : t('warningsNeedAcknowledgement')}
          </AlertDescription>
          <p className="text-sm text-muted-foreground">
            {t('warningAffects', {
              count: materialWarnings.reduce((total, warning) => total + warning.itemIds.length, 0),
            })}
          </p>
          {!warningsAcknowledged ? (
            <Button
              disabled={!reviewing || publishing}
              onClick={() => void acknowledgeWarnings()}
              size="sm"
              type="button"
              variant="outline"
            >
              {operation === 'acknowledging' ? t('acknowledging') : t('acknowledgeWarnings')}
            </Button>
          ) : null}
        </Alert>
      ) : null}

      <div className="fixed right-[var(--gutter-inline-end)] bottom-[calc(var(--bottom-bar-height)+var(--safe-bottom)+1rem)] z-20">
        <Button disabled={!canApply || publishing} onClick={() => setConfirmApply(true)}>
          {t('apply')}
        </Button>
      </div>
      <Dialog onOpenChange={setConfirmApply} open={confirmApply}>
        <DialogContent closeLabel={t('close')}>
          <DialogHeader>
            <DialogTitle>{t('confirmTitle')}</DialogTitle>
            <DialogDescription>{t('confirmDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={operation === 'applying'}
              onClick={() => setConfirmApply(false)}
              type="button"
              variant="ghost"
            >
              {t('notYet')}
            </Button>
            <Button disabled={operation === 'applying'} onClick={() => void apply()} type="button">
              {operation === 'applying' ? t('applying') : t('confirmApply')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
