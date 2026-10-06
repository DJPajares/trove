/**
 * The whole-trip map's day colours, one per day, repeating after the sixth.
 *
 * Written out in full rather than assembled from the index, because Tailwind
 * only emits a utility it can read in the source.
 */
const MAP_DAY_TINTS = [
  { dot: 'bg-map-day-1', marker: 'bg-map-day-1 text-map-day-foreground' },
  { dot: 'bg-map-day-2', marker: 'bg-map-day-2 text-map-day-foreground' },
  { dot: 'bg-map-day-3', marker: 'bg-map-day-3 text-map-day-foreground' },
  { dot: 'bg-map-day-4', marker: 'bg-map-day-4 text-map-day-foreground' },
  { dot: 'bg-map-day-5', marker: 'bg-map-day-5 text-map-day-foreground' },
  { dot: 'bg-map-day-6', marker: 'bg-map-day-6 text-map-day-foreground' },
] as const;

export const MAP_DAY_TINT_COUNT = MAP_DAY_TINTS.length;

export function mapDayTint(dayIndex: number) {
  const count = MAP_DAY_TINTS.length;
  return MAP_DAY_TINTS[((dayIndex % count) + count) % count]!;
}
