import { z } from 'zod';

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  });
export const stayRangeSchema = z
  .object({
    startDate: date,
    endDate: date,
    tripPlaceId: z.uuid(),
  })
  .strict();
export type StayRange = z.infer<typeof stayRangeSchema>;
export type StaySource = 'explicit' | 'stay_range' | 'accommodation' | 'trip_default';
export const stayEndpointSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('inherit') }).strict(),
  z.object({ mode: z.literal('none') }).strict(),
  z.object({ mode: z.literal('place'), tripPlaceId: z.uuid() }).strict(),
]);
export const dayStayUpdateSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    start: stayEndpointSchema,
    end: z.union([stayEndpointSchema, z.object({ mode: z.literal('same_as_start') }).strict()]),
  })
  .strict();
export const stayPlanUpdateSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    defaultTripPlaceId: z.uuid().nullable(),
    ranges: z.array(stayRangeSchema).max(366),
    resetDayOverrides: z.boolean().optional(),
  })
  .strict();
export type DayStayUpdate = z.infer<typeof dayStayUpdateSchema>;
export type StayPlanUpdate = z.infer<typeof stayPlanUpdateSchema>;
export type StayPlan = { defaultTripPlaceId: string | null; ranges: StayRange[]; revision: number };

/** Inclusive full-day ranges. New coverage replaces old coverage without overlap. */
export function replaceStayRange(ranges: readonly StayRange[], next: StayRange): StayRange[] {
  const adjacentDate = (date: string, offset: number) => {
    const value = new Date(`${date}T00:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() + offset);
    return value.toISOString().slice(0, 10);
  };
  return [
    ...ranges.flatMap((range) => {
      if (range.endDate < next.startDate || range.startDate > next.endDate) return [range];
      return [
        ...(range.startDate < next.startDate
          ? [{ ...range, endDate: adjacentDate(next.startDate, -1) }]
          : []),
        ...(range.endDate > next.endDate
          ? [{ ...range, startDate: adjacentDate(next.endDate, 1) }]
          : []),
      ];
    }),
    next,
  ].sort((a, b) => a.startDate.localeCompare(b.startDate));
}
