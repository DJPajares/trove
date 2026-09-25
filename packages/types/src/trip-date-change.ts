export type DayExperience = {
  date: string;
  rating: number | null;
  note: string | null;
};

export type ShrinkDay = {
  id: string;
  date: string;
  targetDate: string;
  name: string | null;
  notes: string | null;
  rating: number | null;
  reflectionNote: string | null;
  bases: number;
  items: number;
  tasks: number;
  reservations: number;
  expenses: number;
  memories: number;
};

export type TripShrinkImpact = {
  revision: string;
  removedDays: ShrinkDay[];
  retainedDays: Array<{ id: string; date: string; name: string | null; notes: string | null }>;
};

export type DayNoteResolution =
  { dayId: string; action: 'discard' } | { dayId: string; action: 'append'; targetDayId: string };

/** Shared by the server and preview so the displayed merge is exactly what saves. */
export function reassignedDayNotes(impact: TripShrinkImpact, resolutions: DayNoteResolution[]) {
  const notes = new Map(impact.retainedDays.map((day) => [day.id, day.notes ?? '']));
  const seen = new Set<string>();
  for (const resolution of resolutions) {
    if (seen.has(resolution.dayId)) throw new Error('invalid_note_resolution');
    seen.add(resolution.dayId);
    if (!impact.removedDays.some((day) => day.id === resolution.dayId && day.notes?.trim())) {
      throw new Error('invalid_note_resolution');
    }
  }
  for (const day of [...impact.removedDays].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!day.notes?.trim()) continue;
    const resolution = resolutions.find((candidate) => candidate.dayId === day.id);
    if (!resolution) throw new Error('note_resolution_required');
    if (resolution.action === 'discard') continue;
    if (!notes.has(resolution.targetDayId)) throw new Error('invalid_note_resolution');
    const combined = [notes.get(resolution.targetDayId), day.notes].filter(Boolean).join('\n\n');
    if (combined.length > 5_000) throw new Error('reassigned_notes_too_long');
    notes.set(resolution.targetDayId, combined);
  }
  return notes;
}
