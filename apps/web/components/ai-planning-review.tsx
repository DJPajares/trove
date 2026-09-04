'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CircleAlert, CircleCheck, MapPinned, Sparkles } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ItineraryPlanningMap } from '@/components/itinerary-planning-map';
import { PageState } from '@/components/page-state';
import { PlanScorePanel } from '@/components/plan-score-panel';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
  regenerateAiPlanningSession,
  setAiPlanningTripDescription,
  setAiPlanningTripName,
  type AiPlanningSession,
  type AiPlanningDraft,
} from '@/lib/ai-planning/api';
import {
  activeAiPlanningAssumptions,
  aiPlanningAssumptionMessageValues,
  aiPlanningReviewPageState,
  appliedAiPlanningSession,
  buildAiPlanningReviewMapPoints,
} from '@/lib/ai-planning/review';
import {
  aiPlanningErrorMessageKey,
  isAiPlanningSessionGenerating,
} from '@/lib/ai-planning/presentation';
import { motionDuration, motionEase } from '@/lib/motion';
import { queryKeys } from '@/lib/query/keys';
import type { Trip } from '@/lib/trips/api';

const ACTIVE_SESSION_POLL_MS = 1_500;

type ReviewOperation = 'acknowledging' | 'applying' | 'idle' | 'regenerating';

export function AiPlanningReview({ sessionId }: Readonly<{ sessionId: string }>) {
  const t = useTranslations('trips.aiPlanning.review');
  const general = useTranslations('trips.aiPlanning');
  const planScoreCopy = useTranslations('planScore');
  const locale = useLocale();
  const reducedMotion = useReducedMotion();
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
  const [operation, setOperation] = useState<ReviewOperation>('idle');
  const [error, setError] = useState<string | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  const [regeneratePrompt, setRegeneratePrompt] = useState('');
  const [description, setDescription] = useState('');
  const [savingDescription, setSavingDescription] = useState(false);
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const sessionRef = useRef<AiPlanningSession | null>(null);

  // The draft is whatever generation produced, so the server copy is always the
  // truth and there is nothing local to reconcile against it.
  useEffect(() => {
    sessionRef.current = session;
    if (!session?.draft) return;
    setDraft(session.draft);
    setRegeneratePrompt(session.prompt ?? '');
  }, [session?.draft, session?.draftRevision, session?.prompt]);

  // The model drafts a description and the traveller's edit overrides it, so the
  // field is seeded from the session's own copy first. It reads through
  // `session.draft` rather than the `draft` state so it does not depend on which
  // of the two effects ran first.
  const draftedDescription = session?.draft?.trip.description ?? '';
  useEffect(() => {
    setDescription(session?.tripDescription ?? draftedDescription);
  }, [draftedDescription, session?.id, session?.tripDescription]);

  // Same contract as the description: seeded from the session's own copy
  // first, read through `session.draft` rather than `draft` state so it does
  // not depend on effect ordering.
  const draftedName = session?.draft?.trip.name ?? '';
  useEffect(() => {
    setName(session?.tripName ?? draftedName);
  }, [draftedName, session?.id, session?.tripName]);

  useEffect(() => {
    if (!session?.appliedTripId) return;
    router.replace(`/trips/${session.appliedTripId}`);
  }, [router, session?.appliedTripId]);

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

  /**
   * The only write a reviewed session accepts. It is session metadata beside the
   * draft, so it needs no revision and cannot invalidate the plan.
   */
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
      const saved = sessionRef.current ?? session;
      if (!saved.draft) {
        setConfirmApply(false);
        return;
      }
      const latestMaterialWarnings = saved.draft.warnings.filter((warning) => warning.material);
      const latestWarningsAcknowledged =
        !latestMaterialWarnings.length ||
        saved.warningAcknowledgement?.revision === saved.draftRevision;
      if (!latestWarningsAcknowledged) {
        setConfirmApply(false);
        return;
      }
      const deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
      const result = await applyAiPlanningSession(saved.id, saved.draftRevision, deviceTimeZone);
      const applied = appliedAiPlanningSession(saved, result.trip.id);
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

  const pageState = aiPlanningReviewPageState(session, draft, sessionQuery.isPending);
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
          <Sparkles aria-hidden="true" />
          <AlertTitle>{general(`stages.${session.stage}`)}</AlertTitle>
          <AlertDescription>{t('regeneratingHint')}</AlertDescription>
        </Alert>
      ) : null}
      {placeVerification.none ? (
        <Alert role="status" variant="warning">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>{t('noVerifiedPlacesTitle')}</AlertTitle>
          <AlertDescription>{t('noVerifiedPlacesHint')}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>{general(`errors.${aiPlanningErrorMessageKey(error)}`)}</AlertTitle>
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
                              ? item.schedule.localTime
                              : t(`dayParts.${item.schedule.dayPart}`)}{' '}
                            · {t('duration', { minutes: item.durationMinutes })}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.origin === 'user' ? t('travelerSupplied') : t('aiSuggested')}
                          </p>
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
                            ) : (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {t(`customPlace.${place.verification}`)}
                              </p>
                            )
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
            ))}
          </section>

          {draft.unscheduledItems.length ? (
            <section className="rounded-[var(--radius-xl)] border border-border bg-card p-4 sm:p-6">
              <h2 className="font-semibold">{t('unscheduled')}</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {draft.unscheduledItems.map((item) => (
                  <li key={item.id}>{item.label}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          {session.planScore ? (
            <PlanScorePanel
              explanations={session.planScore.explanations}
              score={session.planScore.score}
              scope="trip"
              status="idle"
              title={planScoreCopy('title')}
            />
          ) : null}
          <section
            className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card"
            aria-label={t('mapLabel')}
          >
            {selectedMapPoints.length ? (
              <ItineraryPlanningMap
                onClearSelection={() => setSelectedPointId(null)}
                onSelectPoint={(point) => setSelectedPointId(point.id)}
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
      </motion.div>

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
