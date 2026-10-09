'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { AiPlanningDraftCard } from '@/components/ai-planning-draft-card';
import { HomeBeforeYouGo } from '@/components/home/home-before-you-go';
import { HomeComingUp } from '@/components/home/home-coming-up';
import { HomeEmpty, HomeHeadline, HomeIdle, HomeSkeleton } from '@/components/home/home-front-door';
import { HomeHero } from '@/components/home/home-hero';
import { HomeJourney } from '@/components/home/home-journey';
import { HomeToday } from '@/components/home/home-today';
import { HomeNowStrip } from '@/components/home-now-strip';
import { PageState } from '@/components/page-state';
import { useTripCreation } from '@/components/trip-creation-provider';
import { Button } from '@/components/ui/button';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import { selectCompletedPrompt } from '@/lib/home/completed-prompt';
import { resolveHomeMoment } from '@/lib/home/moment';
import { deviceTimeZone, fetchTripModeContext } from '@/lib/itinerary/api';
import { editorialCoverImage, editorialSubjectKey } from '@/lib/media/editorial-images';
import { queryKeys } from '@/lib/query/keys';
import { fetchTrips, type Trip } from '@/lib/trips/api';
import { tripDayProgress } from '@/lib/trips/library';
import { daysUntilTripStart, resolveCountdown } from '@/lib/trips/lifecycle';
import { tripEditorialSubject } from '@/lib/trips/summary';

/**
 * A traveller who skips Memories or a rating should be asked once, not every
 * time they open Home. The dismissal is per trip and purely local: it hides a
 * suggestion, so it never needs to travel with the account.
 */
const DISMISSED_PROMPTS_KEY = 'trove.dismissed-completed-prompts';

function readDismissedPrompts() {
  try {
    const raw = window.localStorage.getItem(DISMISSED_PROMPTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** Where in a trip under way today falls, as the headline says it. */
function dayPosition(day: number, total: number) {
  if (total === 1) return 'only';
  if (day === 1) return 'first';
  if (day === total) return 'last';
  return 'other';
}

const EMPTY_TRIPS: Trip[] = [];

/**
 * Home: the front door to the traveller's world in Trove, and the one screen
 * that changes with where they are in it (PRD 9).
 *
 * It opens on a single sentence about right now - "12 days until Kyoto in
 * November", "Day 3 of Singapore Art and Eats", "Welcome back from Lisbon" -
 * and then shows only what that moment needs. A trip being planned brings the
 * few things it still asks for; a trip under way brings the rest of today; a
 * trip just finished brings its photographs and the way into its story. After
 * that, a glance at what is coming and one past journey worth returning to.
 * Everything else lives where it belongs - the Trips library, the planner,
 * Trip Mode, the journal - and Home only ever points there.
 */
export function HomeExperience() {
  const t = useTranslations('home');
  const { latestCreatedTrip, openCreateTrip } = useTripCreation();
  const queryClient = useQueryClient();
  // Shared with the Trips library, so arriving at Home from it costs nothing.
  const tripsQuery = useQuery({ queryFn: fetchTrips, queryKey: queryKeys.trips() });
  const [dismissedPrompts, setDismissedPrompts] = useState<string[]>([]);

  useEffect(() => {
    setDismissedPrompts(readDismissedPrompts());
  }, []);

  function dismissCompletedPrompt(tripId: string) {
    setDismissedPrompts((current) => {
      const next = current.includes(tripId) ? current : [...current, tripId];
      try {
        window.localStorage.setItem(DISMISSED_PROMPTS_KEY, JSON.stringify(next));
      } catch {
        // The prompt stays hidden for this session even without local storage.
      }
      return next;
    });
  }

  const trips = tripsQuery.data?.trips ?? EMPTY_TRIPS;
  const status = tripsQuery.isPending ? 'loading' : tripsQuery.error ? 'error' : 'idle';

  useEffect(() => {
    if (!latestCreatedTrip) return;
    queryClient.setQueryData(queryKeys.trips(), (current: { trips: Trip[] } | undefined) =>
      !current || current.trips.some((trip) => trip.id === latestCreatedTrip.id)
        ? current
        : { ...current, trips: [...current.trips, latestCreatedTrip] },
    );
  }, [latestCreatedTrip, queryClient]);

  const { comingUp, journey, lead } = useMemo(() => resolveHomeMoment(trips), [trips]);

  /**
   * Home asks for one trip's "now", never one per trip - this endpoint can
   * reach Routes and Places, and a per-trip loop over it is exactly the shape
   * that turns a home screen into a bill. Trip Mode and the Trips library read
   * the same key, so moving between them reuses this answer.
   */
  const activeTripId = lead?.lifecycle === 'active' ? lead.id : null;
  // Trip Mode runs on the traveller's own clock, and including the language is
  // what makes this the same query as Trip Mode's rather than a second one.
  const clockTimeZone = deviceTimeZone();
  const languageCode = useLocale();
  const tripModeContextQuery = useQuery({
    enabled: activeTripId !== null,
    queryFn: ({ signal }) =>
      fetchTripModeContext(activeTripId as string, { clockTimeZone, languageCode, signal }),
    queryKey: queryKeys.tripModeContext(activeTripId ?? '', { clockTimeZone, languageCode }),
  });

  // One capped request resolves every photograph Home may draw. Nothing below
  // asks the editorial service itself.
  const shownTrips = useMemo(
    () => [lead, ...comingUp, journey?.trip].filter((trip): trip is Trip => Boolean(trip)),
    [comingUp, journey, lead],
  );
  const editorialImages = useEditorialImages(
    shownTrips.flatMap((trip) => tripEditorialSubject(trip) ?? []),
  );
  const editorialFor = (trip: Trip) => {
    const subject = tripEditorialSubject(trip);
    return subject
      ? editorialCoverImage(editorialImages.get(editorialSubjectKey(subject)), trip.id)
      : null;
  };

  if (status === 'loading') {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-5">
        <HomeNowStrip />
        <HomeSkeleton label={t('loading')} />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <PageState
        actions={<Button onClick={() => window.location.reload()}>{t('tryAgain')}</Button>}
        description={t('loadErrorDescription')}
        icon={<CircleAlert aria-hidden="true" />}
        kind="error"
        title={t('loadError')}
      />
    );
  }

  const headline = (() => {
    if (!lead) {
      return trips.length
        ? { lead: t('headline.idleLead'), subject: t('headline.idleSubject') }
        : { lead: t('headline.emptyLead'), subject: t('headline.emptySubject') };
    }
    if (lead.lifecycle === 'active') {
      const { day, total } = tripDayProgress(lead);
      return {
        lead: t('headline.active', { day, position: dayPosition(day, total) }),
        subject: lead.name,
      };
    }
    if (lead.lifecycle === 'planning') {
      const countdown = resolveCountdown(daysUntilTripStart(lead));
      return {
        lead: t('headline.planning', { count: countdown.value, unit: countdown.unit }),
        subject: lead.name,
      };
    }
    return { lead: t('headline.returned'), subject: lead.name };
  })();

  return (
    <div className="mx-auto w-full max-w-5xl space-y-10 sm:space-y-12">
      <header className="space-y-5">
        <HomeNowStrip />
        <HomeHeadline lead={headline.lead} subject={headline.subject} />
        {!lead && trips.length ? <HomeIdle onCreateTrip={openCreateTrip} /> : null}
      </header>

      {trips.length === 0 ? (
        <>
          {/* A draft is reachable on a traveller's very first visit, before
              there is any trip for it to sit among. */}
          <AiPlanningDraftCard />
          <HomeEmpty onCreateTrip={openCreateTrip} />
        </>
      ) : null}

      {lead && lead.lifecycle !== 'completed' ? (
        <section
          aria-labelledby="home-heading"
          className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start lg:gap-8"
        >
          <HomeHero editorial={editorialFor(lead)} trip={lead} />
          {lead.lifecycle === 'active' ? (
            <HomeToday
              context={tripModeContextQuery.data ?? null}
              loading={tripModeContextQuery.isPending}
              trip={lead}
            />
          ) : (
            <HomeBeforeYouGo trip={lead} />
          )}
        </section>
      ) : null}

      {lead?.lifecycle === 'completed' ? (
        <HomeJourney
          editorial={editorialFor(lead)}
          onDismissPrompt={dismissCompletedPrompt}
          promptKey={selectCompletedPrompt(lead, dismissedPrompts)}
          trip={lead}
          variant="returned"
        />
      ) : null}

      {trips.length ? <AiPlanningDraftCard /> : null}

      {comingUp.length ? <HomeComingUp editorialFor={editorialFor} trips={comingUp} /> : null}

      {/* One paper band per screen: a trip just finished already is Home's
          story, so no second journey is offered beneath it. */}
      {journey && lead?.lifecycle !== 'completed' ? (
        <HomeJourney
          editorial={editorialFor(journey.trip)}
          journey={journey}
          trip={journey.trip}
          variant="journey"
        />
      ) : null}
    </div>
  );
}
