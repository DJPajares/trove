export type TimingFlexibility = 'fixed' | 'flexible';
export type TimingPolicy = 'preserve' | 'reconcile_flexible';
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
};
export type TimingChange = {
  itemId: string;
  itineraryDayId: string;
  before: { localTime: string | null; localEndTime: string | null };
  after: { localTime: string | null; localEndTime: string | null };
};
export type SchedulingOutcome = { changes: TimingChange[]; issues: TimingIssue[] };

/** Extra slot fields are optional only for older cached/client payloads. New responses supply all. */
export type ItineraryDayTimeSuggestion = {
  itemId: string;
  localTime: string | null;
  localEndTime?: string | null;
  durationMinutes?: number | null;
  durationProvenance?: TimingProvenance;
  timeZone?: string;
  affectedItemIds?: string[];
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
