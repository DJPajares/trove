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
import { TripForm } from '@/components/trip-form';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';
import { useAiPlanningLifecycle } from '@/lib/ai-planning/use-lifecycle';
import type { Trip } from '@/lib/trips/api';

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
    setTakeoverPhase(null);
    setCreationMode('ai');
    setOpen(true);
  }, [running, session?.status, takeoverPhase]);

  // The handoff. A draft that arrived under the takeover gets a beat to land on,
  // and the takeover stays mounted across the redirect so its own fade is what
  // covers the review screen's first paint. A draft recovered on a cold load has
  // no takeover to hand off from and goes straight through.
  useEffect(() => {
    if (session?.status !== 'reviewing') return;
    const href = `/trips/ai/${session.id}`;
    const navigate = () => {
      handedOff.current = false;
      setOpen(false);
      setTakeoverPhase(null);
      if (pathname !== href) router.replace(href);
    };

    if (!handedOff.current) {
      navigate();
      return;
    }

    setTakeoverPhase('landing');
    const timer = window.setTimeout(navigate, reducedMotion ? 0 : LANDING_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [pathname, reducedMotion, router, session?.id, session?.status]);

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
              className="w-full md:data-[side=right]:w-[min(36rem,calc(100%-0.5rem))]"
              closeLabel={t('close')}
            >
              <SheetHeader className="border-b">
                <SheetTitle>{t('createTitle')}</SheetTitle>
                <SheetDescription>{t('aiPlanning.description')}</SheetDescription>
              </SheetHeader>
              {open ? (
                <Tabs
                  className="flex min-h-0 flex-1 flex-col gap-4"
                  onValueChange={(value) => setCreationMode(value as 'ai' | 'manual')}
                  value={creationMode}
                >
                  <TabsList className="mx-5 w-fit" variant="segmented">
                    <TabsTab value="ai" variant="segmented">
                      {t('aiPlanning.tab')}
                    </TabsTab>
                    <TabsTab value="manual" variant="segmented">
                      {t('aiPlanning.manualTab')}
                    </TabsTab>
                    <TabsIndicator variant="segmented" />
                  </TabsList>
                  <TabsPanel className="flex min-h-0 flex-1 flex-col" value="ai">
                    <AiPlanningComposer lifecycle={lifecycle} />
                  </TabsPanel>
                  <TabsPanel className="flex min-h-0 flex-1 flex-col" value="manual">
                    <TripForm onCancel={() => setOpen(false)} onSaved={handleSaved} trip={null} />
                  </TabsPanel>
                </Tabs>
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
