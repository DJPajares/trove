'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { useSuggestedTime } from '@/components/itinerary-suggested-time';
import { useOnlineStatus } from '@/components/trip-sync-status';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ItineraryApiError, type ItineraryItem, updateItineraryItem } from '@/lib/itinerary/api';
import {
  acceptSuggestedSlot,
  manualTimingPatch,
  buildStopInput,
  stopEditorCustomDuration,
  stopEditorForm,
  stopTimingInput,
} from '@/lib/itinerary/item-editor';

import type { StopEditorSaved } from './stop-editor/stop-editor-sheet';
import { TimingField } from './stop-editor/timing-field';

function TimingBody({
  dayId,
  item,
  name,
  onClose,
  onSaved,
  tripId,
}: Readonly<{
  dayId: string;
  item: ItineraryItem;
  name: string;
  onClose: () => void;
  onSaved: (result: StopEditorSaved) => Promise<void>;
  tripId: string;
}>) {
  const t = useTranslations('itinerary');
  const timingT = useTranslations('itinerary.planner.timing');
  const online = useOnlineStatus();
  const [form, setForm] = useState(() => stopEditorForm(item));
  const [customDuration, setCustomDuration] = useState(() => stopEditorCustomDuration(form));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const suggestedTime = useSuggestedTime(tripId, (slot, revision) => {
    setForm((current) => acceptSuggestedSlot(current, slot, revision));
    setFormError(null);
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const built = buildStopInput(form, customDuration);
    if ('error' in built) {
      setFormError(t(built.error));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const result = await updateItineraryItem(tripId, item.id, {
        ...stopTimingInput(built.input),
        timingPolicy: 'reconcile_flexible',
      });
      await onSaved({
        timeZoneConsequence: Boolean(result.timeZoneConsequence),
        scheduling: result.scheduling,
      });
    } catch (error) {
      setFormError(
        error instanceof ItineraryApiError && error.code === 'invalid_local_end_time'
          ? t('endTimeError')
          : error instanceof ItineraryApiError && error.code === 'itinerary_schedule_conflict'
            ? t('connectedTiming.stale')
            : t('saveError'),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{timingT('title', { name })}</SheetTitle>
        <SheetDescription>{timingT('description')}</SheetDescription>
      </SheetHeader>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <FieldGroup>
            {formError ? (
              <Alert role="alert" variant="destructive">
                <CircleAlert aria-hidden="true" />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}
            <TimingField
              customDuration={customDuration}
              expanded
              form={form}
              onChange={(patch) => {
                suggestedTime.reset();
                setForm((current) => manualTimingPatch(current, patch));
                setFormError(null);
              }}
              onCustomDurationChange={setCustomDuration}
              onExpand={() => undefined}
              onRemove={() => {
                setForm((current) => ({
                  ...current,
                  durationMinutes: current.timingMode === 'end_time' ? '' : current.durationMinutes,
                  exactTime: '',
                  localEndTime: '',
                  schedule: 'none',
                  scheduleRevision: undefined,
                  timingMode: 'duration',
                }));
                suggestedTime.reset();
              }}
              protectedTiming={item.timingProtected}
              suggest={
                online && !item.timingProtected
                  ? {
                      loading: suggestedTime.loading,
                      message: suggestedTime.message,
                      suggestion: suggestedTime.suggestion,
                      onApply: suggestedTime.apply,
                      onRequest: () =>
                        void suggestedTime.request({
                          dayId,
                          itemId: item.id,
                          schedule: form.schedule,
                          durationMinutes: form.durationMinutes
                            ? Number(form.durationMinutes)
                            : undefined,
                          localTime: form.exactTime || undefined,
                          localEndTime: form.localEndTime || undefined,
                        }),
                    }
                  : null
              }
            />
          </FieldGroup>
        </div>
        <SheetFooter className="sm:flex-row sm:justify-end">
          <Button disabled={saving} onClick={onClose} type="button" variant="outline">
            {t('cancel')}
          </Button>
          <Button disabled={saving} type="submit">
            {saving ? t('saving') : t('save')}
          </Button>
        </SheetFooter>
      </form>
    </>
  );
}

/**
 * Just when a stop happens and for how long - the edit made most often,
 * reached by tapping the stop's time - without opening everything else about
 * it. It saves only its timing, so it works offline like any timing edit
 * (PRD 28.2) and never touches the stop's Place or notes.
 */
export function TimingSheet({
  dayId,
  item,
  name,
  onClose,
  onSaved,
  open,
  tripId,
}: Readonly<{
  dayId: string;
  item: ItineraryItem | null;
  name: string;
  onClose: () => void;
  onSaved: (result: StopEditorSaved) => Promise<void>;
  open: boolean;
  tripId: string;
}>) {
  const t = useTranslations('itinerary');

  return (
    <Sheet onOpenChange={(next) => !next && onClose()} open={open}>
      <SheetContent
        className="w-full md:data-[side=right]:w-[min(32rem,calc(100%-0.5rem))]"
        closeLabel={t('close')}
      >
        {item ? (
          <TimingBody
            dayId={dayId}
            item={item}
            key={item.id}
            name={name}
            onClose={onClose}
            onSaved={onSaved}
            tripId={tripId}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
