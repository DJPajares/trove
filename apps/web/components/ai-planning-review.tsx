'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CircleAlert, CircleCheck } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ItineraryPlanningMap } from '@/components/itinerary-planning-map';
import { CountryMultiCombobox } from '@/components/country-multi-combobox';
import { PageState } from '@/components/page-state';
import { composeInsights } from '@/lib/insights/compose';
import { assessmentDeadline, currentAssessment } from '@/lib/plan-score/presentation';
import { serverNow } from '@/lib/plan-score/clock';
import {
  assessmentChange,
  rememberAssessment,
  startCanonicalPlanScoreRead,
} from '@/lib/plan-score/lifecycle';
import { fetchTripPlanScore } from '@/lib/plan-score/api';
import { PlanScorePanel } from '@/components/plan-score-panel';
import { TripInsightsPanel } from '@/components/trip-insights-panel';
import { usePreferences } from '@/components/preferences-provider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  AiPlanningApiError,
  applyAiPlanningSession,
  fetchAiPlanningSession,
  regenerateAiPlanningSession,
  setAiPlanningTripDescription,
  setAiPlanningTripName,
  setAiPlanningCountries,
  type AiPlanningSession,
  type AiPlanningDraft,
} from '@/lib/ai-planning/api';
import {
  activeAiPlanningAssumptions,
  aiPlanningAssumptionMessageValues,
  aiPlanningReviewPageState,
  aiPlanningCountriesReviewed,
  aiPlanningCountrySaveIsCurrent,
  prepareAiPlanningCountriesForApply,
  appliedAiPlanningSession,
  buildAiPlanningReviewMapPoints,
  isAiPlanningSessionExpired,
} from '@/lib/ai-planning/review';
import {
  aiPlanningErrorMessageKey,
  isAiPlanningSessionGenerating,
} from '@/lib/ai-planning/presentation';
import { motionDuration, motionEase } from '@/lib/motion';
import { queryKeys } from '@/lib/query/keys';
import { formatSegmentedTime } from '@/lib/time/time-segments';
import type { Trip } from '@/lib/trips/api';
import * as Icons from '@/lib/icons';

const INITIAL_SESSION_POLL_MS = 3_000;
const LATER_SESSION_POLL_MS = 5_000;

type ReviewOperation = 'applying' | 'idle' | 'regenerating';

export function AiPlanningReview({
  sessionId,
  planScoreEnabled,
}: Readonly<{ sessionId: string; planScoreEnabled: boolean }>) {
  const t = useTranslations('trips.aiPlanning.review');
  const general = useTranslations('trips.aiPlanning');
  const planScoreCopy = useTranslations('planScore');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const reducedMotion = useReducedMotion();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [clock, setClock] = useState(() => Date.now());
  const sessionQuery = useQuery({
    queryFn: () => fetchAiPlanningSession(sessionId),
    queryKey: queryKeys.aiPlanningSession(sessionId),
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const session = sessionQuery.data?.session ?? null;
  const lastDraftRefreshEvent = useRef<string | null>(null);
  useEffect(() => {
    if (!planScoreEnabled || session?.status !== 'reviewing' || session.countryContextChanged)
      return;
    const deadline = session.planScore ? assessmentDeadline(session.planScore) : Number.NaN;
    if (!Number.isFinite(deadline) || deadline <= serverNow()) return;
    const timer = window.setTimeout(
      () => setClock(Date.now()),
      Math.max(0, deadline - serverNow() + 1),
    );
    return () => window.clearTimeout(timer);
  }, [planScoreEnabled, session?.status, session?.countryContextChanged, session?.planScore]);
  useEffect(() => {
    if (
      !planScoreEnabled ||
      session?.status !== 'reviewing' ||
      session.countryContextChanged ||
      (session.planScore &&
        currentAssessment(session.planScore, serverNow(Math.max(clock, Date.now())))) ||
      sessionQuery.isFetching
    )
      return;
    const event = `${sessionId}:${session.draftRevision}:${session.countriesReviewedRevision}:${clock}`;
    if (lastDraftRefreshEvent.current === event) return;
    // One eligible event causes one session read. React Query shares it across
    // consumers; a still-insufficient response waits for focus/expiry/reconnect.
    lastDraftRefreshEvent.current = event;
    void queryClient.invalidateQueries(
      { queryKey: queryKeys.aiPlanningSession(sessionId), exact: true },
      { cancelRefetch: false },
    );
  }, [clock, planScoreEnabled, queryClient, session, sessionId, sessionQuery.isFetching]);
  useEffect(() => {
    if (!session || !isAiPlanningSessionGenerating(session.status)) return;
    let current = true;
    let timer: number | undefined;
    const startedAt = Date.now();
    const poll = async () => {
      try {
        await sessionQuery.refetch();
      } catch {
        // The query keeps its own error state; polling can resume on recovery.
      } finally {
        if (current) {
          const interval =
            Date.now() - startedAt < 30_000 ? INITIAL_SESSION_POLL_MS : LATER_SESSION_POLL_MS;
          const untilDeadline = session.deadlineAt
            ? Date.parse(session.deadlineAt) - Date.now()
            : interval;
          timer = window.setTimeout(poll, Math.max(1_000, Math.min(interval, untilDeadline)));
        }
      }
    };
    timer = window.setTimeout(poll, INITIAL_SESSION_POLL_MS);
    return () => {
      current = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [session?.deadlineAt, session?.id, session?.status, sessionQuery.refetch]);
  const [draft, setDraft] = useState<AiPlanningDraft | null>(null);
  const [operation, setOperation] = useState<ReviewOperation>('idle');
  const [error, setError] = useState<string | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  // Google bills a Dynamic Map per instantiation, and this screen is one the
  // traveller leaves and returns to while a draft sits waiting. Mounting the map
  // on arrival would charge for that loop, so the map is bought on request and
  // then kept: regenerate swaps the draft in place without unmounting, so nobody
  // pays twice for a map they already opened.
  const [mapRevealed, setMapRevealed] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [regeneratePrompt, setRegeneratePrompt] = useState('');
  const [description, setDescription] = useState('');
  const [savingDescription, setSavingDescription] = useState(false);
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [countries, setCountries] = useState<string[]>([]);
  const [savingCountries, setSavingCountries] = useState(false);
  const [countrySaveInFlight, setCountrySaveInFlight] = useState(false);
  const [countrySaveFailed, setCountrySaveFailed] = useState(false);
  const countrySaveTimer = useRef<number | null>(null);
  const countriesRef = useRef(countries);
  const sessionRef = useRef<AiPlanningSession | null>(null);
  const expired = Boolean(session && isAiPlanningSessionExpired(session, clock));
  const serverExpired =
    sessionQuery.error instanceof AiPlanningApiError &&
    sessionQuery.error.code === 'session_expired';

  useEffect(() => {
    if (!planScoreEnabled || !session?.planScore) return;
    rememberAssessment(queryClient, `draft:${sessionId}`, session.planScore);
  }, [planScoreEnabled, sessionId, session?.planScore, queryClient]);

  useEffect(() => {
    if (!session || session.status === 'applied') return;
    const refreshClock = () => {
      if (document.visibilityState !== 'hidden') setClock(Date.now());
    };
    window.addEventListener('focus', refreshClock);
    window.addEventListener('online', refreshClock);
    document.addEventListener('visibilitychange', refreshClock);
    const delay = Math.max(0, Date.parse(session.expiresAt) - Date.now());
    const timer = window.setTimeout(refreshClock, Math.min(delay, 2_147_483_647));
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', refreshClock);
      window.removeEventListener('online', refreshClock);
      document.removeEventListener('visibilitychange', refreshClock);
    };
  }, [session?.expiresAt, session?.status, clock]);

  useEffect(() => {
    if (!expired && !serverExpired) return;
    sessionRef.current = null;
    setDraft(null);
    setRegeneratePrompt('');
    setDescription('');
    setName('');
    setCountries([]);
    setConfirmApply(false);
    queryClient.setQueryData(queryKeys.aiPlanningSession(sessionId), { session: null });
    queryClient.setQueryData(queryKeys.aiPlanningRecovery(), { session: null });
    setError('session_expired');
    // A locally cached draft becomes inaccessible at the deadline even while
    // offline. When connected, the GET also asks the API to scrub it now.
    if (expired && !serverExpired) void sessionQuery.refetch();
  }, [expired, queryClient, serverExpired, sessionId, sessionQuery.refetch]);

  // The draft is whatever generation produced, so the server copy is always the
  // truth and there is nothing local to reconcile against it.
  useEffect(() => {
    if (expired || !session?.draft) return;
    setDraft(session.draft);
    setRegeneratePrompt(session.prompt ?? '');
  }, [expired, serverExpired, session?.draft, session?.draftRevision, session?.prompt]);

  useEffect(() => {
    sessionRef.current = expired || serverExpired ? null : session;
  }, [expired, serverExpired, session]);

  // The model drafts a description and the traveller's edit overrides it, so the
  // field is seeded from the session's own copy first. It reads through
  // `session.draft` rather than the `draft` state so it does not depend on which
  // of the two effects ran first.
  const draftedDescription = expired ? '' : (session?.draft?.trip.description ?? '');
  useEffect(() => {
    setDescription(
      expired || serverExpired ? '' : (session?.tripDescription ?? draftedDescription),
    );
  }, [draftedDescription, expired, serverExpired, session?.id, session?.tripDescription]);

  // Same contract as the description: seeded from the session's own copy
  // first, read through `session.draft` rather than `draft` state so it does
  // not depend on effect ordering.
  const draftedName = expired ? '' : (session?.draft?.trip.name ?? '');
  useEffect(() => {
    setName(expired || serverExpired ? '' : (session?.tripName ?? draftedName));
  }, [draftedName, expired, serverExpired, session?.id, session?.tripName]);

  const countrySeed =
    session && session.countriesReviewedRevision === session.draftRevision
      ? session.reviewedCountries
      : (session?.suggestedCountries ?? []);
  const reviewedCountryKey = session?.reviewedCountries.join(',') ?? '';
  const suggestedCountryKey = session?.suggestedCountries.join(',') ?? '';
  useEffect(() => {
    const seeded = expired || serverExpired ? [] : countrySeed;
    countriesRef.current = seeded;
    setCountries(seeded);
  }, [
    expired,
    serverExpired,
    session?.id,
    session?.draftRevision,
    session?.countriesReviewedRevision,
    reviewedCountryKey,
    suggestedCountryKey,
  ]);
  useEffect(() => {
    if (session?.status === 'reviewing' && !expired && !serverExpired) return;
    if (countrySaveTimer.current) window.clearTimeout(countrySaveTimer.current);
    countrySaveTimer.current = null;
    setSavingCountries(false);
    setCountrySaveInFlight(false);
    setCountrySaveFailed(false);
  }, [expired, serverExpired, session?.draftRevision, session?.id, session?.status]);
  useEffect(
    () => () => {
      if (countrySaveTimer.current) window.clearTimeout(countrySaveTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!session?.appliedTripId) return;
    router.replace(`/trips/${session.appliedTripId}`);
  }, [router, session?.appliedTripId]);

  const publishing = operation !== 'idle';
  const reviewing = !expired && !serverExpired && session?.status === 'reviewing';
  const visibleError = error ?? (publishing ? null : session?.lastSafeError);
  const countriesConfirmed = session && aiPlanningCountriesReviewed(session, countries);
  const canApply = Boolean(reviewing && draft && countries.length > 0 && !savingCountries);
  // A commitment the plan had to move names the one it now follows, so the
  // traveller sees why its time differs from the one they asked for.
  const adjustedAfter = useMemo(() => {
    const labels = new Map(
      draft?.days.flatMap((day) => day.items.map((item) => [item.id, item.label])) ?? [],
    );
    return new Map(
      draft?.warnings.flatMap((warning) => {
        const [earlier, moved] = warning.itemIds;
        const label = earlier ? labels.get(earlier) : undefined;
        return warning.code === 'schedule_adjusted' && moved && label ? [[moved, label]] : [];
      }) ?? [],
    );
  }, [draft]);
  const selectedMapPoints = useMemo(
    () => (draft ? buildAiPlanningReviewMapPoints(draft) : []),
    [draft],
  );
  const assumptionMessages = useMemo(
    () =>
      draft
        ? [
            ...new Set(
              activeAiPlanningAssumptions(draft)
                // The suggested-name line is a nudge to check the model's guess;
                // once the traveller has set their own it has nothing left to say.
                .filter(
                  (assumption) =>
                    assumption.code !== 'trip_name_inferred' || session?.tripName === null,
                )
                .map((assumption) =>
                  t(
                    `assumptionCodes.${assumption.code}`,
                    aiPlanningAssumptionMessageValues(assumption, draft, locale),
                  ),
                ),
            ),
          ]
        : [],
    [draft, locale, session?.tripName, t],
  );
  /**
   * How much of the plan stands on a place the provider could actually find.
   *
   * A plan that verified most of its places is ordinary and says so quietly.
   * One that verified none of them is a trip that will open with no map, no
   * travel times and no weather, and nothing else on this screen would tell the
   * traveller that before they applied it. It informs rather than blocks: PRD
   * 7.6.3 is explicit that an unresolved place does not prevent Apply.
   */
  const placeVerification = useMemo(() => {
    const total = draft?.places.length ?? 0;
    const verified = draft?.places.filter((place) => place.resolution === 'verified').length ?? 0;
    return { none: total > 0 && verified === 0, total, verified };
  }, [draft]);
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
    sessionRef.current = next;
    queryClient.setQueryData(queryKeys.aiPlanningSession(sessionId), { session: next });
    queryClient.setQueryData(queryKeys.aiPlanningRecovery(), { session: next });
  }

  /** Description is session metadata beside the immutable draft. */
  async function saveDescription(next: string) {
    // Comparing against the seeded value, not just the stored one: a first blur
    // on an untouched field would otherwise save the model's own words back as
    // if the traveller had written them.
    if (!session || !reviewing || next === (session.tripDescription ?? draftedDescription)) return;
    setSavingDescription(true);
    setError(null);
    try {
      publish((await setAiPlanningTripDescription(session.id, next.trim() || null)).session);
    } catch (cause) {
      setError(cause instanceof AiPlanningApiError ? cause.code : 'request_failed');
    } finally {
      setSavingDescription(false);
    }
  }

  /** Same contract as `saveDescription`: session metadata beside the draft. */
  async function saveName(next: string) {
    if (!session || !reviewing || next === (session.tripName ?? draftedName)) return;
    setSavingName(true);
    setError(null);
    try {
      publish((await setAiPlanningTripName(session.id, next.trim() || null)).session);
    } catch (cause) {
      setError(cause instanceof AiPlanningApiError ? cause.code : 'request_failed');
    } finally {
      setSavingName(false);
    }
  }

  async function persistCountries(
    current: AiPlanningSession,
    selected: string[],
  ): Promise<AiPlanningSession | null> {
    if (!selected.length) return null;
    setSavingCountries(true);
    setCountrySaveInFlight(true);
    setCountrySaveFailed(false);
    setError(null);
    try {
      const saved = (await setAiPlanningCountries(current.id, selected, current.draftRevision))
        .session;
      if (
        !aiPlanningCountrySaveIsCurrent(current, sessionRef.current, selected, countriesRef.current)
      )
        return null;
      publish(saved);
      setCountrySaveFailed(false);
      return saved;
    } catch (cause) {
      setCountrySaveFailed(true);
      setError(cause instanceof AiPlanningApiError ? cause.code : 'request_failed');
      if (cause instanceof AiPlanningApiError && cause.code === 'draft_conflict') {
        void sessionQuery.refetch();
      }
      return null;
    } finally {
      setSavingCountries(false);
      setCountrySaveInFlight(false);
    }
  }

  function changeCountries(next: string[]) {
    countriesRef.current = next;
    setCountries(next);
    setCountrySaveFailed(false);
    if (countrySaveTimer.current) window.clearTimeout(countrySaveTimer.current);
    countrySaveTimer.current = null;
    if (!session || !reviewing || !next.length) {
      setSavingCountries(false);
      return;
    }
    setSavingCountries(true);
    const current = session;
    countrySaveTimer.current = window.setTimeout(() => {
      countrySaveTimer.current = null;
      void persistCountries(current, next);
    }, 250);
  }

  async function regenerate() {
    if (!session || expired || serverExpired || publishing || !regeneratePrompt.trim()) return;
    setOperation('regenerating');
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
      // A session with no draft is one the server has already applied, so it
      // cannot create a trip: close the dialog rather than leave it sitting
      // there with nothing to act on.
      const saved = await prepareAiPlanningCountriesForApply(
        sessionRef.current ?? session,
        countries,
        persistCountries,
      );
      if (!saved) {
        setConfirmApply(false);
        return;
      }
      const deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
      const result = await applyAiPlanningSession(saved.id, saved.draftRevision, deviceTimeZone);
      const applied = appliedAiPlanningSession(saved, result.trip.id);
      setDraft(null);
      setRegeneratePrompt('');
      setDescription('');
      setName('');
      setCountries([]);
      sessionRef.current = applied;
      queryClient.setQueryData(queryKeys.aiPlanningSession(sessionId), { session: applied });
      // Recovery must be emptied, not just refreshed: the server drops an
      // applied session from recovery, and the app-wide resume pin sends the
      // traveller back to `/trips/ai/:id` on the very navigation below while a
      // `reviewing` session is still cached here.
      queryClient.setQueryData(queryKeys.aiPlanningRecovery(), { session: null });
      queryClient.setQueryData(queryKeys.trips(), (current: { trips: Trip[] } | undefined) =>
        current ? { ...current, trips: [...current.trips, result.trip] } : current,
      );
      if (planScoreEnabled)
        void startCanonicalPlanScoreRead(queryClient, result.trip.id, (signal) =>
          fetchTripPlanScore(result.trip.id, signal),
        ).catch(() => undefined);
      router.replace(`/trips/${result.trip.id}`);
    } catch (cause) {
      setError(cause instanceof AiPlanningApiError ? cause.code : 'request_failed');
      setConfirmApply(false);
    } finally {
      setOperation('idle');
    }
  }

  // The itinerary settles into place as the generating takeover fades off it.
  // Two elements, one beat apart — enough to read as arriving, not as a cascade.
  const arrive = (delay: number) => ({
    animate: { opacity: 1, y: 0 },
    initial: reducedMotion ? false : { opacity: 0, y: 10 },
    transition: reducedMotion
      ? { duration: 0 }
      : { delay, duration: motionDuration.standard, ease: motionEase },
  });

  const pageState =
    expired || serverExpired
      ? 'error'
      : aiPlanningReviewPageState(session, draft, sessionQuery.isPending);
  if (pageState === 'loading' || pageState === 'redirecting') {
    return <PageState kind="loading" loadingShape="text" scope="page" title={t('loading')} />;
  }
  if (pageState === 'error' || !session || !draft) {
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

  function resolveDraftScoreAction(explanation: import('@trove/types').PlanScoreExplanation) {
    if (!explanation.action || !draft) return null;
    const day = draft.days.find(
      (day) =>
        explanation.references.includes(day.date) ||
        day.items.some(
          (item) =>
            explanation.references.includes(item.id) ||
            Boolean(item.placeRefId && explanation.references.includes(item.placeRefId)),
        ),
    );
    if (!day) return null;
    return { onSelect: () => document.getElementById(`ai-score-day-${day.date}`)?.focus() };
  }

  return (
    <section className="mx-auto max-w-7xl space-y-6 pb-28" aria-labelledby="ai-review-title">
      <motion.header className="border-b border-border pb-6" {...arrive(0)}>
        {/* Leaving is not discarding. The session outlives this screen, so the
            way out needs no confirmation - and the Trips page keeps the draft
            reachable, which is the only reason this can be a plain exit. */}
        <Button
          className="-ml-3 mb-2 text-muted-foreground"
          onClick={() => router.push('/trips')}
          size="sm"
          type="button"
          variant="ghost"
        >
          <ArrowLeft aria-hidden="true" data-icon="inline-start" />
          {t('saveForLater')}
        </Button>
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-brand">{t('eyebrow')}</p>
          <h1
            className="mt-1 text-[length:var(--text-page-title)] font-semibold tracking-[-0.035em]"
            id="ai-review-title"
          >
            {name || draft.trip.name}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('description')}</p>
        </div>
      </motion.header>

      {isAiPlanningSessionGenerating(session.status) ? (
        <Alert role="status" variant="info">
          <Icons.Ai aria-hidden="true" />
          <AlertTitle>{general(`stages.${session.stage}`)}</AlertTitle>
          <AlertDescription>{t('regeneratingHint')}</AlertDescription>
        </Alert>
      ) : null}
      {placeVerification.none ? (
        <Alert role="status" variant="warning">
          <Icons.Warning aria-hidden="true" />
          <AlertTitle>{t('noVerifiedPlacesTitle')}</AlertTitle>
          <AlertDescription>{t('noVerifiedPlacesHint')}</AlertDescription>
        </Alert>
      ) : null}
      {visibleError ? (
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>{general(`errors.${aiPlanningErrorMessageKey(visibleError)}`)}</AlertTitle>
          <AlertDescription>{t('errorHint')}</AlertDescription>
        </Alert>
      ) : null}

      <motion.div
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.8fr)]"
        {...arrive(reducedMotion ? 0 : 0.06)}
      >
        <div className="space-y-6">
          <section className="rounded-[var(--radius-xl)] border border-border bg-card p-4 shadow-[var(--shadow-surface)] sm:p-6">
            <Field>
              <FieldLabel htmlFor="review-trip-name">{t('tripName')}</FieldLabel>
              <Input
                disabled={!reviewing || publishing}
                id="review-trip-name"
                onBlur={(event) => void saveName(event.target.value)}
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
              <FieldDescription aria-live="polite">
                {savingName ? t('nameSaving') : t('nameHint')}
              </FieldDescription>
            </Field>
            <Field className="mt-4">
              <FieldLabel htmlFor="review-trip-countries">{t('countries')}</FieldLabel>
              <CountryMultiCombobox
                aria-label={t('countries')}
                disabled={!reviewing || publishing || countrySaveInFlight}
                id="review-trip-countries"
                onValueChange={changeCountries}
                placeholder={t('countriesPlaceholder')}
                required
                value={countries}
              />
              <FieldDescription>
                {session.suggestedCountries.length
                  ? t('countriesSuggested')
                  : t('countriesMissing')}
              </FieldDescription>
              {!countries.length ? (
                <p className="text-sm text-destructive">{t('countriesRequired')}</p>
              ) : null}
              {countriesConfirmed ? (
                <p className="text-sm text-muted-foreground" role="status">
                  {t('countriesConfirmed')}
                </p>
              ) : savingCountries ? (
                <p className="text-sm text-muted-foreground" role="status">
                  {t('countriesSaving')}
                </p>
              ) : countrySaveFailed && countries.length ? (
                <Button
                  disabled={!reviewing || publishing}
                  onClick={() => void persistCountries(sessionRef.current ?? session, countries)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {t('countriesRetry')}
                </Button>
              ) : null}
            </Field>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted-foreground">{t('partySize')}</dt>
                <dd className="mt-1 font-medium">{draft.trip.partySize}</dd>
              </div>
            </dl>
            <p className="mt-4 text-sm text-muted-foreground">
              {draft.trip.startDate} - {draft.trip.endDate}
            </p>
            <Field className="mt-4">
              <FieldLabel htmlFor="review-trip-description">{t('tripDescription')}</FieldLabel>
              <Textarea
                disabled={!reviewing || publishing}
                id="review-trip-description"
                onBlur={(event) => void saveDescription(event.target.value)}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                value={description}
              />
              <FieldDescription aria-live="polite">
                {savingDescription ? t('descriptionSaving') : t('descriptionHint')}
              </FieldDescription>
            </Field>
          </section>

          {assumptionMessages.length ? (
            <section
              className="rounded-[var(--radius-xl)] border border-border bg-card p-4 sm:p-6"
              aria-labelledby="ai-review-assumptions"
            >
              <h2 className="font-semibold" id="ai-review-assumptions">
                {t('assumptions')}
              </h2>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                {assumptionMessages.map((message) => (
                  <li key={message}>{message}</li>
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
              {placeVerification.total ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('placesVerified', {
                    total: placeVerification.total,
                    verified: placeVerification.verified,
                  })}
                </p>
              ) : null}
            </div>
            {draft.days.map((day, dayIndex) => {
              return (
                <article
                  className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card"
                  id={`ai-score-day-${day.date}`}
                  tabIndex={-1}
                  key={day.date}
                >
                  <header className="border-b border-border px-4 py-4 sm:px-6">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t('day', { number: dayIndex + 1 })}
                    </p>
                    <h3 className="mt-1 font-semibold">
                      {day.name ?? dateFormatter.format(new Date(`${day.date}T00:00:00.000Z`))}
                    </h3>
                    {day.name ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {dateFormatter.format(new Date(`${day.date}T00:00:00.000Z`))}
                      </p>
                    ) : null}
                  </header>
                  <ol className="divide-y divide-border-subtle">
                    {day.items.map((item) => {
                      const place = item.placeRefId
                        ? draft.places.find((candidate) => candidate.id === item.placeRefId)
                        : null;
                      return (
                        <li className="p-4 sm:px-6" key={item.id}>
                          <div>
                            <p className="font-medium">{item.label}</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {item.schedule.kind === 'exact'
                                ? formatSegmentedTime(
                                    item.schedule.localTime,
                                    locale,
                                    preferences.timeFormat,
                                  ).text
                                : t(`dayParts.${item.schedule.dayPart}`)}{' '}
                              · {t('duration', { minutes: item.durationMinutes })}
                            </p>
                            {item.origin === 'user' ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {t('travelerSupplied')}
                              </p>
                            ) : null}
                            {adjustedAfter.has(item.id) ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {t('scheduleAdjusted', { other: adjustedAfter.get(item.id)! })}
                              </p>
                            ) : null}
                            {/* Which provider found a place is Trove's problem, not
                              the traveller's. What they are deciding here is
                              whether to trust the plan, and for that the only
                              thing that matters is that the place is real. */}
                            {place ? (
                              place.resolution === 'verified' ? (
                                <Badge className="mt-1.5" size="sm" variant="success">
                                  <CircleCheck aria-hidden="true" />
                                  {t('verifiedPlace')}
                                </Badge>
                              ) : place.verification === 'not_checked' ? (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {t('customPlace.not_checked')}
                                </p>
                              ) : null
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                    {!day.items.length ? (
                      <li className="p-4 text-sm text-muted-foreground sm:px-6">{t('emptyDay')}</li>
                    ) : null}
                  </ol>
                </article>
              );
            })}
          </section>

          {draft.unscheduledItems.length ? (
            <section className="rounded-[var(--radius-xl)] border border-border bg-card p-4 sm:p-6">
              <h2 className="font-semibold">{t('unscheduled')}</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {draft.unscheduledItems.map((item) => {
                  const reason = draft.warnings.find(
                    (warning) =>
                      warning.itemIds.includes(item.id) &&
                      ['arrival_time_unknown', 'schedule_adjusted', 'schedule_conflict'].includes(
                        warning.code,
                      ),
                  )?.code;
                  return (
                    <li key={item.id}>
                      {item.label}
                      {reason ? (
                        <p className="text-muted-foreground">
                          {reason === 'arrival_time_unknown'
                            ? t('unscheduledArrivalUnknown')
                            : t('unscheduledScheduleConflict')}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>

        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          {planScoreEnabled && !session.countryContextChanged ? (
            <PlanScorePanel
              // Matches the review's own cards beside it in this column.
              className="border-border sm:p-6"
              change={assessmentChange(queryClient, `draft:${sessionId}`, 'trip')}
              assessment={session.planScore}
              resolveAction={resolveDraftScoreAction}
              completeness={session.planScore?.completeness ?? null}
              confidence={session.planScore?.confidence ?? null}
              explanations={
                session.planScore?.explanations ?? {
                  uncertainty: [],
                  whatWorks: [],
                  worthImproving: [],
                }
              }
              score={session.planScore?.score ?? null}
              scope="trip"
              status={
                sessionQuery.isFetching ||
                (!session.planScore &&
                  lastDraftRefreshEvent.current !==
                    `${sessionId}:${session.draftRevision}:${session.countriesReviewedRevision}:${clock}`)
                  ? 'updating'
                  : sessionQuery.error
                    ? 'error'
                    : session.planScore && !currentAssessment(session.planScore)
                      ? 'expired'
                      : 'idle'
              }
              onRetry={() =>
                void queryClient.invalidateQueries(
                  { queryKey: queryKeys.aiPlanningSession(sessionId), exact: true },
                  { cancelRefetch: false },
                )
              }
              title={planScoreCopy('title')}
            />
          ) : null}
          {session.context ? (
            <TripInsightsPanel
              className="border-border sm:p-6"
              insights={composeInsights({
                context: session.context,
                // A draft's days are its dates, on the score and the context alike.
                explanations:
                  planScoreEnabled && session.planScore && currentAssessment(session.planScore)
                    ? new Map(session.planScore.days.map((day) => [day.dayId, day.explanations]))
                    : undefined,
                scope: { kind: 'trip' },
              })}
              resolveAction={resolveDraftScoreAction}
              showDays
              totalDays={session.context.days.length}
            />
          ) : null}
          {session.countryContextChanged ? (
            <Alert variant="warning">
              <Icons.Warning aria-hidden="true" />
              <AlertDescription>{t('countryTimeZoneWarning')}</AlertDescription>
            </Alert>
          ) : null}
          <section
            className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card"
            aria-label={t('mapLabel')}
          >
            {!selectedMapPoints.length ? (
              <div className="p-6 text-sm text-muted-foreground">
                <Icons.MapView aria-hidden="true" className="mb-3 size-5 text-brand" />
                {t('mapUnavailable')}
              </div>
            ) : mapRevealed ? (
              <ItineraryPlanningMap
                onClearSelection={() => setSelectedPointId(null)}
                onSelectPoint={(point) => setSelectedPointId(point.id)}
                points={selectedMapPoints}
                routeLines={[]}
                selectedPointId={selectedPointId}
              />
            ) : (
              <div className="p-6">
                <Icons.MapView aria-hidden="true" className="mb-3 size-5 text-brand" />
                <p className="text-sm text-muted-foreground">
                  {t('mapPlaceCount', { count: selectedMapPoints.length })}
                </p>
                <Button
                  className="mt-3"
                  onClick={() => setMapRevealed(true)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {t('showMap')}
                </Button>
              </div>
            )}
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
              <Icons.Ai aria-hidden="true" data-icon="inline-start" />
              {t('regenerateAction')}
            </Button>
          </section>
        </aside>
      </motion.div>

      <div className="fixed right-[var(--gutter-inline-end)] bottom-[calc(var(--bottom-bar-height)+var(--safe-bottom)+1rem)] z-20">
        <Button disabled={!canApply || publishing} onClick={() => setConfirmApply(true)}>
          {t('apply')}
        </Button>
      </div>
      <AlertDialog onOpenChange={setConfirmApply} open={confirmApply}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('confirmDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={operation === 'applying'}>{t('notYet')}</AlertDialogCancel>
            <AlertDialogAction disabled={operation === 'applying'} onClick={() => void apply()}>
              {operation === 'applying' ? t('applying') : t('confirmApply')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
