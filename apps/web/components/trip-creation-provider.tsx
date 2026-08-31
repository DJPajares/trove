'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { AiPlanningComposer } from '@/components/ai-planning-composer';
import { TripForm } from '@/components/trip-form';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';
import { recoverAiPlanningSession, type AiPlanningSession } from '@/lib/ai-planning/api';
import { queryKeys } from '@/lib/query/keys';
import type { Trip } from '@/lib/trips/api';

type TripCreationContextValue = {
  latestCreatedTrip: Trip | null;
  openCreateTrip: () => void;
};

type TripCreationProviderProps = {
  children: ReactNode;
  enabled: boolean;
};

const TripCreationContext = createContext<TripCreationContextValue | null>(null);
const disabledTripCreationContext: TripCreationContextValue = {
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
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [creationMode, setCreationMode] = useState<'ai' | 'manual'>('ai');
  const [latestCreatedTrip, setLatestCreatedTrip] = useState<Trip | null>(null);
  const recoveryQuery = useQuery({
    enabled,
    queryFn: recoverAiPlanningSession,
    queryKey: queryKeys.aiPlanningRecovery(),
  });
  const recoveredSession = recoveryQuery.data?.session ?? null;

  useEffect(() => {
    if (!recoveredSession) return;
    if (recoveredSession.status === 'reviewing') {
      setOpen(false);
      const href = `/trips/ai/${recoveredSession.id}`;
      if (pathname !== href) router.replace(href);
      return;
    }
    setCreationMode('ai');
    setOpen(true);
  }, [pathname, recoveredSession, router]);

  const recover = useCallback(async () => {
    const result = await recoveryQuery.refetch();
    return result.data?.session ?? null;
  }, [recoveryQuery.refetch]);
  const openCreateTrip = useCallback(() => {
    setCreationMode('ai');
    setOpen(true);
    void recover();
  }, [recover]);
  const context = useMemo(
    () => (enabled ? { latestCreatedTrip, openCreateTrip } : disabledTripCreationContext),
    [enabled, latestCreatedTrip, openCreateTrip],
  );

  function handleSaved(trip: Trip) {
    setLatestCreatedTrip(trip);
    setOpen(false);
  }

  const handlePlanningSessionChange = useCallback(
    (session: AiPlanningSession | null) => {
      queryClient.setQueryData(queryKeys.aiPlanningRecovery(), { session });
    },
    [queryClient],
  );

  return (
    <TripCreationContext.Provider value={context}>
      {children}
      {enabled ? (
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
                  <AiPlanningComposer
                    onRecover={recover}
                    onSessionChange={handlePlanningSessionChange}
                    recoveredSession={recoveredSession}
                  />
                </TabsPanel>
                <TabsPanel className="flex min-h-0 flex-1 flex-col" value="manual">
                  <TripForm onCancel={() => setOpen(false)} onSaved={handleSaved} trip={null} />
                </TabsPanel>
              </Tabs>
            ) : null}
          </SheetContent>
        </Sheet>
      ) : null}
    </TripCreationContext.Provider>
  );
}
