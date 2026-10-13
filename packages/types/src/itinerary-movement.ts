import { z } from 'zod';
import type { TimingIssue } from './itinerary-timing.js';

export const itineraryMovementSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('move'),
      itemId: z.uuid(),
      itineraryDayId: z.uuid().nullable(),
      position: z.number().int().min(0).max(10000),
    })
    .strict(),
  z.object({ kind: z.literal('swap'), itemId: z.uuid(), otherItemId: z.uuid() }).strict(),
  z
    .object({
      kind: z.literal('order'),
      itineraryDayId: z.uuid(),
      itemIds: z.array(z.uuid()).max(1000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('day'),
      sourceDayId: z.uuid(),
      targetDayId: z.uuid(),
      strategy: z.enum(['append', 'swap']),
    })
    .strict(),
]);
export const movementInputSchema = z
  .object({
    operation: itineraryMovementSchema,
    overrides: z
      .array(
        z
          .object({
            itemId: z.uuid(),
            localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
            durationMinutes: z.number().int().positive().max(1440).optional(),
          })
          .strict(),
      )
      .max(1000)
      .default([]),
  })
  .strict();
export const movementApplySchema = movementInputSchema.extend({
  scheduleRevision: z.string().regex(/^[a-f0-9]{64}$/),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ItineraryMovement = z.infer<typeof itineraryMovementSchema>;
export type MovementInput = z.infer<typeof movementInputSchema>;
export type MovementApplyInput = z.infer<typeof movementApplySchema>;
export type MovementSlot = {
  itineraryDayId: string | null;
  date: string | null;
  timeZone: string | null;
  localTime: string | null;
  localEndTime: string | null;
  durationMinutes: number | null;
  startInstant: string | null;
  endInstant: string | null;
};
export type MovementProposal = {
  scheduleRevision: string;
  fingerprint: string;
  status: 'ready' | 'needs_input' | 'conflict';
  orders: Array<{ itineraryDayId: string | null; itemIds: string[] }>;
  changes: Array<{
    itemId: string;
    before: MovementSlot;
    after: MovementSlot;
    reasons: Array<'day' | 'zone' | 'manual' | 'fit'>;
  }>;
  issues: Array<TimingIssue & { blocking: boolean }>;
  limitations: string[];
  editable: Array<{ itemId: string; localTime: string | null; durationMinutes: number | null }>;
};
