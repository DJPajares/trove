'use client';

import { ChevronDown, CircleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { localToday } from '@/components/saved/saved-ready-for-trip';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { applyTaskTemplate, type TaskTemplate } from '@/lib/tasks/api';
import { formatTripDateRange } from '@/lib/trips/format';
import type { Trip } from '@/lib/trips/api';
import { cn } from '@/lib/utils';

export type AppliedTemplate = { count: number; trip: Pick<Trip, 'id' | 'name'> };

type ApplyTemplateSheetProps = {
  onApplied: (applied: AppliedTemplate) => void;
  onClose: () => void;
  suggestedTripId: string;
  template: TaskTemplate | null;
  trips: readonly Trip[];
};

/**
 * Copying a template into one trip. Trips ahead come first, soonest on top and
 * already chosen; past trips wait behind a toggle. The sheet says plainly that
 * every task is copied and where the copies land.
 */
export function ApplyTemplateSheet({
  onApplied,
  onClose,
  suggestedTripId,
  template,
  trips,
}: Readonly<ApplyTemplateSheetProps>) {
  const t = useTranslations('taskTemplates');

  return (
    <Sheet onOpenChange={(open) => !open && onClose()} open={Boolean(template)}>
      <SheetContent
        className="w-full gap-0 md:data-[side=right]:w-[min(30rem,calc(100%-0.5rem))]"
        closeLabel={t('close')}
      >
        {template ? (
          <ApplyForm
            key={template.id}
            onApplied={onApplied}
            suggestedTripId={suggestedTripId}
            template={template}
            trips={trips}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ApplyForm({
  onApplied,
  suggestedTripId,
  template,
  trips,
}: Readonly<Omit<ApplyTemplateSheetProps, 'onClose' | 'template'> & { template: TaskTemplate }>) {
  const t = useTranslations('taskTemplates');
  const locale = useLocale();
  const today = localToday();
  const { past, upcoming } = useMemo(() => {
    const ahead = trips
      .filter((trip) => trip.lifecycle !== 'completed' && trip.endDate >= today)
      .toSorted((left, right) => left.startDate.localeCompare(right.startDate));
    return {
      past: trips
        .filter((trip) => !ahead.includes(trip))
        .toSorted((left, right) => right.startDate.localeCompare(left.startDate)),
      upcoming: ahead,
    };
  }, [today, trips]);
  const [selectedId, setSelectedId] = useState(() =>
    trips.some((trip) => trip.id === suggestedTripId) ? suggestedTripId : (upcoming[0]?.id ?? ''),
  );
  const [showPast, setShowPast] = useState(
    () => !upcoming.length || past.some((trip) => trip.id === selectedId),
  );
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = trips.find((trip) => trip.id === selectedId) ?? null;
  const count = template.items.length;

  async function apply() {
    if (!selected) return;
    setApplying(true);
    setError(null);
    try {
      const result = await applyTaskTemplate(template.id, selected.id);
      onApplied({ count: result.createdCount, trip: selected });
    } catch {
      setError(t('applyError'));
      setApplying(false);
    }
  }

  const nextUpId = upcoming.find((trip) => trip.startDate > today)?.id;
  const option = (trip: Trip, ahead: boolean) => {
    const tag = !ahead
      ? null
      : trip.startDate <= today
        ? t('underway')
        : trip.id === nextUpId
          ? t('nextUp')
          : null;
    return (
      <label
        className="flex min-h-16 cursor-pointer items-center gap-3 rounded-[var(--radius-lg)] border border-border-subtle px-3.5 py-2.5 transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover has-checked:border-brand has-checked:bg-surface-tint has-focus-visible:ring-3 has-focus-visible:ring-ring/40"
        key={trip.id}
      >
        <input
          checked={trip.id === selectedId}
          className="size-5 shrink-0 accent-brand"
          name="template-trip"
          onChange={() => setSelectedId(trip.id)}
          type="radio"
          value={trip.id}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{trip.name}</span>
          <span className="block truncate text-sm text-muted-foreground">
            {formatTripDateRange(trip.startDate, trip.endDate, locale)}
          </span>
        </span>
        {tag ? (
          <span className="shrink-0 rounded-full bg-secondary px-2 py-1 text-[0.6875rem] font-bold tracking-[0.04em] text-secondary-foreground uppercase">
            {tag}
          </span>
        ) : null}
      </label>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="gap-1 border-b-0 px-5 pt-6 pb-0 sm:px-6">
        <p className="text-xs font-semibold tracking-[0.08em] text-brand uppercase">
          {t('applyEyebrow')}
        </p>
        <SheetTitle className="font-journal text-[2rem] leading-tight font-normal tracking-normal">
          {template.name}
        </SheetTitle>
        <SheetDescription className="text-sm leading-6">
          {t('applyDescription', { count })}
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-4 sm:px-6">
        {error ? (
          <Alert className="mb-3" role="alert" variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {trips.length ? (
          <fieldset className="min-w-0 space-y-2">
            <legend className="pb-2 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              {t('chooseTrip')}
            </legend>
            {upcoming.length ? (
              upcoming.map((trip) => option(trip, true))
            ) : (
              <p className="pb-1 text-sm text-muted-foreground">{t('noUpcoming')}</p>
            )}
            {past.length && upcoming.length ? (
              <Button
                aria-expanded={showPast}
                className="-ml-2 h-11 px-2 text-brand"
                onClick={() => setShowPast((current) => !current)}
                type="button"
                variant="ghost"
              >
                {showPast ? t('hidePast') : t('showPast', { count: past.length })}
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    'transition-transform duration-[var(--motion-standard)] motion-reduce:transition-none',
                    showPast && 'rotate-180',
                  )}
                  data-icon="inline-end"
                />
              </Button>
            ) : null}
            {showPast ? past.map((trip) => option(trip, false)) : null}
          </fieldset>
        ) : (
          <p className="text-sm text-muted-foreground">{t('noTrips')}</p>
        )}
      </div>

      <SheetFooter className="gap-3 px-5 pt-4 sm:px-6">
        <p className="text-[0.8125rem] leading-5 text-muted-foreground">{t('applyNote')}</p>
        <Button
          className="h-12 rounded-full text-base"
          disabled={applying || !selected}
          onClick={() => void apply()}
          type="button"
        >
          <span className="truncate">
            {applying
              ? t('applying')
              : selected
                ? t('applyTo', { count, trip: selected.name })
                : t('chooseTrip')}
          </span>
        </Button>
      </SheetFooter>
    </div>
  );
}
