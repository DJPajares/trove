'use client';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ItineraryMovement, MovementInput, MovementProposal } from '@trove/types';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { MovementDialog } from '@/components/planner/movement-dialog';
import {
  applyItineraryMovement,
  previewItineraryMovement,
  readMovementItinerary,
  ItineraryApiError,
} from './api';
import { isItineraryEditing, withItineraryEdit } from './edit-lifecycle';
import { runMovement } from './movement-lifecycle';
import { queryKeys } from '@/lib/query/keys';

type Review = {
  input: MovementInput;
  proposal: MovementProposal;
  busy: boolean;
  error: 'stale' | 'failed' | null;
  generation: number;
};
export function useItineraryMovement({
  tripId,
  online,
  nameFor,
  onCommitted,
  onError,
  fallbackFocus,
}: {
  tripId: string;
  online: boolean;
  nameFor: (id: string) => string;
  onCommitted: () => Promise<void>;
  onError: (key: string) => void;
  fallbackFocus?: () => HTMLElement | null;
}) {
  const client = useQueryClient();
  const t = useTranslations('itinerary.movement');
  const [recovering, setRecovering] = useState(false);
  const retryRecovery = useRef<(() => void) | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const decision = useRef<((value: Review | null) => void) | null>(null);
  const controller = useRef<AbortController | null>(null);
  const active = useRef(false);
  const focus = useRef<HTMLElement | null>(null);
  const focusItemId = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      decision.current?.(null);
      retryRecovery.current?.();
    };
  }, []);
  const ask = (value: Review) =>
    new Promise<Review | null>((resolve) => {
      decision.current = resolve;
      setReview(value);
    });
  async function start(operation: ItineraryMovement) {
    if (!online) {
      onError('offline');
      return false;
    }
    if (active.current || isItineraryEditing(client, tripId)) return false;
    focus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusItemId.current = 'itemId' in operation ? operation.itemId : null;
    active.current = true;
    setBusy(true);
    let committed = false;
    try {
      await withItineraryEdit(client, tripId, async () => {
        controller.current = new AbortController();
        const input: MovementInput = { operation, overrides: [] };
        const outcome = await runMovement(input, {
          preview: (value) => previewItineraryMovement(tripId, value, controller.current!.signal),
          review: async (value) => {
            if (!mounted.current) return null;
            const accepted = await ask({ ...value, busy: false, generation: Date.now() });
            return accepted ? { ...accepted, error: null } : null;
          },
          active: () => mounted.current,
          committing: () => setReview((value) => (value ? { ...value, busy: true } : null)),
          apply: (value) => applyItineraryMovement(tripId, value),
          committed: async (result) => {
            client.setQueryData(queryKeys.itinerary(tripId), result.itinerary);
            committed = true;
            await onCommitted();
          },
          recover: async () => {
            // A lost response may already have committed. Keep the barrier held until
            // we can read canonical state; the retry button only retries this read.
            while (mounted.current) {
              try {
                const canonical = await readMovementItinerary(tripId);
                client.setQueryData(queryKeys.itinerary(tripId), canonical);
                setRecovering(false);
                return;
              } catch {
                if (!mounted.current) break;
                setReview(null);
                setRecovering(true);
                await new Promise<void>((resolve) => {
                  retryRecovery.current = resolve;
                });
                retryRecovery.current = null;
                if (mounted.current) setRecovering(false);
              }
            }
            throw new DOMException('Movement unmounted', 'AbortError');
          },
          isConflict: (error) => error instanceof ItineraryApiError && error.status === 409,
        });
        if (outcome === 'recovered') {
          await onCommitted();
          onError('recovered');
        }
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) onError('failed');
    } finally {
      decision.current = null;
      active.current = false;
      if (mounted.current) {
        setReview(null);
        setBusy(false);
      }
    }
    return committed;
  }
  async function repreview(input: MovementInput) {
    if (!review || review.busy) return;
    setReview({ ...review, busy: true, error: null });
    try {
      const proposal = await previewItineraryMovement(tripId, input, controller.current?.signal);
      if (mounted.current)
        setReview({ input, proposal, busy: false, error: null, generation: review.generation + 1 });
    } catch {
      if (mounted.current) setReview({ ...review, busy: false, error: 'failed' });
    }
  }
  const restoreFocus = () => {
    if (focus.current?.isConnected && focus.current.getClientRects().length) return focus.current;
    return (
      (focusItemId.current
        ? document.getElementById(`itinerary-item-${focusItemId.current}`)
        : null) ??
      fallbackFocus?.() ??
      null
    );
  };
  return {
    start,
    busy,
    dialog: recovering ? (
      <Dialog open>
        <DialogContent closeLabel={t('cancel')} showCloseButton={false} finalFocus={restoreFocus}>
          <DialogHeader>
            <DialogTitle>{t('recoveryTitle')}</DialogTitle>
            <DialogDescription>{t('recoveryDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button disabled={!online} onClick={() => retryRecovery.current?.()}>
              {t('retryRecovery')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ) : review ? (
      <MovementDialog
        key={review.generation}
        {...review}
        offline={!online}
        nameFor={nameFor}
        finalFocus={restoreFocus}
        onPreview={(input) => void repreview(input)}
        onCancel={() => {
          if (!review.busy) decision.current?.(null);
        }}
        onAccept={() => {
          if (!review.busy) decision.current?.(review);
        }}
      />
    ) : null,
  };
}
