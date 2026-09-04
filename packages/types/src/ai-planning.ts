import { z } from 'zod';

export const AI_PLANNER_SCHEMA_VERSION = 1 as const;
export const AI_PLANNER_MAX_DAYS = 14;
export const AI_PLANNER_MAX_REAL_PLACE_ITEMS = 24;
export const AI_PLANNER_TRIP_LENGTH_TIERS = [3, 5, 7] as const;
export const AI_PLANNER_MAX_TRIP_DESCRIPTION = 500;

const identifierSchema = z.string().trim().min(1).max(120);
const labelSchema = z.string().trim().min(1).max(200);
const noteSchema = z.string().trim().max(5_000).nullable();
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const localTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const durationSchema = z.number().int().positive().max(43_200);
const schemaVersionField = z.literal(AI_PLANNER_SCHEMA_VERSION);
const dayPartSchema = z.enum(['morning', 'afternoon', 'evening', 'anytime']);
const prioritySchema = z.enum(['must_go', 'interested', 'maybe']).nullable();
const paceSchema = z.enum(['relaxed', 'balanced', 'packed']);
const tripLengthTierSchema = z.union([z.literal(3), z.literal(5), z.literal(7)]);

export const aiPlannerDatePreferenceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      endDate: dateOnlySchema,
      kind: z.literal('exact'),
      startDate: dateOnlySchema,
    })
    .strict(),
  z
    .object({
      earliestStartDate: dateOnlySchema.nullable(),
      kind: z.literal('flexible'),
      latestEndDate: dateOnlySchema.nullable(),
    })
    .strict(),
  z.object({ kind: z.literal('missing') }).strict(),
]);

export const aiPlannerConstraintSchema = z
  .object({
    date: dateOnlySchema.nullable(),
    dayPart: dayPartSchema.nullable(),
    destinationIntentId: identifierSchema.nullable(),
    durationMinutes: durationSchema.nullable(),
    id: identifierSchema,
    kind: z.enum(['activity', 'free_time', 'meeting', 'must_go', 'transport', 'work']),
    label: labelSchema,
    localTime: localTimeSchema.nullable(),
    priority: prioritySchema,
    source: z.enum(['user', 'model']),
    strength: z.enum(['hard', 'flexible']),
  })
  .strict();

export const aiPlannerDestinationIntentSchema = z
  .object({
    id: identifierSchema,
    name: labelSchema,
  })
  .strict();

export const aiPlannerNormalizedRequestSchema = z
  .object({
    constraints: z.array(aiPlannerConstraintSchema),
    datePreference: aiPlannerDatePreferenceSchema,
    destinations: z.array(aiPlannerDestinationIntentSchema),
    interests: z.array(labelSchema),
    pace: paceSchema.nullable(),
    partySize: z.number().int().min(1).max(99).nullable(),
    schemaVersion: schemaVersionField,
    tripName: z.string().trim().min(1).max(120).nullable(),
  })
  .strict();

const assumptionValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string()),
]);

export const aiPlannerAssumptionSchema = z
  .object({
    code: z.enum([
      'dates_defaulted',
      'destination_inferred',
      'interest_inferred',
      'pace_defaulted',
      'party_size_defaulted',
      'trip_name_inferred',
    ]),
    fieldPath: z.string().trim().min(1).max(240),
    id: identifierSchema,
    rationale: z.string().trim().min(1).max(1_000).nullable(),
    value: assumptionValueSchema,
  })
  .strict();

const dayPartScheduleSchema = z
  .object({
    dayPart: dayPartSchema,
    kind: z.literal('day_part'),
  })
  .strict();

const userExactScheduleSchema = z
  .object({
    kind: z.literal('exact'),
    localTime: localTimeSchema,
    source: z.literal('user'),
  })
  .strict();

/** The provider may only echo an exact time the traveller supplied. */
const proposalItemScheduleSchema = z.discriminatedUnion('kind', [
  dayPartScheduleSchema,
  userExactScheduleSchema,
]);

/** Application scheduling may refine a daypart into an estimated local time. */
const draftItemScheduleSchema = z.discriminatedUnion('kind', [
  dayPartScheduleSchema,
  z
    .object({
      kind: z.literal('exact'),
      localTime: localTimeSchema,
      source: z.enum(['user', 'model']),
    })
    .strict(),
]);

const itemFields = {
  blockType: z.enum(['activity', 'free_time', 'meeting', 'transport', 'work']),
  constraintIds: z.array(identifierSchema),
  durationMinutes: durationSchema,
  durationProvenance: z.enum(['user_owned', 'ai_estimated']),
  id: identifierSchema,
  isAnchor: z.boolean(),
  label: labelSchema,
  notes: noteSchema,
  origin: z.enum(['user', 'model']),
  priority: prioritySchema,
} as const;

export const aiPlannerCandidatePlaceSchema = z
  .object({
    id: identifierSchema,
    name: labelSchema,
    note: noteSchema,
    searchQuery: z.string().trim().min(1).max(300),
  })
  .strict();

export const aiPlannerProposalItemSchema = z
  .object({
    ...itemFields,
    candidatePlaceId: identifierSchema.nullable(),
    dayIndex: z
      .number()
      .int()
      .min(0)
      .max(AI_PLANNER_MAX_DAYS - 1)
      .nullable(),
    destinationIntentId: identifierSchema.nullable(),
    schedule: proposalItemScheduleSchema,
  })
  .strict();

export const aiPlannerModelProposalSchema = z
  .object({
    assumptions: z.array(aiPlannerAssumptionSchema),
    destinations: z.array(
      z
        .object({
          assumptionId: identifierSchema.nullable(),
          candidatePlaceId: identifierSchema,
          destinationIntentId: identifierSchema.nullable(),
          source: z.enum(['user', 'model']),
        })
        .strict(),
    ),
    items: z.array(aiPlannerProposalItemSchema),
    normalizedRequest: aiPlannerNormalizedRequestSchema,
    partySize: z.number().int().min(1).max(99).nullable(),
    places: z.array(aiPlannerCandidatePlaceSchema),
    schemaVersion: schemaVersionField,
    selectedDurationDays: tripLengthTierSchema.nullable(),
    tripDescription: z
      .string()
      .trim()
      .min(1)
      .max(AI_PLANNER_MAX_TRIP_DESCRIPTION)
      .describe(
        "One or two sentences in the traveller's own voice saying what this trip is and who it is " +
          'for. Not a day-by-day recap, not marketing copy, and never a list of the places below.',
      ),
    tripName: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe(
        'The trip title, written in the tone named by planner_context.naming.tone. Two to six words ' +
          'naming the place, the season, or the shape of the trip. Never "Trip to X", "X Adventure", ' +
          '"Discovering X", "X Getaway", "Exploring X" or "Ultimate X". No subtitle after a colon, no ' +
          'exclamation mark, and no pun on the name of the destination.',
      ),
  })
  .strict();

export const aiPlannerDraftPlaceSchema = z.discriminatedUnion('resolution', [
  z
    .object({
      attributions: z.array(
        z
          .object({
            provider: z.string().trim().min(1).max(200),
            providerUri: z.url().nullable(),
          })
          .strict(),
      ),
      id: identifierSchema,
      /** Draft-only map context. It is provider-derived and never client-editable. */
      location: z
        .object({
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
        })
        .strict()
        .optional(),
      name: labelSchema,
      placeId: z.uuid(),
      provider: z.literal('google'),
      resolution: z.literal('verified'),
    })
    .strict(),
  z
    .object({
      id: identifierSchema,
      name: labelSchema,
      note: noteSchema,
      resolution: z.literal('custom'),
      verification: z.enum(['unverified', 'not_checked']),
    })
    .strict(),
]);

export const aiPlannerDraftItemSchema = z
  .object({
    ...itemFields,
    placeRefId: identifierSchema.nullable(),
    schedule: draftItemScheduleSchema,
  })
  .strict();

export const aiPlannerEvidenceSchema = z
  .object({
    checkedAt: z.string().datetime({ offset: true }).nullable(),
    code: z.string().trim().min(1).max(120).nullable(),
    id: identifierSchema,
    kind: z.enum(['identity', 'opening_hours', 'route']),
    provider: z.string().trim().min(1).max(120).nullable(),
    status: z.enum(['verified', 'unverified', 'not_checked', 'conflict']),
    subjectId: identifierSchema,
    subjectType: z.enum(['destination', 'item', 'place', 'route']),
  })
  .strict();

export const aiPlannerWarningSchema = z
  .object({
    code: z.string().trim().min(1).max(120),
    evidenceIds: z.array(identifierSchema),
    id: identifierSchema,
    itemIds: z.array(identifierSchema),
    material: z.boolean(),
  })
  .strict();

const sourcedTripFields = {
  dateAssumptionId: identifierSchema.nullable(),
  dateSource: z.enum(['user', 'default']),
  /**
   * Model-authored prose. The default keeps drafts written before descriptions
   * existed parseable: the draft schema is strict and every stored draft is
   * re-parsed on read, so a plain required key would fail every in-flight
   * session, and a schema version bump would fail them the same way.
   */
  description: z.string().trim().max(AI_PLANNER_MAX_TRIP_DESCRIPTION).nullable().default(null),
  endDate: dateOnlySchema,
  name: z.string().trim().min(1).max(120),
  nameAssumptionId: identifierSchema.nullable(),
  nameSource: z.enum(['user', 'model']),
  pace: paceSchema,
  paceAssumptionId: identifierSchema.nullable(),
  paceSource: z.enum(['user', 'default']),
  partySize: z.number().int().min(1).max(99),
  partySizeAssumptionId: identifierSchema.nullable(),
  partySizeSource: z.enum(['user', 'default']),
  startDate: dateOnlySchema,
} as const;

export const aiPlannerDraftSchema = z
  .object({
    assumptions: z.array(aiPlannerAssumptionSchema),
    days: z.array(
      z
        .object({
          dailyBaseDeparturePlaceRefId: identifierSchema.nullable(),
          dailyBasePlaceRefId: identifierSchema.nullable(),
          date: dateOnlySchema,
          destinationId: identifierSchema.nullable(),
          items: z.array(aiPlannerDraftItemSchema),
        })
        .strict(),
    ),
    evidence: z.array(aiPlannerEvidenceSchema),
    normalizedRequest: aiPlannerNormalizedRequestSchema,
    places: z.array(aiPlannerDraftPlaceSchema),
    schemaVersion: schemaVersionField,
    trip: z
      .object({
        ...sourcedTripFields,
        destinations: z.array(
          z
            .object({
              assumptionId: identifierSchema.nullable(),
              destinationIntentId: identifierSchema.nullable(),
              id: identifierSchema,
              placeRefId: identifierSchema,
              source: z.enum(['user', 'model']),
            })
            .strict(),
        ),
      })
      .strict(),
    unscheduledItems: z.array(aiPlannerDraftItemSchema),
    warnings: z.array(aiPlannerWarningSchema),
  })
  .strict();

export type AiPlannerAssumption = z.infer<typeof aiPlannerAssumptionSchema>;
export type AiPlannerConstraint = z.infer<typeof aiPlannerConstraintSchema>;
export type AiPlannerDraft = z.infer<typeof aiPlannerDraftSchema>;
export type AiPlannerDraftItem = z.infer<typeof aiPlannerDraftItemSchema>;
export type AiPlannerDraftPlace = z.infer<typeof aiPlannerDraftPlaceSchema>;
export type AiPlannerEvidence = z.infer<typeof aiPlannerEvidenceSchema>;
export type AiPlannerCandidatePlace = z.infer<typeof aiPlannerCandidatePlaceSchema>;
export type AiPlannerModelProposal = z.infer<typeof aiPlannerModelProposalSchema>;
export type AiPlannerNormalizedRequest = z.infer<typeof aiPlannerNormalizedRequestSchema>;
export type AiPlannerWarning = z.infer<typeof aiPlannerWarningSchema>;

export type AiPlannerContractIssue = {
  code: 'invalid_contract' | 'unsupported_schema_version';
  message: string;
  path: PropertyKey[];
};

export type AiPlannerContractParseResult<OUTPUT> =
  { data: OUTPUT; success: true } | { issues: AiPlannerContractIssue[]; success: false };

function parseVersioned<OUTPUT>(
  schema: z.ZodType<OUTPUT>,
  value: unknown,
): AiPlannerContractParseResult<OUTPUT> {
  const version =
    typeof value === 'object' && value !== null && 'schemaVersion' in value
      ? (value as { schemaVersion?: unknown }).schemaVersion
      : undefined;

  if (version !== AI_PLANNER_SCHEMA_VERSION) {
    return {
      issues: [
        {
          code: 'unsupported_schema_version',
          message: 'unsupported_schema_version',
          path: ['schemaVersion'],
        },
      ],
      success: false,
    };
  }

  const parsed = schema.safeParse(value);
  if (parsed.success) return { data: parsed.data, success: true };

  return {
    issues: parsed.error.issues.map((issue) => ({
      code: 'invalid_contract',
      message: issue.message,
      path: issue.path,
    })),
    success: false,
  };
}

export function parseAiPlannerNormalizedRequest(value: unknown) {
  return parseVersioned(aiPlannerNormalizedRequestSchema, value);
}

export function parseAiPlannerModelProposal(value: unknown) {
  return parseVersioned(aiPlannerModelProposalSchema, value);
}

export function parseAiPlannerDraft(value: unknown) {
  return parseVersioned(aiPlannerDraftSchema, value);
}
