'use client';

import { AnimatePresence, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { AiPlanningComposer } from '@/components/ai-planning-composer';
import { AiPlanningGeneratingOverlay } from '@/components/ai-planning-generating-overlay';
import { journalSerif } from '@/components/memories/journal-font';
import { TripForm } from '@/components/trip-form';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useAiPlanningLifecycle } from '@/lib/ai-planning/use-lifecycle';
import * as Icons from '@/lib/icons';
import type { Trip } from '@/lib/trips/api';
import { cn } from '@/lib/utils';

/**
 * How long the finished route stays on screen before the itinerary takes over.
 * Short enough not to be a delay, long enough that the last stop lighting up is
 * a moment rather than a flicker.
 */
const LANDING_HOLD_MS = 800;

type TripCreationContextValue = {
  forgetCreatedTrip: (tripId: string) => void;
  latestCreatedTrip: Trip | null;
  openCreateTrip: () => void;
};

type TripCreationProviderProps = {
  children: ReactNode;
  enabled: boolean;
};

const TripCreationContext = createContext<TripCreationContextValue | null>(null);
const disabledTripCreationContext: TripCreationContextValue = {
  forgetCreatedTrip: () => undefined,
  latestCreatedTrip: null,
  openCreateTrip: () => undefined,
};

export function useTripCreation() {
  const context = useContext(TripCreationContext);
  if (!context) throw new Error('useTripCreation must be used within TripCreationProvider');
  return context;
}

/** One creation sheet follows the signed-in shell, so starting a trip never changes routes. */
export function TripCreationProvider({ children, enabled }: Readonly<TripCreationProviderProps>) {
  const t = useTranslations('trips');
  const pathname = usePathname();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [creationMode, setCreationMode] = useState<'ai' | 'manual'>('ai');
  const [latestCreatedTrip, setLatestCreatedTrip] = useState<Trip | null>(null);
  const [takeoverPhase, setTakeoverPhase] = useState<'landing' | 'working' | null>(null);
  const lifecycle = useAiPlanningLifecycle(enabled);
  const { cancel, generating, operation, refreshRecovery, session } = lifecycle;
  const running = operation === 'starting' || generating;
  // Whether the draft about to arrive is one this screen watched being built.
  // A `reviewing` session recovered on a cold load has nothing to hand off from.
  const handedOff = useRef(false);
  // Which draft has already been resumed. A draft is worth one redirect, not one
  // per navigation — see the handoff effect below.
  const resumedSessionId = useRef<string | null>(null);
  // Read inside the handoff effect without making it a dependency, so arriving at
  // a route cannot re-trigger a resume.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  // The takeover and the sheet are mutually exclusive: both trap focus, and only
  // one of them has anything to say while a plan is being built.
  useEffect(() => {
    if (!running) return;
    handedOff.current = true;
    setTakeoverPhase((current) => current ?? 'working');
    setOpen(false);
  }, [running]);

  // Anything that is neither a run in flight nor a draft landing ends the
  // takeover and hands the traveller back to the sheet, which is where a failed
  // or cancelled run explains itself.
  useEffect(() => {
    if (takeoverPhase !== 'working' || running || session?.status === 'reviewing') return;
    handedOff.current = false;
    resumedSessionId.current = null;
    setTakeoverPhase(null);
    setCreationMode('ai');
    setOpen(true);
  }, [running, session?.status, takeoverPhase]);

  // The handoff, and only the handoff. A draft that arrived under the takeover
  // gets a beat to land on, and the takeover stays mounted across the redirect
  // so its own fade is what covers the review screen's first paint.
  //
  // A draft recovered on a cold load is deliberately left alone. Redirecting it
  // made leaving a draft impossible to mean: the traveller walked away, and the
  // next page load put them back. The Trips page carries the draft card that
  // takes them back when they choose to go.
  //
  // Still once per draft, so the beat cannot replay on a later render.
  useEffect(() => {
    if (
      session?.status !== 'reviewing' ||
      resumedSessionId.current === session.id ||
      !handedOff.current
    ) {
      return;
    }
    resumedSessionId.current = session.id;
    const href = `/trips/ai/${session.id}`;

    setTakeoverPhase('landing');
    const timer = window.setTimeout(
      () => {
        handedOff.current = false;
        setOpen(false);
        setTakeoverPhase(null);
        if (pathnameRef.current !== href) router.replace(href);
      },
      reducedMotion ? 0 : LANDING_HOLD_MS,
    );
    return () => window.clearTimeout(timer);
  }, [reducedMotion, router, session?.id, session?.status]);

  const openCreateTrip = useCallback(() => {
    setCreationMode('ai');
    setOpen(true);
    refreshRecovery();
  }, [refreshRecovery]);
  const forgetCreatedTrip = useCallback((tripId: string) => {
    setLatestCreatedTrip((current) => (current?.id === tripId ? null : current));
  }, []);
  const context = useMemo(
    () =>
      enabled
        ? { forgetCreatedTrip, latestCreatedTrip, openCreateTrip }
        : disabledTripCreationContext,
    [enabled, forgetCreatedTrip, latestCreatedTrip, openCreateTrip],
  );

  function handleSaved(trip: Trip) {
    setLatestCreatedTrip(trip);
    setOpen(false);
  }

  return (
    <TripCreationContext.Provider value={context}>
      {children}
      {enabled ? (
        <>
          <Sheet onOpenChange={setOpen} open={open}>
            <SheetContent
              className={cn(
                journalSerif.variable,
                'w-full gap-3 bg-background md:data-[side=right]:w-[min(36rem,calc(100%-0.5rem))]',
                creationMode === 'ai' && 'h-[90dvh] md:h-full',
              )}
              closeLabel={t('close')}
            >
              {/* The AI brief leads, and setting the trip up by hand is one tap
                  beside its main action rather than a tab above it. Either way
                  is the same sheet, so switching never loses the brief. */}
              {open && creationMode === 'ai' ? (
                <AiPlanningComposer
                  lifecycle={lifecycle}
                  onCreateManually={() => setCreationMode('manual')}
                />
              ) : null}
              {open && creationMode === 'manual' ? (
                <>
                  <SheetHeader className="gap-3">
                    <Button
                      className="-ml-3 self-start text-brand hover:text-brand-strong"
                      onClick={() => setCreationMode('ai')}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <Icons.Ai aria-hidden="true" data-icon="inline-start" />
                      {t('aiPlanning.backToAi')}
                    </Button>
                    <SheetTitle>{t('createTitle')}</SheetTitle>
                    <SheetDescription>{t('createDescription')}</SheetDescription>
                  </SheetHeader>
                  <TripForm onCancel={() => setOpen(false)} onSaved={handleSaved} trip={null} />
                </>
              ) : null}
            </SheetContent>
          </Sheet>
          <AnimatePresence>
            {takeoverPhase ? (
              <AiPlanningGeneratingOverlay
                cancelling={operation === 'cancelling'}
                key="ai-planning-generating"
                onCancel={() => void cancel()}
                phase={takeoverPhase}
                stage={session?.stage ?? 'created'}
              />
            ) : null}
          </AnimatePresence>
        </>
      ) : null}
    </TripCreationContext.Provider>
  );
}
