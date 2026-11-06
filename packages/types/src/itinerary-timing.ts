export type TimingFlexibility = 'fixed' | 'flexible';
export type TimingPolicy = 'preserve' | 'reconcile_flexible' | 'review_flexible';
export function isConnectedTimingPolicy(policy: TimingPolicy | undefined) {
  return policy === 'reconcile_flexible' || policy === 'review_flexible';
}
export type TimingProvenance = 'user_owned' | 'ai_estimated' | 'app_estimated';

export type TimingIssueCode =
  | 'CONTEXT_UNKNOWN'
  | 'NO_ROOM'
  | 'OPENING_HOURS'
  | 'DURATION_UNKNOWN'
  | 'TRAVEL_UNKNOWN'
  | 'FIXED_CONFLICT'
  | 'BOOKING_DATE'
  | 'TIGHT_TRANSITION';
export type TimingIssue = {
  code: TimingIssueCode;
  itemId: string;
  references: string[];
  severity: 'conflict' | 'review' | 'notice';
  /** Full preview from the same scheduling pass used by Suggest timing. */
  suggestion?: ItineraryDayTimeSuggestion;
  /** An arrival lower bound, not a promise the full visit fits. Compared as local wall-clock values. */
  orderConflict?: {
    previousItemId: string;
    /** Local calendar date and clock, YYYY-MM-DDTHH:mm, with no offset. */
    earliestStartLocal: string;
    scheduledStartLocal: string;
  };
  /**
   * Why a connection does not fit, named by its two stops rather than by whichever
   * stop the issue sits on: the travel from one to the next needs more time than
   * the gap between them leaves, and what stops the later stop from starting later.
   */
  travelShortfall?: {
    fromItemId: string;
    toItemId: string;
    travelMinutes: number;
    /** Negative when the later stop would have to start before the earlier one ends. */
    availableMinutes: number;
    limitedBy: TimingShortfallLimit;
    /** The stop whose own time sets the limit; absent when the day itself does. */
    limitItemId?: string;
    /** Local calendar date and clock, YYYY-MM-DDTHH:mm, with no offset. */
    limitLocal: string;
  };
  /**
   * A traveller-fixed stop overlaps a booking that is not linked to it. Trove cannot
   * tell which of the two is wrong - often they are the same plan - so it says
   * which booking and when, and suggests no new time.
   */
  bookingOverlap?: {
    reservationId: string;
    title: string | null;
    /** Local calendar date and clock, YYYY-MM-DDTHH:mm, with no offset. */
    startLocal: string;
    endLocal: string | null;
  };
};
export type TimingShortfallLimit = 'fixed_start' | 'closing_time' | 'day_end';
export type TimingChange = {
  itemId: string;
  itineraryDayId: string;
  before: { localTime: string | null; localEndTime: string | null };
  after: { localTime: string | null; localEndTime: string | null };
};
export type TimingRepairOptions = {
  schedule?: 'afternoon' | 'anytime' | 'evening' | 'exact' | 'morning' | 'none';
  durationMinutes?: number | null;
  localTime?: string;
  localEndTime?: string;
};
export type TimingReviewProposal = {
  itineraryDayId: string;
  scheduleRevision: string;
  targetItemId: string | null;
  /** A fresh, explicitly accepted repair may include dependent personal fixed times. */
  repair?: TimingRepairOptions;
};
export type SchedulingOutcome = {
  changes: TimingChange[];
  issues: TimingIssue[];
  /** Absent in historical outcomes whose changes were already saved. */
  proposals?: TimingReviewProposal[];
};

/** Slots are local clocks. Legacy instant/zone metadata never defines a planning time. */
export type ItineraryDayTimeSuggestion = {
  itemId: string;
  localTime: string | null;
  localEndTime?: string | null;
  durationMinutes?: number | null;
  durationProvenance?: TimingProvenance;
  timeZone?: string;
  affectedItemIds?: string[];
  review?: TimingReviewProposal;
  startInstant?: string | null;
  endInstant?: string | null;
} & (
  | {
      status: 'ok';
      startMinute?: number;
      endMinute?: number;
      reasons: Array<{ code: string; references: string[] }>;
      caveats: string[];
    }
  | { status: 'no_feasible_time'; blockedBy: string[] }
  | { status: 'insufficient_evidence'; missing: string[] }
);
export type ItineraryDayTimeSuggestions = {
  generatedAt: string;
  itineraryDayId: string;
  scheduleRevision?: string;
  suggestions: ItineraryDayTimeSuggestion[];
  issues?: TimingIssue[];
};
