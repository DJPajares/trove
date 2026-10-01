/**
 * The harness between the model and the draft. A model's answer is a proposal,
 * not a contract it can be trusted to keep: it truncates a label, invents a
 * clock time, forgets to link the traveller's own meeting, or points an index
 * one past the end. Each of those has one obviously right repair, and making it
 * here keeps a usable plan instead of spending the traveller's quota on a
 * failure. Every repair is recorded as a code from a closed list so a run that
 * needed help stays visible without carrying any traveller content.
 */
export const AI_PLANNER_REPAIR_CODES = [
  'output_element_dropped',
  'output_field_defaulted',
  'output_key_removed',
  'output_number_clamped',
  'output_schedule_relaxed',
  'output_text_shortened',
  'reference_cleared',
  'destination_repaired',
  'date_range_repaired',
  'duration_tier_defaulted',
  'exact_time_relaxed',
  'duration_provenance_relaxed',
  'must_go_relaxed',
  'model_constraint_relaxed',
  'hard_constraint_item_added',
  'hard_constraint_item_aligned',
  'hard_constraint_link_removed',
  'hard_constraint_day_assigned',
  'commitment_outside_dates',
  'hard_place_over_cap',
  'commitment_retimed',
  'commitment_relaxed',
  'blocking_item_unscheduled',
  'overlap_unscheduled',
] as const;

export type AiPlannerRepairCode = (typeof AI_PLANNER_REPAIR_CODES)[number];

export class AiPlannerRepairLog {
  readonly counts: Partial<Record<AiPlannerRepairCode, number>> = {};

  add(code: AiPlannerRepairCode) {
    this.counts[code] = (this.counts[code] ?? 0) + 1;
  }

  get codes() {
    return Object.keys(this.counts) as AiPlannerRepairCode[];
  }
}
