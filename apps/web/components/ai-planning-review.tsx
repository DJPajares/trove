'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowLeftRight,
  CalendarRange,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Minus,
  PencilLine,
  Plus,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { AiPlanningAdjustSheet } from '@/components/ai-planning-adjust-sheet';
import { useAiPlanningBriefCatalogue } from '@/components/ai-planning-brief-field';
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
import { PlanScoreChip, PlanScorePanel } from '@/components/plan-score-panel';
import { TripInsightsPanel } from '@/components/trip-insights-panel';
import { usePreferences } from '@/components/preferences-provider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
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
  AiPlanningApiError,
  applyAiPlanningSession,
  fetchAiPlanningSession,
  fetchAiPlanningAvailability,
  regenerateAiPlanningSession,
  setAiPlanningTripDescription,
  setAiPlanningTripName,
  setAiPlanningCountries,
  type AiPlanningSession,
  type AiPlanningDraft,
  type AiPlanningDraftItem,
} from '@/lib/ai-planning/api';
import {
  composeAiPlanningBrief,
  type AiPlanningBriefIngredient,
  type AiPlanningBriefSelection,
} from '@/lib/ai-planning/brief';
import {
  activeAiPlanningAssumptions,
  aiPlanningAssumptionMessageValues,
  aiPlanningReviewPageState,
  aiPlanningCountriesReviewed,
  preserveAiPlanningCountrySelection,
  aiPlanningCountrySaveIsCurrent,
  prepareAiPlanningCountriesForApply,
  appliedAiPlanningSession,
  buildAiPlanningReviewMapPoints,
  diffAiPlanningDrafts,
  isAiPlanningSessionExpired,
  type AiPlanningDraftChanges,
} from '@/lib/ai-planning/review';
import {
  aiPlanningErrorMessageKey,
  isAiPlanningSessionGenerating,
  type AiPlanningSessionStage,
} from '@/lib/ai-planning/presentation';
import { formatPlannedDuration } from '@/lib/itinerary/route-format';
import { motionDuration, motionEase } from '@/lib/motion';
import { queryKeys } from '@/lib/query/keys';
import { formatSegmentedTime } from '@/lib/time/time-segments';
import type { Trip } from '@/lib/trips/api';
import * as Icons from '@/lib/icons';
import { cn } from '@/lib/utils';

const INITIAL_SESSION_POLL_MS = 3_000;
const LATER_SESSION_POLL_MS = 5_000;

type ReviewOperation = 'applying' | 'idle' | 'regenerating';

/** The server's stages in the order a run walks them, for the inline progress. */
const REGENERATE_STAGES: readonly AiPlanningSessionStage[] = [
  'created',
  'generating',
  'scheduling',
  'grounding',
  'validating',
];
/** How many days open on arrival. The rest stay one tap away in the day strip. */
const OPEN_DAYS_ON_ARRIVAL = 2;

export function AiPlanningReview({
  sessionId,
  planScoreEnabled,
}: Readonly<{ sessionId: string; planScoreEnabled: boolean }>) {
  const t = useTranslations('trips.aiPlanning.review');
  const general = useTranslations('trips.aiPlanning');
  const planScoreCopy = useTranslations('planScore');
  const paceCopy = useTranslations('planningPreferences');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const reducedMotion = useReducedMotion();
  const router = useRouter();
  const queryClient = useQueryClient();
  const allowanceQuery = useQuery({
    queryKey: queryKeys.aiPlanningAvailability(),
    queryFn: fetchAiPlanningAvailability,
  });
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
  const briefCatalogue = useAiPlanningBriefCatalogue();
  // The brief Adjust reopens: the traveller's words and their choices, split
  // back out of the prompt this draft was planned from.
  const [regeneratePrompt, setRegeneratePrompt] = useState('');
  const [regenerateSelections, setRegenerateSelections] = useState<AiPlanningBriefSelection[]>([]);
  const [adjust, setAdjust] = useState<{ open: boolean; tray: AiPlanningBriefIngredient | null }>({
    open: false,
    tray: null,
  });
  const [editingDetails, setEditingDetails] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  // Which days are open. Seeded per draft revision, so a new version opens on
  // its own first days rather than on whatever the last one left open.
  const [openDays, setOpenDays] = useState<{ days: ReadonlySet<string>; revision: number | null }>({
    days: new Set(),
    revision: null,
  });
  // The draft a regenerate started from, held only on this screen so the new
  // version can say what changed. Nothing is stored or sent anywhere.
  const regeneratedFrom = useRef<{ draft: AiPlanningDraft; revision: number } | null>(null);
  const [changes, setChanges] = useState<AiPlanningDraftChanges | null>(null);
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
  const editedCountryRevision = useRef<string | null>(null);
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
    setRegenerateSelections([]);
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
  }, [expired, serverExpired, session?.draft, session?.draftRevision]);

  // Seeded per revision and prompt rather than per read, so a background
  // refetch never wipes a brief the traveller is in the middle of adjusting.
  const sessionPrompt = expired ? null : (session?.prompt ?? null);
  useEffect(() => {
    if (sessionPrompt === null) return;
    const brief = briefCatalogue.split(sessionPrompt);
    setRegeneratePrompt(brief.text);
    setRegenerateSelections(brief.selections);
  }, [briefCatalogue, session?.draftRevision, session?.id, sessionPrompt]);

  useEffect(() => {
    sessionRef.current = expired || serverExpired ? null : session;
  }, [expired, serverExpired, session]);

  useEffect(() => {
    const origin = regeneratedFrom.current;
    if (!origin || session?.status !== 'reviewing' || !session.draft) return;
    // A failed regenerate keeps the earlier revision; only a new one has changes.
    if (session.draftRevision === origin.revision) return;
    regeneratedFrom.current = null;
    setChanges(diffAiPlanningDrafts(origin.draft, session.draft));
  }, [session?.draft, session?.draftRevision, session?.status]);

  const draftRevision = session?.draftRevision ?? null;
  const visibleOpenDays = useMemo(
    () =>
      openDays.revision === draftRevision
        ? openDays.days
        : new Set(draft?.days.slice(0, OPEN_DAYS_ON_ARRIVAL).map((day) => day.date) ?? []),
    [draft, draftRevision, openDays],
  );
  function setDayOpen(date: string, open: boolean) {
    const days = new Set(visibleOpenDays);
    if (open) days.add(date);
    else days.delete(date);
    setOpenDays({ days, revision: draftRevision });
  }

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
    if (
      !expired &&
      !serverExpired &&
      session &&
      preserveAiPlanningCountrySelection(editedCountryRevision.current, session)
    )
      return;
    editedCountryRevision.current = null;
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
    if (session) editedCountryRevision.current = `${session.id}:${session.draftRevision}`;
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
    const brief = composeAiPlanningBrief(regeneratePrompt, regenerateSelections);
    if (!session || expired || serverExpired || publishing || !brief) return;
    setOperation('regenerating');
    setError(null);
    setChanges(null);
    setAdjust((current) => ({ ...current, open: false }));
    if (draft) regeneratedFrom.current = { draft, revision: session.draftRevision };
    try {
      publish(
        (
          await regenerateAiPlanningSession(
            session.id,
            brief,
            session.draftRevision,
            crypto.randomUUID(),
          )
        ).session,
      );
    } catch (cause) {
      setError(cause instanceof AiPlanningApiError ? cause.code : 'request_failed');
    } finally {
      void queryClient.invalidateQueries({ queryKey: queryKeys.aiPlanningAvailability() });
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
      setRegenerateSelections([]);
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.aiPlanningAvailability() });
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
    return {
      onSelect: () => {
        setDayOpen(day.date, true);
        document.getElementById(`ai-score-day-${day.date}`)?.focus();
      },
    };
  }

  const regenerating =
    operation === 'regenerating' || isAiPlanningSessionGenerating(session.status);
  const scoreStatus =
    sessionQuery.isFetching ||
    (!session.planScore &&
      lastDraftRefreshEvent.current !==
        `${sessionId}:${session.draftRevision}:${session.countriesReviewedRevision}:${clock}`)
      ? 'updating'
      : sessionQuery.error
        ? 'error'
        : session.planScore && !currentAssessment(session.planScore)
          ? 'expired'
          : 'idle';
  const scoreExplanations = session.planScore?.explanations ?? {
    uncertainty: [],
    whatWorks: [],
    worthImproving: [],
  };
  const tripName = name || draft.trip.name;
  const placeNames = new Map(draft.places.map((place) => [place.id, place.name]));
  const destinationNames = [
    ...new Set(
      draft.trip.destinations.flatMap((destination) => {
        const placeName = placeNames.get(destination.placeRefId);
        return placeName ? [placeName] : [];
      }),
    ),
  ];
  const stayNames = [
    ...new Set(
      draft.days.flatMap((day) => {
        const stay = day.dailyBasePlaceRefId ? placeNames.get(day.dailyBasePlaceRefId) : undefined;
        return stay ? [stay] : [];
      }),
    ),
  ];
  const listFormatter = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' });
  const rangeFormatter = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    weekday: 'short',
  });
  const formatDateRange = (startDate: string, endDate: string) =>
    rangeFormatter.formatRange(
      new Date(`${startDate}T00:00:00.000Z`),
      new Date(`${endDate}T00:00:00.000Z`),
    );
  const assumptionMessage = (code: AiPlanningDraft['assumptions'][number]['code']) => {
    const assumption = activeAiPlanningAssumptions(draft).find((entry) => entry.code === code);
    return assumption
      ? t(
          `assumptionCodes.${assumption.code}`,
          aiPlanningAssumptionMessageValues(assumption, draft, locale),
        )
      : null;
  };
  // Dates, travellers and pace get rows of their own below, so only the other
  // inferences are listed as notes beneath them.
  const otherAssumptions = activeAiPlanningAssumptions(draft)
    .filter(
      (assumption) =>
        ![
          'dates_defaulted',
          'date_year_inferred',
          'pace_defaulted',
          'party_size_defaulted',
        ].includes(assumption.code) &&
        (assumption.code !== 'trip_name_inferred' || session.tripName === null),
    )
    .map((assumption) => ({
      id: assumption.id,
      code: assumption.code,
      message: t(
        `assumptionCodes.${assumption.code}`,
        aiPlanningAssumptionMessageValues(assumption, draft, locale),
      ),
    }));
  const openAdjust = (tray: AiPlanningBriefIngredient | null = null) =>
    setAdjust({ open: true, tray });
  const stageIndex = Math.max(0, REGENERATE_STAGES.indexOf(session.stage));

  return (
    <section className="mx-auto max-w-7xl space-y-5 pb-6" aria-labelledby="ai-review-title">
      {/* Leaving is not discarding. The session outlives this screen, so the
          way out needs no confirmation - and the Trips page keeps the draft
          reachable, which is the only reason this can be a plain exit. */}
      <Button
        className="-ml-3 text-muted-foreground"
        onClick={() => router.push('/trips')}
        size="sm"
        type="button"
        variant="ghost"
      >
        <ArrowLeft aria-hidden="true" data-icon="inline-start" />
        {t('saveForLater')}
      </Button>

      {regenerating ? (
        <section
          aria-labelledby="ai-review-regenerating"
          aria-live="polite"
          className="space-y-3 rounded-[var(--radius-xl)] border border-brand/35 bg-card p-4 shadow-[var(--shadow-surface)] sm:p-5"
          role="status"
        >
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground motion-safe:animate-pulse">
              <Icons.Ai aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="font-semibold" id="ai-review-regenerating">
                {t('regeneratingTitle')}
              </p>
              <p className="text-sm text-muted-foreground">{general(`stages.${session.stage}`)}</p>
            </div>
          </div>
          <div aria-hidden="true" className="grid grid-cols-5 gap-1">
            {REGENERATE_STAGES.map((stage, index) => (
              <span
                className={cn(
                  'h-1 rounded-full',
                  index < stageIndex && 'bg-brand',
                  index === stageIndex && 'bg-brand motion-safe:animate-pulse',
                  index > stageIndex && 'bg-border',
                )}
                key={stage}
              />
            ))}
          </div>
          <p className="text-[length:var(--text-metadata)] text-muted-foreground">
            {t('regeneratingHint')}
          </p>
        </section>
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

      <motion.header
        className="relative overflow-hidden rounded-[var(--radius-2xl)] bg-score-media-background p-5 text-score-media-foreground sm:p-8"
        {...arrive(0)}
      >
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] text-score-media-brand uppercase">
            {t('eyebrow')}
          </p>
          {session.draftRevision > 1 ? (
            <span className="rounded-full bg-score-media-brand px-2.5 py-0.5 text-xs font-semibold text-score-media-background">
              {t('version', { number: session.draftRevision })}
            </span>
          ) : null}
        </div>
        <div className="mt-3 flex items-start gap-3">
          <h1
            className="min-w-0 flex-1 font-journal text-[2.75rem] leading-[0.98] font-normal tracking-[-0.01em] text-balance [overflow-wrap:anywhere] sm:text-[4.25rem]"
            id="ai-review-title"
          >
            {tripName}
          </h1>
          <Button
            aria-label={t('editDetails')}
            className="shrink-0 rounded-full border-score-media-foreground/25 bg-transparent text-score-media-foreground shadow-none hover:bg-score-media-foreground/10 hover:text-score-media-foreground"
            disabled={!reviewing || publishing}
            onClick={() => {
              setNameDraft(name);
              setDescriptionDraft(description);
              setEditingDetails(true);
            }}
            size="icon"
            type="button"
            variant="outline"
          >
            <PencilLine aria-hidden="true" />
          </Button>
        </div>
        <p className="mt-3 text-base">
          {formatDateRange(draft.trip.startDate, draft.trip.endDate)}
          <span aria-hidden="true"> · </span>
          {t('tripFacts', { days: draft.days.length, travellers: draft.trip.partySize })}
        </p>
        {destinationNames.length ? (
          <p className="mt-0.5 text-base text-score-media-muted">
            {listFormatter.format(destinationNames)}
          </p>
        ) : null}
        {description ? (
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-score-media-muted">
            {description}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-score-media-foreground/12 pt-4">
          {planScoreEnabled && !session.countryContextChanged ? (
            <PlanScoreChip
              assessment={session.planScore}
              explanations={scoreExplanations}
              label={t('scoreDetails')}
              onOpen={() => document.getElementById('ai-review-score')?.focus()}
              score={session.planScore?.score ?? null}
              status={scoreStatus}
              tone="media"
            />
          ) : null}
          {placeVerification.total ? (
            <p className="flex items-center gap-1.5 text-sm text-score-media-muted">
              <CircleCheck aria-hidden="true" className="size-4 text-score-media-brand" />
              {t('placesVerified', {
                total: placeVerification.total,
                verified: placeVerification.verified,
              })}
            </p>
          ) : null}
        </div>
      </motion.header>

      {changes ? (
        <ReviewChanges
          changes={changes}
          formatDateRange={formatDateRange}
          onDismiss={() => setChanges(null)}
        />
      ) : null}

      <motion.div
        className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)] lg:grid-rows-[auto_1fr] lg:[grid-template-areas:'itinerary_filled''itinerary_extras']"
        {...arrive(reducedMotion ? 0 : 0.06)}
      >
        <section aria-labelledby="ai-review-filled" className="space-y-3 lg:[grid-area:filled]">
          <div className="px-1">
            <h2 className="text-lg font-semibold" id="ai-review-filled">
              {t('filledIn')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('filledInHint')}</p>
          </div>
          <ul className="divide-y divide-border-subtle rounded-[var(--radius-xl)] border border-border-subtle bg-card px-4 shadow-[var(--shadow-surface)] sm:px-5">
            <FilledInRow
              action={
                draft.trip.dateSource === 'user' ? null : (
                  <ChangeInBrief
                    disabled={!reviewing || publishing}
                    onClick={() => openAdjust('when')}
                  />
                )
              }
              detail={
                assumptionMessage('dates_defaulted') ?? assumptionMessage('date_year_inferred')
              }
              label={t('rows.dates')}
              source={draft.trip.dateSource === 'user' ? 'you' : 'picked'}
              value={formatDateRange(draft.trip.startDate, draft.trip.endDate)}
            />
            <FilledInRow
              action={
                draft.trip.partySizeSource === 'user' ? null : (
                  <ChangeInBrief
                    disabled={!reviewing || publishing}
                    onClick={() => openAdjust('who')}
                  />
                )
              }
              detail={assumptionMessage('party_size_defaulted')}
              label={t('rows.travellers')}
              source={draft.trip.partySizeSource === 'user' ? 'you' : 'picked'}
              value={String(draft.trip.partySize)}
            />
            <FilledInRow
              action={
                draft.trip.paceSource === 'user' ? null : (
                  <ChangeInBrief
                    disabled={!reviewing || publishing}
                    onClick={() => openAdjust('pace')}
                  />
                )
              }
              detail={assumptionMessage('pace_defaulted')}
              label={t('rows.pace')}
              source={draft.trip.paceSource === 'user' ? 'you' : 'picked'}
              value={paceCopy(`paces.${draft.trip.pace}`)}
            />
            {stayNames.length ? (
              <FilledInRow label={t('rows.stays')} value={listFormatter.format(stayNames)} />
            ) : null}
            {otherAssumptions.map((assumption) => (
              <li className="flex items-start justify-between gap-3 py-3.5" key={assumption.id}>
                <p className="text-sm leading-relaxed">{assumption.message}</p>
                {assumption.code === 'interest_inferred' ? null : <SourceTag source="picked" />}
              </li>
            ))}
            <li className="space-y-2.5 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <FieldLabel
                  className="text-[length:var(--text-metadata)] font-normal text-muted-foreground"
                  htmlFor="review-trip-countries"
                >
                  {t('rows.countries')}
                </FieldLabel>
                {countriesConfirmed ? (
                  <span className="flex items-center gap-1 text-[length:var(--text-metadata)] font-semibold text-status-success">
                    <CircleCheck aria-hidden="true" className="size-4" />
                    {t('confirmed')}
                  </span>
                ) : (
                  <SourceTag source="needed" />
                )}
              </div>
              <CountryMultiCombobox
                aria-describedby="review-trip-countries-hint"
                aria-label={t('countries')}
                disabled={!reviewing || publishing || countrySaveInFlight}
                id="review-trip-countries"
                onValueChange={changeCountries}
                placeholder={t('countriesPlaceholder')}
                required
                value={countries}
              />
              <p
                className="text-[length:var(--text-metadata)] leading-snug text-muted-foreground"
                id="review-trip-countries-hint"
              >
                {session.suggestedCountries.length
                  ? t('countriesSuggested')
                  : t('countriesMissing')}
              </p>
              {!countries.length ? (
                <p className="text-sm text-destructive">{t('countriesRequired')}</p>
              ) : null}
              {savingCountries && !countriesConfirmed ? (
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
            </li>
          </ul>
        </section>

        <div className="space-y-6 lg:[grid-area:itinerary]">
          <section aria-labelledby="ai-review-itinerary" className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1">
              <h2 className="text-lg font-semibold" id="ai-review-itinerary">
                {t('daysTitle', { count: draft.days.length })}
              </h2>
              {placeVerification.total ? (
                <p className="text-[length:var(--text-metadata)] text-muted-foreground">
                  {t('placesVerified', {
                    total: placeVerification.total,
                    verified: placeVerification.verified,
                  })}
                </p>
              ) : null}
            </div>
            {draft.days.length > 1 ? (
              <nav
                aria-label={t('jumpToDay')}
                className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0"
              >
                {draft.days.map((day, dayIndex) => (
                  <a
                    className="flex w-28 shrink-0 flex-col gap-0.5 rounded-[var(--radius-lg)] border border-border-subtle bg-card px-3 py-2.5 outline-none transition-colors duration-[var(--motion-standard)] hover:border-border-strong focus-visible:ring-3 focus-visible:ring-ring/40"
                    href={`#ai-score-day-${day.date}`}
                    key={day.date}
                    onClick={() => setDayOpen(day.date, true)}
                  >
                    <span className="text-xs text-muted-foreground">
                      {dateFormatter.format(new Date(`${day.date}T00:00:00.000Z`))}
                    </span>
                    <span className="line-clamp-2 text-sm leading-tight font-semibold">
                      {day.name ?? t('day', { number: dayIndex + 1 })}
                    </span>
                  </a>
                ))}
              </nav>
            ) : null}
            {draft.days.map((day, dayIndex) => (
              <Collapsible
                className="overflow-hidden rounded-[var(--radius-xl)] border border-border-subtle bg-card shadow-[var(--shadow-surface)] scroll-mt-24"
                id={`ai-score-day-${day.date}`}
                key={day.date}
                onOpenChange={(open) => setDayOpen(day.date, open)}
                open={visibleOpenDays.has(day.date)}
                tabIndex={-1}
              >
                <CollapsibleTrigger className="group/day flex w-full items-center gap-4 px-4 py-4 text-left text-foreground hover:text-foreground sm:px-5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                      {t('day', { number: dayIndex + 1 })} ·{' '}
                      {dateFormatter.format(new Date(`${day.date}T00:00:00.000Z`))}
                    </span>
                    <span className="mt-0.5 block font-journal text-[1.625rem] leading-[1.08] font-normal text-balance">
                      {day.name ?? dateFormatter.format(new Date(`${day.date}T00:00:00.000Z`))}
                    </span>
                    <span className="mt-0.5 block text-sm font-normal text-muted-foreground">
                      {t('dayStops', { count: day.items.length })}
                    </span>
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className="size-5 text-muted-foreground transition-transform duration-[var(--motion-standard)] group-data-[panel-open]/day:rotate-180 motion-reduce:transition-none"
                  />
                </CollapsibleTrigger>
                <CollapsiblePanel>
                  {day.items.length ? (
                    <ol className="px-4 pb-3 sm:px-5">
                      {day.items.map((item, itemIndex) => (
                        <ItineraryStop
                          adjustedAfter={adjustedAfter.get(item.id) ?? null}
                          draft={draft}
                          item={item}
                          key={item.id}
                          last={itemIndex === day.items.length - 1}
                          locale={locale}
                          timeFormat={preferences.timeFormat}
                        />
                      ))}
                    </ol>
                  ) : (
                    <p className="px-4 pb-4 text-sm text-muted-foreground sm:px-5">
                      {t('emptyDay')}
                    </p>
                  )}
                </CollapsiblePanel>
              </Collapsible>
            ))}
          </section>

          {draft.unscheduledItems.length ? (
            <section className="space-y-2 rounded-[var(--radius-xl)] border border-status-warning/30 bg-surface-tint p-4 sm:p-5">
              <h2 className="font-semibold">
                {t('unscheduledTitle', { count: draft.unscheduledItems.length })}
              </h2>
              <ul className="space-y-2 text-sm">
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
                      <p className="font-medium">{item.label}</p>
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
              <p className="text-[length:var(--text-metadata)] text-muted-foreground">
                {t('unscheduledHint')}
              </p>
            </section>
          ) : null}
        </div>

        <aside className="space-y-6 lg:[grid-area:extras] lg:self-start">
          {planScoreEnabled && !session.countryContextChanged ? (
            <div className="scroll-mt-24 outline-none" id="ai-review-score" tabIndex={-1}>
              <PlanScorePanel
                // Matches the review's own cards beside it in this column.
                className="border-border-subtle sm:p-6"
                change={assessmentChange(queryClient, `draft:${sessionId}`, 'trip')}
                assessment={session.planScore}
                resolveAction={resolveDraftScoreAction}
                completeness={session.planScore?.completeness ?? null}
                confidence={session.planScore?.confidence ?? null}
                explanations={scoreExplanations}
                score={session.planScore?.score ?? null}
                scope="trip"
                status={scoreStatus}
                onRetry={() =>
                  void queryClient.invalidateQueries(
                    { queryKey: queryKeys.aiPlanningSession(sessionId), exact: true },
                    { cancelRefetch: false },
                  )
                }
                title={planScoreCopy('title')}
              />
            </div>
          ) : null}
          {session.context ? (
            <TripInsightsPanel
              className="border-border-subtle sm:p-6"
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
            className="overflow-hidden rounded-[var(--radius-xl)] border border-border-subtle bg-card"
            aria-label={t('mapLabel')}
          >
            {!selectedMapPoints.length ? (
              <div className="flex gap-3 p-4 text-sm text-muted-foreground sm:p-5">
                <Icons.MapView aria-hidden="true" className="size-5 shrink-0 text-brand" />
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
              // Google bills a map per instantiation, so it loads only on request.
              <button
                className="flex min-h-16 w-full items-center gap-3.5 px-4 py-3 text-left outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-inset sm:px-5"
                onClick={() => setMapRevealed(true)}
                type="button"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-secondary text-secondary-foreground">
                  <Icons.MapView aria-hidden="true" className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    {t('showMapTitle', { count: selectedMapPoints.length })}
                  </span>
                  <span className="block text-[length:var(--text-metadata)] text-muted-foreground">
                    {t('mapPlaceCount', { count: selectedMapPoints.length })}
                  </span>
                </span>
              </button>
            )}
          </section>
        </aside>
      </motion.div>

      <div className="sticky bottom-[calc(var(--bottom-bar-height)+var(--safe-bottom)+var(--nav-action-overhang)+0.5rem)] z-20 md:bottom-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-2.5 rounded-[var(--radius-2xl)] border border-border-subtle bg-card/95 p-3 shadow-[var(--shadow-elevated)] supports-backdrop-filter:backdrop-blur-md sm:flex-row sm:items-center sm:gap-4 sm:pl-5">
          {/* On a phone the hero already says this is not a trip yet; the line
              stays only while it explains why Create trip is unavailable. */}
          <p
            className={cn(
              'px-1 text-[length:var(--text-metadata)] text-muted-foreground sm:block sm:flex-1 sm:px-0',
              !regenerating && 'hidden',
            )}
          >
            {regenerating ? t('regeneratingDock') : t('dockHint')}
          </p>
          <div className="flex gap-2">
            <Button
              className="h-12 rounded-full px-5"
              disabled={!reviewing || publishing || regenerating}
              onClick={() => openAdjust()}
              type="button"
              variant="outline"
            >
              <PencilLine aria-hidden="true" data-icon="inline-start" />
              {t('adjust')}
            </Button>
            <Button
              className="h-12 flex-1 rounded-full px-6 sm:flex-none"
              disabled={!canApply || publishing || regenerating}
              onClick={() => setConfirmApply(true)}
              type="button"
            >
              {t('apply')}
            </Button>
          </div>
        </div>
      </div>

      <AiPlanningAdjustSheet
        availability={allowanceQuery.data?.availability}
        busy={publishing}
        initialTray={adjust.tray}
        onOpenChange={(open) => setAdjust((current) => ({ ...current, open }))}
        onSelectionsChange={setRegenerateSelections}
        onSubmit={() => void regenerate()}
        onValueChange={setRegeneratePrompt}
        open={adjust.open}
        selections={regenerateSelections}
        tripName={tripName}
        value={regeneratePrompt}
      />

      <Dialog onOpenChange={setEditingDetails} open={editingDetails}>
        <DialogContent closeLabel={t('close')}>
          <form
            className="grid gap-6"
            onSubmit={(event) => {
              event.preventDefault();
              setName(nameDraft);
              setDescription(descriptionDraft);
              setEditingDetails(false);
              void saveName(nameDraft);
              void saveDescription(descriptionDraft);
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('editTitle')}</DialogTitle>
              <DialogDescription>{t('editDescription')}</DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="review-trip-name">{t('tripName')}</FieldLabel>
              <Input
                id="review-trip-name"
                onChange={(event) => setNameDraft(event.target.value)}
                value={nameDraft}
              />
              <FieldDescription>{t('nameHint')}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="review-trip-description">{t('tripDescription')}</FieldLabel>
              <Textarea
                id="review-trip-description"
                onChange={(event) => setDescriptionDraft(event.target.value)}
                rows={4}
                value={descriptionDraft}
              />
              <FieldDescription>{t('descriptionHint')}</FieldDescription>
            </Field>
            <DialogFooter>
              <Button onClick={() => setEditingDetails(false)} type="button" variant="outline">
                {t('cancel')}
              </Button>
              <Button type="submit">{t('save')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <p aria-live="polite" className="sr-only">
        {savingName ? t('nameSaving') : savingDescription ? t('descriptionSaving') : ''}
      </p>

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

/** Whose word a detail is: the traveller's, Trove's guess, or one still needed from them. */
function SourceTag({ source }: Readonly<{ source: 'needed' | 'picked' | 'you' }>) {
  const t = useTranslations('trips.aiPlanning.review');
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-semibold whitespace-nowrap',
        source === 'you' && 'bg-secondary text-secondary-foreground',
        source === 'picked' &&
          'border border-status-warning/30 bg-surface-tint text-status-warning',
        source === 'needed' && 'bg-status-warning text-primary-foreground',
      )}
    >
      {source === 'you' ? t('fromYou') : source === 'picked' ? t('wePicked') : t('needsYou')}
    </span>
  );
}

function ChangeInBrief({
  disabled,
  onClick,
}: Readonly<{ disabled: boolean; onClick: () => void }>) {
  const t = useTranslations('trips.aiPlanning.review');
  return (
    <Button
      className="-ml-3 h-9 text-brand hover:text-brand-strong"
      disabled={disabled}
      onClick={onClick}
      size="sm"
      type="button"
      variant="ghost"
    >
      {t('changeInBrief')}
    </Button>
  );
}

function FilledInRow({
  action = null,
  detail = null,
  label,
  source,
  value,
}: Readonly<{
  action?: ReactNode;
  detail?: string | null;
  label: string;
  source?: 'picked' | 'you';
  value: string;
}>) {
  return (
    <li className="space-y-1 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[length:var(--text-metadata)] text-muted-foreground">{label}</p>
          <p className="font-semibold">{value}</p>
        </div>
        {source ? <SourceTag source={source} /> : null}
      </div>
      {detail ? (
        <p className="text-[length:var(--text-metadata)] leading-snug text-muted-foreground">
          {detail}
        </p>
      ) : null}
      {action}
    </li>
  );
}

/**
 * One stop on a day's timeline. An exact time is a filled marker; a time of
 * day is an open one, so an estimate never reads as a booking.
 */
function ItineraryStop({
  adjustedAfter,
  draft,
  item,
  last,
  locale,
  timeFormat,
}: Readonly<{
  adjustedAfter: string | null;
  draft: AiPlanningDraft;
  item: AiPlanningDraftItem;
  last: boolean;
  locale: string;
  timeFormat: '12h' | '24h';
}>) {
  const t = useTranslations('trips.aiPlanning.review');
  const place = item.placeRefId
    ? draft.places.find((candidate) => candidate.id === item.placeRefId)
    : null;
  const exact = item.schedule.kind === 'exact';
  const mustGo = item.priority === 'must_go';
  return (
    <li className="grid grid-cols-[4.5rem_0.75rem_minmax(0,1fr)] gap-x-3">
      <span
        className={cn(
          'pt-0.5 text-sm font-semibold tabular-nums',
          !exact && 'font-medium text-muted-foreground',
        )}
      >
        {item.schedule.kind === 'exact'
          ? formatSegmentedTime(item.schedule.localTime, locale, timeFormat).text
          : t(`dayParts.${item.schedule.dayPart}`)}
      </span>
      <span aria-hidden="true" className="flex flex-col items-center">
        <span
          className={cn(
            'mt-1.5 size-2.5 shrink-0 rounded-full',
            exact ? (mustGo ? 'bg-accent-strong' : 'bg-brand') : 'border-2 border-brand',
          )}
        />
        {last ? null : <span className="mt-1 w-0.5 flex-1 rounded-full bg-border-subtle" />}
      </span>
      <div className="min-w-0 space-y-1 pb-4">
        <p className="font-semibold [overflow-wrap:anywhere]">{item.label}</p>
        <p className="text-[length:var(--text-metadata)] text-muted-foreground">
          {formatPlannedDuration(item.durationMinutes, locale)}
        </p>
        {mustGo || item.origin === 'user' || place ? (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {mustGo ? (
              <span className="inline-flex h-6 items-center gap-1 rounded-full bg-accent-strong px-2.5 text-xs font-semibold text-primary-foreground">
                <Icons.MustGo aria-hidden="true" className="size-3" />
                {t('mustGo')}
              </span>
            ) : null}
            {item.origin === 'user' ? (
              <span className="inline-flex h-6 items-center rounded-full bg-secondary px-2.5 text-xs font-semibold text-secondary-foreground">
                {t('travelerSupplied')}
              </span>
            ) : null}
            {/* Which provider found a place is Trove's problem, not the
                traveller's. What they are deciding here is whether to trust
                the plan, and for that the only thing that matters is that the
                place is real. */}
            {place?.resolution === 'verified' ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-status-success">
                <CircleCheck aria-hidden="true" className="size-3.5" />
                {t('verifiedPlace')}
              </span>
            ) : place?.verification === 'not_checked' ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-status-warning">
                <CircleDashed aria-hidden="true" className="size-3.5" />
                {t('customPlace.not_checked')}
              </span>
            ) : null}
          </div>
        ) : null}
        {adjustedAfter ? (
          <p className="text-[length:var(--text-metadata)] text-muted-foreground">
            {t('scheduleAdjusted', { other: adjustedAfter })}
          </p>
        ) : null}
      </div>
    </li>
  );
}

const MAX_LISTED_CHANGES = 5;

/** What a regenerate changed, so a new version never has to be reread from the top. */
function ReviewChanges({
  changes,
  formatDateRange,
  onDismiss,
}: Readonly<{
  changes: AiPlanningDraftChanges;
  formatDateRange: (startDate: string, endDate: string) => string;
  onDismiss: () => void;
}>) {
  const t = useTranslations('trips.aiPlanning.review');
  const dayLabel = (day: number | null) =>
    day === null ? t('unscheduled') : t('day', { number: day });
  const listed = changes.items.slice(0, MAX_LISTED_CHANGES);
  const hidden = changes.items.length - listed.length;
  return (
    <section
      aria-labelledby="ai-review-changes"
      className="rounded-[var(--radius-xl)] border border-brand/35 bg-card px-4 pt-4 shadow-[var(--shadow-surface)] sm:px-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-lg font-semibold" id="ai-review-changes">
          {t('changesTitle')}
        </h2>
        <p className="text-[length:var(--text-metadata)] text-muted-foreground">
          {t('changesHint')}
        </p>
      </div>
      <ul className="mt-2 divide-y divide-border-subtle">
        {changes.dates ? (
          <ChangeRow icon={<CalendarRange aria-hidden="true" />} tone="neutral">
            {t('changeDates', {
              range: formatDateRange(changes.dates.to.startDate, changes.dates.to.endDate),
            })}
          </ChangeRow>
        ) : null}
        {listed.map((change) => (
          <ChangeRow
            detail={
              change.kind === 'added'
                ? t('changeAdded', { day: dayLabel(change.day) })
                : change.kind === 'moved'
                  ? t('changeMoved', { from: dayLabel(change.from), to: dayLabel(change.to) })
                  : t('changeRemoved', { day: dayLabel(change.day) })
            }
            icon={
              change.kind === 'added' ? (
                <Plus aria-hidden="true" />
              ) : change.kind === 'moved' ? (
                <ArrowLeftRight aria-hidden="true" />
              ) : (
                <Minus aria-hidden="true" />
              )
            }
            key={`${change.kind}:${change.label}`}
            tone={
              change.kind === 'added' ? 'added' : change.kind === 'removed' ? 'removed' : 'neutral'
            }
          >
            {change.label}
          </ChangeRow>
        ))}
        {!changes.dates && !changes.items.length ? (
          <li className="py-3 text-sm text-muted-foreground">{t('changesNone')}</li>
        ) : null}
        {hidden > 0 ? (
          <li className="py-3 text-sm text-muted-foreground">
            {t('changesMore', { count: hidden })}
          </li>
        ) : null}
      </ul>
      <div className="border-t border-border-subtle py-1">
        <Button
          className="-ml-3 text-brand hover:text-brand-strong"
          onClick={onDismiss}
          type="button"
          variant="ghost"
        >
          {t('dismissChanges')}
        </Button>
      </div>
    </section>
  );
}

function ChangeRow({
  children,
  detail,
  icon,
  tone,
}: Readonly<{
  children: ReactNode;
  detail?: string;
  icon: ReactNode;
  tone: 'added' | 'neutral' | 'removed';
}>) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-full [&_svg]:size-3.5',
          tone === 'added' && 'bg-secondary text-secondary-foreground',
          tone === 'neutral' && 'bg-muted text-foreground',
          tone === 'removed' && 'bg-destructive/10 text-destructive',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-semibold [overflow-wrap:anywhere]">{children}</span>
        {detail ? (
          <span className="block text-[length:var(--text-metadata)] text-muted-foreground">
            {detail}
          </span>
        ) : null}
      </span>
    </li>
  );
}
