import type { MovementApplyInput, MovementInput, MovementProposal } from '@trove/types';

export type MovementReview = {
  input: MovementInput;
  proposal: MovementProposal;
  error: 'stale' | null;
};
/** No optimistic state: only the accepted canonical response leaves this workflow. */
export async function runMovement<T>(
  input: MovementInput,
  actions: {
    preview: (input: MovementInput) => Promise<MovementProposal>;
    review: (value: MovementReview) => Promise<MovementReview | null>;
    apply: (input: MovementApplyInput) => Promise<T>;
    committed: (result: T) => Promise<void>;
    committing: () => void;
    recover: () => Promise<void>;
    isConflict: (error: unknown) => boolean;
    active: () => boolean;
  },
): Promise<'accepted' | 'cancelled' | 'recovered'> {
  let current: MovementReview = { input, proposal: await actions.preview(input), error: null };
  let requiresReview =
    current.proposal.status !== 'ready' ||
    current.proposal.changes.length > 0 ||
    current.proposal.limitations.length > 0 ||
    current.proposal.issues.length > 0;
  while (actions.active()) {
    if (requiresReview) {
      const accepted = await actions.review(current);
      if (!accepted || !actions.active()) return 'cancelled';
      current = accepted;
    }
    actions.committing();
    let result: T;
    try {
      result = await actions.apply({
        ...current.input,
        scheduleRevision: current.proposal.scheduleRevision,
        fingerprint: current.proposal.fingerprint,
      });
    } catch (error) {
      await actions.recover();
      if (!actions.isConflict(error)) return 'recovered';
      current = { ...current, proposal: await actions.preview(current.input), error: 'stale' };
      requiresReview = true;
      continue;
    }
    await actions.committed(result);
    return 'accepted';
  }
  return 'cancelled';
}
