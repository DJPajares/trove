import { expect, test, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { MovementInput, MovementProposal } from '@trove/types';
import { runMovement } from '../lib/itinerary/movement-lifecycle';
import { isItineraryEditing, withItineraryEdit } from '../lib/itinerary/edit-lifecycle';
import { queuedMovement } from '../lib/itinerary/queued-movement';

const input: MovementInput = {
  operation: { kind: 'move', itemId: 'a', itineraryDayId: 'day', position: 1 },
  overrides: [],
};
const proposal: MovementProposal = {
  status: 'ready',
  scheduleRevision: 'before',
  fingerprint: 'accepted',
  orders: [],
  changes: [],
  issues: [],
  limitations: ['TRAVEL_ESTIMATED'],
  editable: [],
};
function actions() {
  return {
    preview: vi.fn(async () => proposal),
    review: vi.fn(
      async (value: { input: MovementInput; proposal: MovementProposal; error: 'stale' | null }) =>
        value,
    ),
    apply: vi.fn(async () => ({ saved: true })),
    committed: vi.fn(async () => {}),
    committing: vi.fn(),
    recover: vi.fn(async () => {}),
    isConflict: (e: unknown) => e === 'conflict',
    active: () => true,
  };
}
test('cancellation commits nothing and does not refresh scoring', async () => {
  const a = actions();
  a.review.mockResolvedValueOnce(null as never);
  expect(await runMovement(input, a)).toBe('cancelled');
  expect(a.apply).not.toHaveBeenCalled();
  expect(a.committed).not.toHaveBeenCalled();
  expect(a.recover).not.toHaveBeenCalled();
});
test('acceptance applies exactly the reviewed manual overrides and fingerprint', async () => {
  const a = actions();
  a.review.mockResolvedValueOnce({
    input: { ...input, overrides: [{ itemId: 'a', localTime: '10:00' }] },
    proposal: { ...proposal, fingerprint: 'manual' },
    error: null,
  });
  expect(await runMovement(input, a)).toBe('accepted');
  expect(a.apply).toHaveBeenCalledExactlyOnceWith({
    ...input,
    overrides: [{ itemId: 'a', localTime: '10:00' }],
    scheduleRevision: 'before',
    fingerprint: 'manual',
  });
  expect(a.committed).toHaveBeenCalledTimes(1);
});
test('stale acceptance requires renewed review and cancellation prevents a retry', async () => {
  const a = actions();
  a.apply.mockRejectedValueOnce('conflict');
  a.review
    .mockResolvedValueOnce({ input, proposal, error: null })
    .mockResolvedValueOnce(null as never);
  expect(await runMovement(input, a)).toBe('cancelled');
  expect(a.preview).toHaveBeenCalledTimes(2);
  expect(a.apply).toHaveBeenCalledTimes(1);
  expect(a.recover).toHaveBeenCalledTimes(1);
  expect(a.review.mock.calls[1]![0].error).toBe('stale');
});
test('an ambiguous commit recovers canonical state without replaying a swap', async () => {
  const a = actions();
  a.apply.mockRejectedValueOnce(new TypeError('connection lost'));
  expect(
    await runMovement({ ...input, operation: { kind: 'swap', itemId: 'a', otherItemId: 'b' } }, a),
  ).toBe('recovered');
  expect(a.apply).toHaveBeenCalledTimes(1);
  expect(a.recover).toHaveBeenCalledTimes(1);
  expect(a.committed).not.toHaveBeenCalled();
});
test('the edit barrier remains held during review and canonical refresh', async () => {
  const client = new QueryClient();
  const a = actions();
  a.review.mockImplementation(async (value) => {
    expect(isItineraryEditing(client, 'trip')).toBe(true);
    return value;
  });
  a.committed.mockImplementation(async () => {
    expect(isItineraryEditing(client, 'trip')).toBe(true);
  });
  await withItineraryEdit(client, 'trip', () => runMovement(input, a));
  expect(isItineraryEditing(client, 'trip')).toBe(false);
});
test('late preview after unmount cannot commit or open review', async () => {
  const a = actions();
  a.active = () => false;
  expect(await runMovement(input, a)).toBe('cancelled');
  expect(a.apply).not.toHaveBeenCalled();
  expect(a.review).not.toHaveBeenCalled();
});
test('a safe timing-preserving move uses the initial action as acceptance', async () => {
  const a = actions();
  a.preview.mockResolvedValueOnce({ ...proposal, limitations: [] });
  await runMovement(input, a);
  expect(a.review).not.toHaveBeenCalled();
  expect(a.apply).toHaveBeenCalledTimes(1);
});
test('legacy queue entries become movement intentions without old timing policies', () => {
  expect(
    queuedMovement({
      kind: 'itinerary_item_organize',
      itemId: 'a',
      baseItem: {} as never,
      input: { itineraryDayId: 'day', position: 2, timingPolicy: 'reconcile_flexible' },
    }),
  ).toEqual({ kind: 'move', itemId: 'a', itineraryDayId: 'day', position: 2 });
});

test('an unavailable recovery keeps the scoring barrier held until canonical read completes', async () => {
  const client = new QueryClient();
  const a = actions();
  a.apply.mockRejectedValueOnce(new TypeError('response lost'));
  let finish!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const recovery = new Promise<void>((resolve) => {
    finish = resolve;
  });
  a.recover.mockImplementation(async () => {
    entered();
    await recovery;
  });
  const movement = withItineraryEdit(client, 'trip', () => runMovement(input, a));
  await started;
  expect(isItineraryEditing(client, 'trip')).toBe(true);
  expect(a.apply).toHaveBeenCalledTimes(1);
  finish();
  expect(await movement).toBe('recovered');
  expect(isItineraryEditing(client, 'trip')).toBe(false);
  expect(a.apply).toHaveBeenCalledTimes(1);
});
