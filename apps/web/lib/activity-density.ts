export type ActivityDensity = 'light' | 'medium' | 'packed';

export function activityDensityForItemCount(itemCount: number | undefined): ActivityDensity | null {
  if (!itemCount || itemCount < 1) return null;
  if (itemCount <= 2) return 'light';
  if (itemCount <= 4) return 'medium';
  return 'packed';
}
