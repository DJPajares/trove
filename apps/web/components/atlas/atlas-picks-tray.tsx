'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Briefcase, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { useTripCreation } from '@/components/trip-creation-provider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollShadow } from '@/components/ui/scroll-shadow';
import { Sheet, SheetContent, SheetFooter, SheetHeading } from '@/components/ui/sheet';
import { useAtlasIndex } from '@/hooks/use-atlas-index';
import { useAtlasTripPicks } from '@/hooks/use-atlas-trip-picks';
import * as Icons from '@/lib/icons';
import {
  addIsoDays,
  ATLAS_MAX_TRIP_PICKS,
  atlasPickCategory,
  atlasTripAttribution,
  buildAtlasAiPrompt,
  groupAtlasTripPicks,
  suggestAtlasTripDates,
} from '@/lib/atlas/picks';
import { deviceTimeZone } from '@/lib/itinerary/api';
import { queryKeys } from '@/lib/query/keys';
import { createCustomPlace, updateCustomPlace } from '@/lib/saved/api';
import { addTripPlace, updateTripPlace } from '@/lib/trip-places/api';
import { createTrip } from '@/lib/trips/api';

/**
 * Floating Trip picks tray that follows the traveller across Atlas pages
 * (PRD 40.4). Holds up to 24 picks locally and turns them into a real Trove
 * Trip (0 AI credits) or hands them off to Plan with AI.
 */
export function AtlasPicksTray() {
  const t = useTranslations('atlas.picks');
  const g = useTranslations('atlas.guide');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { openPlanWithAi } = useTripCreation();
  const index = useAtlasIndex();
  const { clearPicks, picks, removePick } = useAtlasTripPicks();

  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => groupAtlasTripPicks(picks), [picks]);
  const primaryCountryCode = groups[0]?.countryCode ?? null;
  const primaryMonths = useMemo(
    () => index.data?.countries.find((c) => c.countryCode === primaryCountryCode)?.months ?? null,
    [index.data?.countries, primaryCountryCode],
  );
  const suggested = useMemo(
    () => suggestAtlasTripDates(primaryMonths, picks.length),
    [picks.length, primaryMonths],
  );

  const [startDate, setStartDate] = useState(suggested.startDate);
  const [days, setDays] = useState(suggested.days);

  useEffect(() => {
    if (!open) {
      setStartDate(suggested.startDate);
      setDays(suggested.days);
      setError(null);
    }
  }, [open, suggested.days, suggested.startDate]);

  if (picks.length === 0) return null;

  const clampedDays = Math.min(30, Math.max(1, Number.isFinite(days) ? Math.round(days) : 3));
  const endDate = addIsoDays(startDate, clampedDays - 1);

  async function handleMakeTrip() {
    if (creating || picks.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const countries = [...new Set(picks.map((pick) => pick.countryCode))];
      const destinations = groups
        .filter((group) => group.destinationSlug)
        .map((group) => ({ name: group.destinationName }));
      const primaryGroup = groups[0]!;
      const tripName =
        groups.length === 1
          ? primaryGroup.destinationSlug
            ? `${primaryGroup.destinationName}, ${primaryGroup.countryName}`
            : primaryGroup.countryName
          : primaryGroup.countryName;

      const { trip } = await createTrip({
        countries,
        description: atlasTripAttribution(picks),
        destinations: destinations.length ? destinations : undefined,
        deviceTimeZone: deviceTimeZone() ?? 'UTC',
        endDate,
        name: tripName,
        partySize: 1,
        planningReadiness: 'in_progress',
        startDate,
      });

      // Add every pick as a Custom Place + Trip Place (0 Google calls, never touching Saved).
      for (const pick of picks) {
        const { place } = await createCustomPlace({ name: pick.name });
        if (pick.latitude !== null && pick.longitude !== null) {
          await updateCustomPlace(place.id, {
            location: { latitude: pick.latitude, longitude: pick.longitude },
          }).catch(() => undefined);
        }
        const { tripPlace } = await addTripPlace(trip.id, place.id);
        await updateTripPlace(trip.id, tripPlace.id, {
          categories: [atlasPickCategory(pick.kind)],
          priority: 'must_go',
        }).catch(() => undefined);
      }

      clearPicks();
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.trips() });
      router.push(`/trips/${trip.id}`);
    } catch {
      setError(t('createError'));
    } finally {
      setCreating(false);
    }
  }

  function handlePlanWithAi() {
    const prompt = buildAtlasAiPrompt(picks, { days: clampedDays, endDate, startDate });
    setOpen(false);
    openPlanWithAi(prompt);
  }

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--bottom-bar-height)+var(--safe-bottom)+0.75rem)] z-30 flex justify-center px-4 md:bottom-6">
        <button
          className="pointer-events-auto inline-flex h-12 items-center gap-2.5 rounded-full border border-border-strong bg-foreground px-5 text-sm font-semibold text-background shadow-lg outline-none transition-transform hover:scale-[1.02] focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
          onClick={() => setOpen(true)}
          type="button"
        >
          <Briefcase aria-hidden="true" className="size-4" />
          <span>{t('trayButton')}</span>
          <span className="rounded-full bg-background/20 px-2 py-0.5 text-xs tabular-nums">
            {picks.length}/{ATLAS_MAX_TRIP_PICKS}
          </span>
        </button>
      </div>

      <Sheet onOpenChange={setOpen} open={open}>
        <SheetContent
          className="w-full gap-3 bg-background md:data-[side=right]:w-[min(32rem,calc(100%-0.5rem))]"
          closeLabel={t('close')}
        >
          <SheetHeading description={t('sheetDescription')} title={t('sheetTitle')} />

          <ScrollShadow className="min-h-0 flex-1 space-y-5 px-5 py-2">
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            {/* Setup: dates & length */}
            <div className="grid grid-cols-2 gap-3 rounded-[var(--radius-xl)] border border-border-subtle bg-card p-4">
              <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                <span>{t('startDate')}</span>
                <Input
                  onChange={(event) => setStartDate(event.target.value)}
                  type="date"
                  value={startDate}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                <span>{t('days')}</span>
                <Input
                  max={30}
                  min={1}
                  onChange={(event) => setDays(Number(event.target.value))}
                  type="number"
                  value={days}
                />
              </label>
            </div>

            {/* Picks grouped by destination */}
            <div className="space-y-4">
              {groups.map((group) => (
                <section className="space-y-2" key={group.key}>
                  <h3 className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                    {group.destinationSlug
                      ? `${group.destinationName} · ${group.countryName}`
                      : group.countryName}
                  </h3>
                  <ul className="divide-y divide-border-subtle overflow-hidden rounded-[var(--radius-xl)] border border-border-subtle bg-card">
                    {group.picks.map((pick) => (
                      <li className="flex items-center gap-3 px-3.5 py-2.5" key={pick.id}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-foreground">
                            {pick.name}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {g(`listing.${pick.kind}`)}
                          </span>
                        </span>
                        <button
                          aria-label={t('remove', { name: pick.name })}
                          className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-surface-hover hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
                          onClick={() => removePick(pick.id)}
                          type="button"
                        >
                          <X aria-hidden="true" className="size-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </ScrollShadow>

          <SheetFooter className="flex flex-col gap-2 border-t border-border-subtle pt-4">
            <Button
              className="w-full"
              disabled={creating || !startDate}
              onClick={() => void handleMakeTrip()}
              type="button"
            >
              {creating ? t('creating') : t('makeTrip')}
            </Button>
            <div className="flex items-center gap-2">
              <Button
                className="flex-1"
                disabled={creating}
                onClick={handlePlanWithAi}
                type="button"
                variant="outline"
              >
                <Icons.Ai aria-hidden="true" className="me-1.5 size-4" />
                {t('planWithAi')}
              </Button>
              <Button disabled={creating} onClick={clearPicks} type="button" variant="ghost">
                <Trash2 aria-hidden="true" className="me-1.5 size-4" />
                {t('clearAll')}
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
