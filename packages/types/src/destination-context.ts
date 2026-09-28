import { z } from 'zod';
import { TRAVEL_INTERESTS } from './planning-context.js';

export const destinationContextIdSchema = z.enum(['singapore', 'tokyo', 'kyoto']);
const date = z.iso.date();
const monthDay = z
  .string()
  .regex(/^(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/)
  .refine((value) => z.iso.date().safeParse(`2000-${value}`).success);
export const destinationContextApplicabilitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all_year') }).strict(),
  z.object({ kind: z.literal('season'), start: monthDay, end: monthDay }).strict(),
  z
    .object({ kind: z.literal('dates'), start: date, end: date })
    .strict()
    .refine((value) => value.end >= value.start),
  z.object({ kind: z.literal('date_set'), dates: z.array(date).min(1) }).strict(),
]);

export const destinationContextRecordSchema = z
  .object({
    id: z.string().min(1),
    revision: z.number().int().positive(),
    scope: z
      .object({
        destination: destinationContextIdSchema,
        /** Descriptive area/venue scope, never an inferred city-wide closure. */
        areaKey: z.string().min(1).optional(),
        venueAliases: z.array(z.string().min(1)).min(1).optional(),
      })
      .strict(),
    kind: z.enum(['experience', 'season', 'demand', 'holiday', 'access', 'closure']),
    accessEffect: z.enum(['partial_restriction', 'full_closure']).optional(),
    applicability: destinationContextApplicabilitySchema,
    interests: z.array(z.enum(TRAVEL_INTERESTS)),
    contentKey: z.string().min(1),
    sourceUrl: z.url().refine((value) => value.startsWith('https://')),
    reviewedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    certainty: z.enum(['fact', 'tendency']),
  })
  .strict()
  .superRefine((value, context) => {
    const reviewed = Date.parse(value.reviewedAt);
    const expires = Date.parse(value.expiresAt);
    if (expires <= reviewed) context.addIssue({ code: 'custom', message: 'expiry_before_review' });
    if (value.applicability.kind === 'dates' || value.applicability.kind === 'date_set') {
      const lastDate =
        value.applicability.kind === 'dates'
          ? value.applicability.end
          : [...value.applicability.dates].sort().at(-1)!;
      const offset = value.scope.destination === 'singapore' ? 8 : 9;
      const boundary = Date.parse(`${lastDate}T00:00:00Z`) + (24 - offset) * 3_600_000;
      if (expires > boundary)
        context.addIssue({ code: 'custom', message: 'dated_context_expires_at_boundary' });
    }
    if (
      value.applicability.kind !== 'dates' &&
      value.applicability.kind !== 'date_set' &&
      expires > reviewed + 90 * 86_400_000
    )
      context.addIssue({ code: 'custom', message: 'general_context_requires_90_day_review' });
    if (
      value.kind === 'closure' &&
      (value.certainty !== 'fact' ||
        value.applicability.kind !== 'dates' ||
        !value.scope.venueAliases ||
        !value.accessEffect)
    )
      context.addIssue({ code: 'custom', message: 'closure_requires_dated_venue_evidence' });
    if (value.kind !== 'closure' && value.accessEffect)
      context.addIssue({ code: 'custom', message: 'patterns_cannot_assert_access_effect' });
    if (
      value.kind === 'holiday' &&
      (value.certainty !== 'fact' ||
        (value.applicability.kind !== 'dates' && value.applicability.kind !== 'date_set'))
    )
      context.addIssue({ code: 'custom', message: 'holiday_requires_exact_dates' });
    if ((value.kind === 'season' || value.kind === 'demand') && value.certainty !== 'tendency')
      context.addIssue({ code: 'custom', message: 'patterns_are_tendencies' });
  });
export type DestinationContextRecord = z.infer<typeof destinationContextRecordSchema>;
export type DestinationContextId = z.infer<typeof destinationContextIdSchema>;
export type DestinationContextGroup = {
  destination: DestinationContextId;
  records: Array<DestinationContextRecord & { interestMatch: boolean; matchedDates: string[] }>;
};
export type TripDestinationContext = {
  catalogVersion: string;
  evaluatedAt: string;
  expiresAt: string | null;
  overview: DestinationContextGroup[];
  days: Array<{ dayId: string; groups: DestinationContextGroup[] }>;
};
